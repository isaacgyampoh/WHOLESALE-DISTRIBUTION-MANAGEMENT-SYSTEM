





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
  select count(distinct p.proname) as n from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname in ('is_trusted_context', 'require_role', 'auth_role',
                      'auth_org_id', 'has_role', 'can_access_product',
                      'can_access_category', 'my_van_id',
                      -- Decides a seller's location from the session, not
                      -- from the request. Without it record_sale would have
                      -- to trust a van id from the browser.
                      'my_sales_van_id', 'my_sales_warehouse_id',
                      'resolve_sales_location')
),
business_fns as (
  select count(distinct p.proname) as n from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname in ('dispatch_van_load', 'complete_van_sale',
                      'approve_van_return', 'approve_reconciliation',
                      'build_reconciliation', 'record_credit_payment',
                      'receive_purchase_line',
                      -- The sale, and the three ways stock legitimately
                      -- enters or is corrected.
                      'record_sale', 'create_product_with_stock',
                      'add_stock', 'adjust_stock_to', 'record_stocktake')
),
anon_tables as (
  -- Raw grant rows held by anon. Reported for information: a project
  -- created before Supabase stopped auto-exposing new entities may carry
  -- legacy grants that are harmless once schema USAGE is revoked.
  select count(*) as n
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'anon'
),
anon_schema_usage as (
  select has_schema_privilege('anon', 'public', 'USAGE') as granted
),
anon_effective_read as (
  -- What actually matters: can an anonymous caller read anything? That
  -- needs BOTH schema USAGE and a table privilege, so both are tested
  -- together rather than inferring from grant rows alone.
  select count(*) as n
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public'
    and c.relkind in ('r', 'v')
    and has_schema_privilege('anon', 'public', 'USAGE')
    and has_table_privilege('anon', c.oid, 'SELECT')
),
authed_tables as (
  -- Covers tables and views: role_table_grants reports both.
  select count(distinct table_name) as n
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'authenticated'
    and privilege_type = 'SELECT'
),
anon_privileged_exec as (
  -- Effective execute, which also requires schema USAGE.
  select count(*) as n
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname in ('dispatch_van_load', 'complete_van_sale',
                      'approve_van_return', 'approve_reconciliation',
                      'record_credit_payment')
    and has_schema_privilege('anon', 'public', 'USAGE')
    and has_function_privilege('anon', p.oid, 'EXECUTE')
),
ledger_locked as (
  select count(*) as n
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'stock_movements'
    and grantee = 'authenticated' and privilege_type in ('UPDATE', 'DELETE')
),
expected_enums (typname, members) as (
  -- Members AND their order. Order matters: the installer declares these
  -- up front rather than appending, and a mismatch would mean the
  -- installer and the migrations have diverged.
  values
    ('credit_txn_type',       'charge,payment,adjustment,write_off'),
    ('invoice_status',        'draft,issued,partially_paid,paid,overdue,void'),
    ('movement_type',         'receipt,issue,adjustment_in,adjustment_out,transfer_in,transfer_out,customer_return,supplier_return,damage,shortage,opening_stock,stocktake_in,stocktake_out'),
    ('order_status',          'draft,confirmed,picking,packed,shipped,delivered,cancelled'),
    ('payment_method',        'cash,bank_transfer,cheque,card,mobile_money'),
    ('po_status',             'draft,submitted,partially_received,received,cancelled'),
    ('reconciliation_status', 'draft,submitted,approved,rejected,settled'),
    ('user_role',             'admin,manager,sales_rep,warehouse,accountant,driver,senior_manager'),
    ('van_load_status',       'draft,loaded,dispatched,returned,reconciled,cancelled'),
    ('van_return_status',     'draft,submitted,approved,rejected'),
    ('van_sale_status',       'draft,completed,void'),
    ('van_crew_role',         'driver,salesperson'),
    ('van_sale_type',         'cash,credit')
),
actual_enums as (
  select t.typname::text as typname,
         string_agg(e.enumlabel, ',' order by e.enumsortorder) as members
  from pg_type t
  join pg_enum e on e.enumtypid = t.oid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public'
  group by t.typname
),
enum_match as (
  select count(*) as n
  from expected_enums x
  join actual_enums a on a.typname = x.typname and a.members = x.members
),
enum_bad as (
  select coalesce(string_agg(x.typname, ', '), '') as names
  from expected_enums x
  left join actual_enums a on a.typname = x.typname and a.members = x.members
  where a.typname is null
),
missing_tables as (
  -- Named check, so a missing table is identified rather than inferred
  -- from a count.
  select coalesce(string_agg(t, ', '), '') as names
  from unnest(array[
    'categories','credit_transactions','customers','inventory','invoices',
    'manager_category_scopes','organizations','payments','products','profiles',
    'purchase_order_items','purchase_orders','sales_order_items','sales_orders',
    'stock_movements','stock_transfer_items','stock_transfers','suppliers',
    'van_assignments','van_inventory','van_load_items','van_loads',
    'van_reconciliations','van_return_items','van_returns','van_sale_items',
    'van_sales','vans','warehouses','auth_pin_attempts','audit_log'
  ]) as t
  where not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE' and table_name = t
  )
),
missing_views as (
  select coalesce(string_agg(v, ', '), '') as names
  from unnest(array[
    'customer_balances','customer_credit_position','customer_statement',
    'invoice_ageing','product_stock_by_location','reconciliation_variances',
    'sale_lines','stock_summary','van_day_activity','van_load_summary',
    'van_stock_summary'
  ]) as v
  where not exists (
    select 1 from information_schema.views
    where table_schema = 'public' and table_name = v
  )
),
report as (
  select  1 as ord, 'Tables' as check_name,
          '31'::text as expected, c.tables::text as actual,
          case when c.tables = 31 then 'OK' else 'CHECK' end as status,
          ''::text as detail
  from counts c
  union all select  2, 'Expected tables all present', 'none missing',
          case when m.names = '' then 'none missing' else 'MISSING' end,
          case when m.names = '' then 'OK' else 'FAIL' end, m.names
  from missing_tables m
  union all select  3, 'Views', '11', c.views::text,
          case when c.views = 11 then 'OK' else 'CHECK' end, '' from counts c
  union all select  4, 'Expected views all present', 'none missing',
          case when v.names = '' then 'none missing' else 'MISSING' end,
          case when v.names = '' then 'OK' else 'FAIL' end, v.names
  from missing_views v
  union all select  5, 'Enum types', '13', c.enums::text,
          case when c.enums = 13 then 'OK' else 'CHECK' end, '' from counts c
  union all select  6, 'Enum members and order', '13 matching', e.n::text,
          case when e.n = 13 then 'OK' else 'FAIL' end,
          (select names from enum_bad)
  from enum_match e
  union all select  7, 'Functions', '49', c.functions::text,
          case when c.functions = 49 then 'OK' else 'CHECK' end, '' from counts c
  union all select  8, 'Triggers', '69', c.triggers::text,
          case when c.triggers = 69 then 'OK' else 'CHECK' end, '' from counts c
  union all select  9, 'RLS policies', '69', c.policies::text,
          case when c.policies = 69 then 'OK' else 'CHECK' end, '' from counts c
  union all select 10, 'RLS enabled on every table',
          c.all_tables::text, c.rls_tables::text,
          case when c.rls_tables = c.all_tables then 'OK' else 'FAIL' end, '' from counts c
  union all select 11, 'Generated columns', '12', c.generated_cols::text,
          case when c.generated_cols = 12 then 'OK' else 'CHECK' end, '' from counts c
  union all select 12, 'Indexes', '122', c.indexes::text,
          case when c.indexes = 122 then 'OK' else 'CHECK' end, '' from counts c
  union all select 13, 'Constraints', '211', c.constraints::text,
          case when c.constraints = 211 then 'OK' else 'CHECK' end, '' from counts c
  union all select 14, 'Security functions present', '11', s.n::text,
          case when s.n = 11 then 'OK' else 'FAIL' end, '' from security_fns s
  union all select 15, 'Business functions present', '12', b.n::text,
          case when b.n = 12 then 'OK' else 'FAIL' end, '' from business_fns b
  union all select 16, 'anon cannot read any table or view', '0', ar.n::text,
          case when ar.n = 0 then 'OK' else 'FAIL' end,
          'This is the decisive check for anonymous access'
  from anon_effective_read ar
  union all select 17, 'anon schema USAGE (inert without privileges)', 'any',
          case when u.granted then 'inherited from PUBLIC' else 'revoked' end,
          'INFO',
          'PostgreSQL grants public schema USAGE to PUBLIC by default; harmless with no table rights'
  from anon_schema_usage u
  union all select 18, 'anon legacy grant rows', 'any',
          a.n::text, 'INFO', '' from anon_tables a
  union all select 19, 'authenticated can read tables and views', '37', t.n::text,
          case when t.n >= 37 then 'OK' else 'FAIL' end, '' from authed_tables t
  union all select 20, 'anon cannot execute privileged functions', '0', e.n::text,
          case when e.n = 0 then 'OK' else 'FAIL' end, '' from anon_privileged_exec e
  union all select 21, 'Stock ledger append-only for users', '0', l.n::text,
          case when l.n = 0 then 'OK' else 'FAIL' end, '' from ledger_locked l
  union all select 22, 'Uninvited signups are created inactive', 'present',
          case when exists (
            select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'handle_new_user'
              and pg_get_functiondef(p.oid) like '%was_invited%'
          ) then 'present' else 'MISSING' end,
          case when exists (
            select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'handle_new_user'
              and pg_get_functiondef(p.oid) like '%was_invited%'
          ) then 'OK' else 'FAIL' end,
          'Migration 0017; without it an OAuth signup becomes an active user'
  union all select 23, 'Phone accepted as an identity', 'nullable email',
          (select case when is_nullable = 'YES' then 'nullable email' else 'email REQUIRED' end
           from information_schema.columns
           where table_schema='public' and table_name='profiles' and column_name='email'),
          (select case when is_nullable = 'YES' then 'OK' else 'FAIL' end
           from information_schema.columns
           where table_schema='public' and table_name='profiles' and column_name='email'),
          'Migration 0017; phone-only sign-in fails without it'
  union all select 24, 'Audit trail is append-only', 'present',
          case when exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
            where c.relname='audit_log' and t.tgname='audit_log_no_update')
            then 'present' else 'MISSING' end,
          case when exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
            where c.relname='audit_log' and t.tgname='audit_log_no_update')
            then 'OK' else 'FAIL' end,
          'History an administrator can edit is not history'
  union all select 25, 'Audit trail is read-only for users', '0',
          (select count(*)::text from information_schema.role_table_grants
           where table_schema='public' and table_name='audit_log'
             and grantee='authenticated' and privilege_type in ('INSERT','UPDATE','DELETE')),
          (select case when count(*) = 0 then 'OK' else 'FAIL' end
           from information_schema.role_table_grants
           where table_schema='public' and table_name='audit_log'
             and grantee='authenticated' and privilege_type in ('INSERT','UPDATE','DELETE')),
          'Entries are written by the server, never by a signed-in user'
  union all select 26, 'Sign-in attempts hidden from the browser', '0',
          (select count(*)::text from information_schema.role_table_grants
           where table_schema='public' and table_name='auth_pin_attempts'
             and grantee in ('anon','authenticated')),
          (select case when count(*) = 0 then 'OK' else 'FAIL' end
           from information_schema.role_table_grants
           where table_schema='public' and table_name='auth_pin_attempts'
             and grantee in ('anon','authenticated')),
          'The sign-in attempt log is server-side machinery'
  union all select 27, 'No two active people share a PIN', 'present',
          case when exists (select 1 from pg_indexes
            where schemaname='public' and indexname='profiles_active_pin_key')
            then 'present' else 'MISSING' end,
          case when exists (select 1 from pg_indexes
            where schemaname='public' and indexname='profiles_active_pin_key')
            then 'OK' else 'FAIL' end,
          'A PIN must identify exactly one person'
  union all select 28, 'PINs are stored as a digest only', 'no plaintext column',
          case when exists (select 1 from information_schema.columns
            where table_schema='public' and table_name='profiles'
              and column_name in ('pin','pin_plain','pin_code'))
            then 'PLAINTEXT COLUMN' else 'no plaintext column' end,
          case when exists (select 1 from information_schema.columns
            where table_schema='public' and table_name='profiles'
              and column_name in ('pin','pin_plain','pin_code'))
            then 'FAIL' else 'OK' end, ''
  union all select 29, 'Organizations', 'at least 1',
          (select count(*)::text from public.organizations),
          case when (select count(*) from public.organizations) >= 1
               then 'OK' else 'FAIL' end, ''
  union all select 30, 'Demo products (0 if seed removed)', 'any',
          (select count(*)::text from public.products), 'INFO', ''
  union all select 31, 'Application users (create in Authentication)', 'any',
          (select count(*)::text from public.profiles), 'INFO',
          'Create your first user, then set profiles.role to admin'
)
select ord as "#", check_name as "check", expected, actual, status, detail
from report
order by ord;


-- Wholesale Distribution Management System
-- Post-installation verification. READ ONLY: this script inspects the
-- catalog only. It creates nothing, changes nothing and deletes nothing,
-- and is safe to run as often as you like.
--
-- HOW TO RUN
--   Supabase -> SQL Editor -> New query -> paste -> Run.
--   Read the "status" column: every row should say OK or INFO.
--
-- HOW TO COPY THIS FILE
--   Open the file itself and press Ctrl+A / Cmd+A, then copy.
--   Do not copy it out of a chat window or drag-select it: both can clip
--   the first character or two, which turns a comment into SQL and
--   produces errors such as
--     syntax error at or near "-"
--     operator too long at or near "==="
--   The first two lines of this file are deliberately blank so that a
--   clipped selection loses nothing.
--
-- WHAT EACH ROW MEANS
--   OK     the check passed
--   INFO   informational only, no action needed
--   CHECK  a count differs from the reference schema, worth a look
--   FAIL   something is wrong, do not build on this database
