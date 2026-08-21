-- =====================================================================
-- WHOLESALE DISTRIBUTION MANAGEMENT SYSTEM
-- Post-installation verification
--
-- READ ONLY. This script only inspects the catalog: it creates nothing,
-- changes nothing and deletes nothing. Safe to run at any time.
--
-- HOW TO USE
--   Supabase -> SQL Editor -> New query -> paste -> Run.
--   Read the "status" column. Everything should say OK.
--
-- It is written as one statement so the editor shows the whole report.
-- =====================================================================

with counts as (
  select
    (select count(*) from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE')          as tables,
    (select count(*) from information_schema.views
      where table_schema = 'public')                                       as views,
    (select count(distinct t.typname) from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public')                                          as enums,
    (select count(distinct p.proname) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and not exists (select 1 from pg_depend d
                        where d.objid = p.oid and d.deptype = 'e'))        as functions,
    (select count(*) from pg_trigger tg
      join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where not tg.tgisinternal and n.nspname in ('public', 'auth'))       as triggers,
    (select count(*) from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public')                                          as policies,
    (select count(*) from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity)  as rls_tables,
    (select count(*) from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r')                       as all_tables,
    (select count(*) from information_schema.columns
      where table_schema = 'public' and is_generated = 'ALWAYS')            as generated_cols,
    (select count(*) from pg_indexes where schemaname = 'public')           as indexes,
    (select count(*) from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public')                                          as constraints
),
security_fns as (
  select count(*) as n from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname in ('is_trusted_context', 'require_role', 'auth_role',
                      'auth_org_id', 'has_role', 'can_access_product',
                      'can_access_category', 'my_van_id')
),
business_fns as (
  select count(distinct p.proname) as n from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname in ('dispatch_van_load', 'complete_van_sale',
                      'approve_van_return', 'approve_reconciliation',
                      'build_reconciliation', 'record_credit_payment',
                      'receive_purchase_line')
),
anon_tables as (
  -- anon must hold no privileges on any application table.
  select count(*) as n
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'anon'
),
authed_tables as (
  select count(distinct table_name) as n
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'SELECT'
),
anon_privileged_exec as (
  -- anon must not be able to execute any privileged business function.
  select count(*) as n
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname in ('dispatch_van_load', 'complete_van_sale',
                      'approve_van_return', 'approve_reconciliation',
                      'record_credit_payment')
    and has_function_privilege('anon', p.oid, 'EXECUTE')
),
ledger_locked as (
  select count(*) as n
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'stock_movements'
    and grantee = 'authenticated' and privilege_type in ('UPDATE', 'DELETE')
),
report as (
  select  1 as ord, 'Tables'                    as check_name,
          '29'::text as expected, c.tables::text as actual,
          case when c.tables = 29 then 'OK' else 'CHECK' end as status from counts c
  union all select  2, 'Views', '8', c.views::text,
          case when c.views = 8 then 'OK' else 'CHECK' end from counts c
  union all select  3, 'Enum types', '12', c.enums::text,
          case when c.enums = 12 then 'OK' else 'CHECK' end from counts c
  union all select  4, 'Functions', '33', c.functions::text,
          case when c.functions = 33 then 'OK' else 'CHECK' end from counts c
  union all select  5, 'Triggers', '64', c.triggers::text,
          case when c.triggers = 64 then 'OK' else 'CHECK' end from counts c
  union all select  6, 'RLS policies', '67', c.policies::text,
          case when c.policies = 67 then 'OK' else 'CHECK' end from counts c
  union all select  7, 'Tables with RLS enabled',
          c.all_tables::text, c.rls_tables::text,
          case when c.rls_tables = c.all_tables then 'OK' else 'FAIL' end from counts c
  union all select  8, 'Generated columns', '12', c.generated_cols::text,
          case when c.generated_cols = 12 then 'OK' else 'CHECK' end from counts c
  union all select  9, 'Indexes', '111', c.indexes::text,
          case when c.indexes >= 100 then 'OK' else 'CHECK' end from counts c
  union all select 10, 'Constraints', '201', c.constraints::text,
          case when c.constraints >= 190 then 'OK' else 'CHECK' end from counts c
  union all select 11, 'Security functions present', '8', s.n::text,
          case when s.n = 8 then 'OK' else 'FAIL' end from security_fns s
  union all select 12, 'Business functions present', '7', b.n::text,
          case when b.n = 7 then 'OK' else 'FAIL' end from business_fns b
  union all select 13, 'anon has NO table privileges', '0', a.n::text,
          case when a.n = 0 then 'OK' else 'FAIL' end from anon_tables a
  -- Counts tables and views together: role_table_grants covers both.
  union all select 14, 'authenticated can read tables + views', '37', t.n::text,
          case when t.n >= 37 then 'OK' else 'FAIL' end from authed_tables t
  union all select 15, 'anon cannot execute privileged functions', '0', e.n::text,
          case when e.n = 0 then 'OK' else 'FAIL' end from anon_privileged_exec e
  union all select 16, 'stock ledger is append-only for users', '0', l.n::text,
          case when l.n = 0 then 'OK' else 'FAIL' end from ledger_locked l
  union all select 17, 'Organizations', 'at least 1',
          (select count(*)::text from public.organizations),
          case when (select count(*) from public.organizations) >= 1 then 'OK' else 'FAIL' end
  union all select 18, 'Demo products (0 if seed skipped)', 'any',
          (select count(*)::text from public.products), 'INFO'
  union all select 19, 'Application users (create in Authentication)', 'any',
          (select count(*)::text from public.profiles), 'INFO'
)
select ord as "#", check_name as "check", expected, actual, status
from report
order by ord;
