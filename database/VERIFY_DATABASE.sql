





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
    -- This project's own functions. Extension-owned ones are excluded,
    -- and so are the few the Supabase platform installs into `public`
    -- itself: `rls_auto_enable` is an event trigger Supabase adds to
    -- switch row level security on for any new table, which is a good
    -- thing to have and not something this repository ships. Counting it
    -- made a correctly-migrated hosted database look one function ahead
    -- of the reference build.
    (select count(distinct p.proname) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname not in ('rls_auto_enable')
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
    ('user_role',             'admin,manager,sales_rep,warehouse,accountant,driver,senior_manager,salesperson'),
    ('crew_role',             'driver,salesperson'),
    ('van_load_status',       'draft,loaded,dispatched,returned,reconciled,cancelled'),
    ('van_return_status',     'draft,submitted,approved,rejected'),
    ('van_sale_status',       'draft,completed,void'),
    ('van_sale_type',         'cash,credit'),
    -- 0022. The duplicated label that broke an upgrade script was in
    -- sync_status, so its members are pinned here by name and order.
    ('sync_status',           'applied,failed,conflict'),
    ('sync_operation',        'van_sale,collection,van_return,reconciliation'),
    ('waybill_status',         'draft,issued,delivered,cancelled'),
    ('notification_severity',  'info,warning,critical'),
    ('supplier_document_kind',  'invoice,delivery_note,waybill,credit_note,certificate,contract,other'),
    ('document_review_status',  'pending,received,reviewing,approved,rejected'),
    ('return_reason',           'damaged,expired,wrong_item,customer_return,unsold,other')
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
    'van_sales','vans','warehouses','auth_pin_attempts','audit_log',
    'sync_operations','product_batches','van_sale_payments',
    'waybills','waybill_items','van_load_crew','momo_providers','notifications',
    'supplier_documents','supplier_portal_tokens','supplier_portal_attempts',
    'stock_returns','stock_return_items','receipt_tokens'
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
    'invoice_ageing','reconciliation_variances','stock_summary',
    'van_load_summary','van_stock_summary','products_priced',
    'batch_expiry_status','expiry_summary','load_takings',
    'invoice_detail','receipt_detail','van_crew',
    'salesperson_performance','momo_reconciliation',
    'stock_transfer_summary','stock_in_transit','supplier_document_detail',
    'supplier_payables','stock_return_summary'
  ]) as v
  where not exists (
    select 1 from information_schema.views
    where table_schema = 'public' and table_name = v
  )
),
report as (
  select  1 as ord, 'Tables' as check_name,
          '45'::text as expected, c.tables::text as actual,
          case when c.tables = 45 then 'OK' else 'CHECK' end as status,
          ''::text as detail
  from counts c
  union all select  2, 'Expected tables all present', 'none missing',
          case when m.names = '' then 'none missing' else 'MISSING' end,
          case when m.names = '' then 'OK' else 'FAIL' end, m.names
  from missing_tables m
  union all select  3, 'Views', '22', c.views::text,
          case when c.views = 22 then 'OK' else 'CHECK' end, '' from counts c
  union all select  4, 'Expected views all present', 'none missing',
          case when v.names = '' then 'none missing' else 'MISSING' end,
          case when v.names = '' then 'OK' else 'FAIL' end, v.names
  from missing_views v
  union all select  5, 'Enum types', '20', c.enums::text,
          case when c.enums = 20 then 'OK' else 'CHECK' end, '' from counts c
  union all select  6, 'Enum members and order', '20 matching', e.n::text,
          case when e.n = 20 then 'OK' else 'FAIL' end,
          (select names from enum_bad)
  from enum_match e
  union all select  7, 'Functions', '84', c.functions::text,
          case when c.functions = 84 then 'OK' else 'CHECK' end, '' from counts c
  union all select  8, 'Triggers', '83', c.triggers::text,
          case when c.triggers = 83 then 'OK' else 'CHECK' end, '' from counts c
  union all select  9, 'RLS policies', '89', c.policies::text,
          case when c.policies = 89 then 'OK' else 'CHECK' end, '' from counts c
  union all select 10, 'RLS enabled on every table',
          c.all_tables::text, c.rls_tables::text,
          case when c.rls_tables = c.all_tables then 'OK' else 'FAIL' end, '' from counts c
  union all select 11, 'Generated columns', '13', c.generated_cols::text,
          case when c.generated_cols = 13 then 'OK' else 'CHECK' end, '' from counts c
  union all select 12, 'Indexes', '176', c.indexes::text,
          case when c.indexes = 176 then 'OK' else 'CHECK' end, '' from counts c
  union all select 13, 'Constraints', '306', c.constraints::text,
          case when c.constraints = 306 then 'OK' else 'CHECK' end, '' from counts c
  union all select 14, 'Security functions present', '8', s.n::text,
          case when s.n = 8 then 'OK' else 'FAIL' end, '' from security_fns s
  union all select 15, 'Business functions present', '7', b.n::text,
          case when b.n = 7 then 'OK' else 'FAIL' end, '' from business_fns b
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
  union all select 24, 'Stock cannot be set directly', '0',
          (select count(*)::text from information_schema.role_table_grants
           where table_schema='public' and table_name='inventory'
             and grantee='authenticated' and privilege_type in ('INSERT','DELETE')),
          (select case when count(*) = 0 then 'OK' else 'FAIL' end
           from information_schema.role_table_grants
           where table_schema='public' and table_name='inventory'
             and grantee='authenticated' and privilege_type in ('INSERT','DELETE')),
          'Quantities come from the ledger; nobody writes them by hand'
  union all select 25, 'Categories can be retired', 'present',
          case when exists (select 1 from information_schema.columns
            where table_schema='public' and table_name='categories' and column_name='is_active')
            then 'present' else 'MISSING' end,
          case when exists (select 1 from information_schema.columns
            where table_schema='public' and table_name='categories' and column_name='is_active')
            then 'OK' else 'FAIL' end,
          'Migration 0020; deleting one would orphan product history'
  union all select 26, 'Audit trail is append-only', 'present',
          case when exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
            where c.relname='audit_log' and t.tgname='audit_log_no_update')
            then 'present' else 'MISSING' end,
          case when exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
            where c.relname='audit_log' and t.tgname='audit_log_no_update')
            then 'OK' else 'FAIL' end,
          'History an administrator can edit is not history'
  union all select 27, 'Audit trail is read-only for users', '0',
          (select count(*)::text from information_schema.role_table_grants
           where table_schema='public' and table_name='audit_log'
             and grantee='authenticated' and privilege_type in ('INSERT','UPDATE','DELETE')),
          (select case when count(*) = 0 then 'OK' else 'FAIL' end
           from information_schema.role_table_grants
           where table_schema='public' and table_name='audit_log'
             and grantee='authenticated' and privilege_type in ('INSERT','UPDATE','DELETE')),
          'Entries are written by the server, never by a signed-in user'
  union all select 28, 'Sign-in attempts hidden from the browser', '0',
          (select count(*)::text from information_schema.role_table_grants
           where table_schema='public' and table_name='auth_pin_attempts'
             and grantee in ('anon','authenticated')),
          (select case when count(*) = 0 then 'OK' else 'FAIL' end
           from information_schema.role_table_grants
           where table_schema='public' and table_name='auth_pin_attempts'
             and grantee in ('anon','authenticated')),
          'The sign-in attempt log is server-side machinery'
  union all select 29, 'No two active people share a PIN', 'present',
          case when exists (select 1 from pg_indexes
            where schemaname='public' and indexname='profiles_active_pin_key')
            then 'present' else 'MISSING' end,
          case when exists (select 1 from pg_indexes
            where schemaname='public' and indexname='profiles_active_pin_key')
            then 'OK' else 'FAIL' end,
          'A PIN must identify exactly one person'
  union all select 30, 'PINs are stored as a digest only', 'no plaintext column',
          case when exists (select 1 from information_schema.columns
            where table_schema='public' and table_name='profiles'
              and column_name in ('pin','pin_plain','pin_code'))
            then 'PLAINTEXT COLUMN' else 'no plaintext column' end,
          case when exists (select 1 from information_schema.columns
            where table_schema='public' and table_name='profiles'
              and column_name in ('pin','pin_plain','pin_code'))
            then 'FAIL' else 'OK' end, ''
  union all select 31, 'Organizations', 'at least 1',
          (select count(*)::text from public.organizations),
          case when (select count(*) from public.organizations) >= 1
               then 'OK' else 'FAIL' end, ''
  union all select 32, 'Demo products (0 if seed removed)', 'any',
          (select count(*)::text from public.products), 'INFO', ''
  union all select 33, 'Application users (create in Authentication)', 'any',
          (select count(*)::text from public.profiles), 'INFO',
          'Create your first user, then set profiles.role to admin'

  -- ---- offline sync (migration 0022) -------------------------------
  -- The driver app does not work without these. Checked by name rather
  -- than by count so a missing one says which.
  union all select 34, 'Offline sync: sync_operations table', 'present',
          case when to_regclass('public.sync_operations') is not null
               then 'present' else 'MISSING' end,
          case when to_regclass('public.sync_operations') is not null
               then 'OK' else 'FAIL' end,
          'Run database/UPGRADE_0022_OFFLINE_SYNC.sql if missing'
  union all select 35, 'Offline sync: idempotency key is the primary key', 'yes',
          case when exists (
            select 1 from pg_index i
              join pg_class t on t.oid = i.indrelid
              join pg_attribute a on a.attrelid = t.oid and a.attnum = any(i.indkey)
             where t.relname = 'sync_operations' and i.indisprimary and a.attname = 'id')
               then 'yes' else 'no' end,
          case when exists (
            select 1 from pg_index i
              join pg_class t on t.oid = i.indrelid
              join pg_attribute a on a.attrelid = t.oid and a.attnum = any(i.indkey)
             where t.relname = 'sync_operations' and i.indisprimary and a.attname = 'id')
               then 'OK' else 'FAIL' end,
          'This is what stops a retried upload applying a sale twice'
  union all select 36, 'Offline sync: sync_submit and sync_bootstrap', 'both',
          (select count(*)::text from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('sync_submit', 'sync_bootstrap')),
          case when (select count(*) from pg_proc p
                       join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public'
                        and p.proname in ('sync_submit', 'sync_bootstrap')) = 2
               then 'OK' else 'FAIL' end, ''
  union all select 37, 'Offline sync: history is append-only', 'trigger present',
          case when exists (select 1 from pg_trigger
                             where tgrelid = 'public.sync_operations'::regclass
                               and tgname = 'sync_operations_no_edit')
               then 'trigger present' else 'MISSING' end,
          case when exists (select 1 from pg_trigger
                             where tgrelid = 'public.sync_operations'::regclass
                               and tgname = 'sync_operations_no_edit')
               then 'OK' else 'FAIL' end, ''
  -- ---- cost is management information (migration 0023) -------------
  union all select 39, 'Cost: raw column withheld from the Data API', 'withheld',
          case when not exists (
            select 1 from information_schema.column_privileges
             where table_name = 'products' and column_name = 'cost_price'
               and grantee = 'authenticated' and privilege_type = 'SELECT')
               then 'withheld' else 'READABLE' end,
          case when not exists (
            select 1 from information_schema.column_privileges
             where table_name = 'products' and column_name = 'cost_price'
               and grantee = 'authenticated' and privilege_type = 'SELECT')
               then 'OK' else 'FAIL' end,
          'A driver could otherwise read the margin on every line'
  union all select 40, 'Cost: the selling price is still readable', 'readable',
          case when exists (
            select 1 from information_schema.column_privileges
             where table_name = 'products' and column_name = 'list_price'
               and grantee = 'authenticated' and privilege_type = 'SELECT')
               then 'readable' else 'BLOCKED' end,
          case when exists (
            select 1 from information_schema.column_privileges
             where table_name = 'products' and column_name = 'list_price'
               and grantee = 'authenticated' and privilege_type = 'SELECT')
               then 'OK' else 'FAIL' end, ''
  union all select 41, 'Cost: product_cost() is the one door', 'present',
          case when exists (select 1 from pg_proc p
                              join pg_namespace n on n.oid = p.pronamespace
                             where n.nspname = 'public' and p.proname = 'product_cost')
               then 'present' else 'MISSING' end,
          case when exists (select 1 from pg_proc p
                              join pg_namespace n on n.oid = p.pronamespace
                             where n.nspname = 'public' and p.proname = 'product_cost')
               then 'OK' else 'FAIL' end, ''
  union all select 42, 'Cost: suppliers are role-gated', 'role-gated',
          case when exists (select 1 from pg_policies
                             where tablename = 'suppliers' and policyname = 'suppliers_read'
                               and qual like '%has_role%')
               then 'role-gated' else 'OPEN' end,
          case when exists (select 1 from pg_policies
                             where tablename = 'suppliers' and policyname = 'suppliers_read'
                               and qual like '%has_role%')
               then 'OK' else 'FAIL' end, ''
  union all select 38, 'Offline sync: authenticated cannot write it', 'SELECT only',
          case when not exists (
            select 1 from information_schema.role_table_grants
             where table_name = 'sync_operations' and grantee = 'authenticated'
               and privilege_type in ('INSERT','UPDATE','DELETE'))
               then 'SELECT only' else 'TOO MUCH' end,
          case when not exists (
            select 1 from information_schema.role_table_grants
             where table_name = 'sync_operations' and grantee = 'authenticated'
               and privilege_type in ('INSERT','UPDATE','DELETE'))
               then 'OK' else 'FAIL' end,
          'Rows are written only by sync_submit()'

  -- ---- invoices, receipts and waybills (migration 0026) ------------
  union all select 43, 'Documents: a credit sale raises its own invoice', 'automatic',
          case when exists (select 1 from pg_trigger
                             where tgname = 'van_sales_raise_invoice')
               then 'automatic' else 'MANUAL' end,
          case when exists (select 1 from pg_trigger
                             where tgname = 'van_sales_raise_invoice')
               then 'OK' else 'FAIL' end,
          'An invoice somebody has to remember to raise is a debt nobody chases'
  union all select 44, 'Documents: one invoice per sale', 'enforced',
          case when exists (select 1 from pg_indexes
                             where schemaname = 'public'
                               and indexname = 'invoices_one_per_sale')
               then 'enforced' else 'UNENFORCED' end,
          case when exists (select 1 from pg_indexes
                             where schemaname = 'public'
                               and indexname = 'invoices_one_per_sale')
               then 'OK' else 'FAIL' end, ''
  union all select 45, 'Documents: a receipt is a payment row', 'present',
          case when to_regclass('public.receipt_detail') is not null
               then 'present' else 'MISSING' end,
          case when to_regclass('public.receipt_detail') is not null
               then 'OK' else 'FAIL' end, ''
  union all select 46, 'Documents: no cost price on a customer document', 'none',
          case when not exists (
            select 1 from information_schema.columns
             where table_schema = 'public'
               and table_name in ('invoice_detail','receipt_detail')
               and column_name ilike '%cost%')
               then 'none' else 'EXPOSED' end,
          case when not exists (
            select 1 from information_schema.columns
             where table_schema = 'public'
               and table_name in ('invoice_detail','receipt_detail')
               and column_name ilike '%cost%')
               then 'OK' else 'FAIL' end,
          'A customer document shows what they were charged, not the margin'
  union all select 47, 'Documents: waybills are behind row level security', 'enabled',
          case when (select bool_and(relrowsecurity) from pg_class
                      where oid in ('public.waybills'::regclass,
                                    'public.waybill_items'::regclass))
               then 'enabled' else 'OFF' end,
          case when (select bool_and(relrowsecurity) from pg_class
                      where oid in ('public.waybills'::regclass,
                                    'public.waybill_items'::regclass))
               then 'OK' else 'FAIL' end, ''
  union all select 48, 'Documents: a driver cannot write their own waybill', 'role-gated',
          case when exists (select 1 from pg_policies
                             where tablename = 'waybills' and policyname = 'waybills_write'
                               and with_check like '%has_role%')
               then 'role-gated' else 'OPEN' end,
          case when exists (select 1 from pg_policies
                             where tablename = 'waybills' and policyname = 'waybills_write'
                               and with_check like '%has_role%')
               then 'OK' else 'FAIL' end,
          'Goods are signed out by the warehouse, not by whoever carries them'

  -- ---- warehouse transfers (migration 0027) ------------------------
  union all select 49, 'Transfers: a manager must approve before goods move', 'enforced',
          case when exists (
            select 1 from pg_constraint
             where conrelid = 'public.stock_transfers'::regclass
               and conname = 'stock_transfers_status_check'
               and pg_get_constraintdef(oid) like '%approved%')
               then 'enforced' else 'MISSING' end,
          case when exists (
            select 1 from pg_constraint
             where conrelid = 'public.stock_transfers'::regclass
               and conname = 'stock_transfers_status_check'
               and pg_get_constraintdef(oid) like '%approved%')
               then 'OK' else 'FAIL' end,
          'A depot that approves its own transfers moves stock where it likes'
  union all select 50, 'Transfers: the full lifecycle is present', '4 functions',
          (select count(*)::text from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('approve_stock_transfer','dispatch_stock_transfer',
                                'receive_stock_transfer','cancel_stock_transfer')),
          case when (select count(*) from pg_proc p
                       join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public'
                        and p.proname in ('approve_stock_transfer','dispatch_stock_transfer',
                                          'receive_stock_transfer','cancel_stock_transfer')) = 4
               then 'OK' else 'FAIL' end, ''
  union all select 51, 'Transfers: what arrived is recorded', 'present',
          case when exists (select 1 from information_schema.columns
                             where table_name = 'stock_transfer_items'
                               and column_name = 'qty_received')
               then 'present' else 'MISSING' end,
          case when exists (select 1 from information_schema.columns
                             where table_name = 'stock_transfer_items'
                               and column_name = 'qty_received')
               then 'OK' else 'FAIL' end,
          'The gap between what left and what arrived is the point of the document'
  union all select 52, 'Transfers: goods in transit belong to neither depot', 'present',
          case when to_regclass('public.stock_in_transit') is not null
               then 'present' else 'MISSING' end,
          case when to_regclass('public.stock_in_transit') is not null
               then 'OK' else 'FAIL' end, ''
  union all select 53, 'Transfers: a batch can be in two warehouses', 'per warehouse',
          case when (select indexdef from pg_indexes
                      where schemaname = 'public' and indexname = 'product_batches_unique')
               like '%warehouse_id%' then 'per warehouse' else 'PER ORG ONLY' end,
          case when (select indexdef from pg_indexes
                      where schemaname = 'public' and indexname = 'product_batches_unique')
               like '%warehouse_id%' then 'OK' else 'FAIL' end,
          'A delivery split across depots really is the same batch in two places'

  -- ---- notifications (migration 0028) ------------------------------
  union all select 54, 'Notifications: a condition is one row, not one a day', 'enforced',
          case when exists (select 1 from pg_indexes
                             where schemaname = 'public'
                               and indexname = 'notifications_standing_unique')
               then 'enforced' else 'MISSING' end,
          case when exists (select 1 from pg_indexes
                             where schemaname = 'public'
                               and indexname = 'notifications_standing_unique')
               then 'OK' else 'FAIL' end,
          'Otherwise the bell fills with repeats of the same fact'
  union all select 55, 'Notifications: events are written by trigger', '4 triggers',
          (select count(*)::text from pg_trigger
            where tgname in ('reconciliations_notify','van_returns_notify',
                             'stock_transfers_notify','stock_transfers_notify_short')),
          case when (select count(*) from pg_trigger
                      where tgname in ('reconciliations_notify','van_returns_notify',
                                       'stock_transfers_notify','stock_transfers_notify_short')) = 4
               then 'OK' else 'FAIL' end, ''
  union all select 56, 'Notifications: nobody writes their own', 'read and mark only',
          case when not exists (
            select 1 from information_schema.role_table_grants
             where table_name = 'notifications' and grantee = 'authenticated'
               and privilege_type in ('INSERT','DELETE'))
               then 'read and mark only' else 'TOO MUCH' end,
          case when not exists (
            select 1 from information_schema.role_table_grants
             where table_name = 'notifications' and grantee = 'authenticated'
               and privilege_type in ('INSERT','DELETE'))
               then 'OK' else 'FAIL' end,
          'One a browser could insert reports something that did not happen'

  -- ---- supplier paperwork and the portal (0029, 0030) --------------
  union all select 57, 'Suppliers: the document bucket is private', 'private',
          case when exists (select 1 from storage.buckets
                             where id = 'supplier-documents' and public = false)
               then 'private' else 'PUBLIC OR MISSING' end,
          case when exists (select 1 from storage.buckets
                             where id = 'supplier-documents' and public = false)
               then 'OK' else 'FAIL' end,
          'A public bucket hands every purchase price to anybody who guesses a URL'
  union all select 58, 'Suppliers: the files have policies of their own', '3 policies',
          (select count(*)::text from pg_policies
            where schemaname = 'storage' and tablename = 'objects'
              and policyname like 'supplier_documents_objects%'),
          case when (select count(*) from pg_policies
                      where schemaname = 'storage' and tablename = 'objects'
                        and policyname like 'supplier_documents_objects%') = 3
               then 'OK' else 'FAIL' end,
          'Storage is reachable directly; a policy on the rows alone is not enough'
  union all select 59, 'Portal: links are held as a digest only', 'digest only',
          case when exists (select 1 from information_schema.columns
                             where table_name = 'supplier_portal_tokens'
                               and column_name = 'token_hash')
                and not exists (select 1 from information_schema.columns
                                 where table_name = 'supplier_portal_tokens'
                                   and column_name in ('token','secret','plaintext'))
               then 'digest only' else 'PLAINTEXT' end,
          case when exists (select 1 from information_schema.columns
                             where table_name = 'supplier_portal_tokens'
                               and column_name = 'token_hash')
                and not exists (select 1 from information_schema.columns
                                 where table_name = 'supplier_portal_tokens'
                                   and column_name in ('token','secret','plaintext'))
               then 'OK' else 'FAIL' end,
          'A leaked backup must hand over no working links'
  union all select 60, 'Portal: every link expires', 'enforced',
          case when exists (select 1 from pg_constraint
                             where conrelid = 'public.supplier_portal_tokens'::regclass
                               and conname = 'supplier_portal_tokens_expiry_ahead')
               then 'enforced' else 'MISSING' end,
          case when exists (select 1 from pg_constraint
                             where conrelid = 'public.supplier_portal_tokens'::regclass
                               and conname = 'supplier_portal_tokens_expiry_ahead')
               then 'OK' else 'FAIL' end,
          'One with no end date is a permanent grant to whoever it was forwarded to'
  union all select 61, 'Portal: redeeming is server-side only', 'service role only',
          case when not exists (
            select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'resolve_supplier_token'
               and (has_function_privilege('anon', p.oid, 'EXECUTE')
                    or has_function_privilege('authenticated', p.oid, 'EXECUTE')))
               then 'service role only' else 'EXPOSED' end,
          case when not exists (
            select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'resolve_supplier_token'
               and (has_function_privilege('anon', p.oid, 'EXECUTE')
                    or has_function_privilege('authenticated', p.oid, 'EXECUTE')))
               then 'OK' else 'FAIL' end, ''

  -- ---- supplier submissions and the audit gaps (0031) --------------
  union all select 62, 'Submissions: a supplier can send their own invoice', 'present',
          case when exists (select 1 from pg_proc p
                             join pg_namespace n on n.oid = p.pronamespace
                            where n.nspname = 'public'
                              and p.proname = 'submit_supplier_document')
               then 'present' else 'MISSING' end,
          case when exists (select 1 from pg_proc p
                             join pg_namespace n on n.oid = p.pronamespace
                            where n.nspname = 'public'
                              and p.proname = 'submit_supplier_document')
               then 'OK' else 'FAIL' end,
          'And the link is re-checked at submission, so revoking stops one in flight'
  union all select 63, 'Submissions: server-side only', 'service role only',
          case when not exists (
            select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'submit_supplier_document'
               and (has_function_privilege('anon', p.oid, 'EXECUTE')
                    or has_function_privilege('authenticated', p.oid, 'EXECUTE')))
               then 'service role only' else 'EXPOSED' end,
          case when not exists (
            select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'submit_supplier_document'
               and (has_function_privilege('anon', p.oid, 'EXECUTE')
                    or has_function_privilege('authenticated', p.oid, 'EXECUTE')))
               then 'OK' else 'FAIL' end, ''
  union all select 64, 'Submissions: a review workflow exists', 'present',
          case when exists (select 1 from pg_type where typname = 'document_review_status')
               then 'present' else 'MISSING' end,
          case when exists (select 1 from pg_type where typname = 'document_review_status')
               then 'OK' else 'FAIL' end,
          'received, reviewing, approved, rejected'
  union all select 65, 'Invoices carry a discount', 'present',
          case when exists (select 1 from information_schema.columns
                             where table_name = 'invoices' and column_name = 'discount')
               then 'present' else 'MISSING' end,
          case when exists (select 1 from information_schema.columns
                             where table_name = 'invoices' and column_name = 'discount')
               then 'OK' else 'FAIL' end, ''
  union all select 66, 'Waybills record shortages and damage', '3 columns',
          (select count(*)::text from information_schema.columns
            where table_name = 'waybill_items'
              and column_name in ('qty_received','qty_damaged','qty_short')),
          case when (select count(*) from information_schema.columns
                      where table_name = 'waybill_items'
                        and column_name in ('qty_received','qty_damaged','qty_short')) = 3
               then 'OK' else 'FAIL' end, ''
  union all select 67, 'Returns have a reason worth counting', 'enumerated',
          case when exists (select 1 from pg_type where typname = 'return_reason')
               then 'enumerated' else 'FREE TEXT' end,
          case when exists (select 1 from pg_type where typname = 'return_reason')
               then 'OK' else 'FAIL' end,
          '"damaged" typed forty ways cannot be counted'
  union all select 68, 'Customer and supplier returns move stock', 'present',
          case when to_regclass('public.stock_returns') is not null
                and exists (select 1 from pg_proc p
                             join pg_namespace n on n.oid = p.pronamespace
                            where n.nspname = 'public' and p.proname = 'record_stock_return')
               then 'present' else 'MISSING' end,
          case when to_regclass('public.stock_returns') is not null
                and exists (select 1 from pg_proc p
                             join pg_namespace n on n.oid = p.pronamespace
                            where n.nspname = 'public' and p.proname = 'record_stock_return')
               then 'OK' else 'FAIL' end,
          'Both were being recorded as adjustments, which loses who and why'
  -- ---- the van crew (migrations 0032, 0033) ------------------------
  union all select 60, 'Crew: a van assignment names a job', 'member and job',
          case when (select count(*) from information_schema.columns
                      where table_name = 'van_assignments'
                        and column_name in ('member_id','crew_role')) = 2
               then 'member and job' else 'DRIVER ONLY' end,
          case when (select count(*) from information_schema.columns
                      where table_name = 'van_assignments'
                        and column_name in ('member_id','crew_role')) = 2
               then 'OK' else 'FAIL' end,
          'A van carries a driver and the people who sell from it'
  union all select 61, 'Crew: one driver per van, many salespeople', 'enforced',
          case when exists (select 1 from pg_indexes
                             where indexname = 'van_assignments_one_active_driver_per_van')
               then 'enforced' else 'MISSING' end,
          case when exists (select 1 from pg_indexes
                             where indexname = 'van_assignments_one_active_driver_per_van')
               then 'OK' else 'FAIL' end, ''
  union all select 62, 'Crew: a sale records who sold it', 'attributed',
          case when exists (select 1 from information_schema.columns
                             where table_name = 'van_sales' and column_name = 'salesperson_id')
               then 'attributed' else 'MISSING' end,
          case when exists (select 1 from information_schema.columns
                             where table_name = 'van_sales' and column_name = 'salesperson_id')
               then 'OK' else 'FAIL' end,
          'Distinct from who drove the van'
  union all select 63, 'Crew: no sale left unattributed', 'none',
          (select count(*)::text from public.van_sales where salesperson_id is null),
          case when not exists (select 1 from public.van_sales where salesperson_id is null)
               then 'OK' else 'FAIL' end,
          'Historical sales are backfilled with the driver, who was both'
  union all select 64, 'Crew: selling requires being crewed to sell', 'gated',
          case when exists (select 1 from pg_proc p
                              join pg_namespace n on n.oid = p.pronamespace
                             where n.nspname = 'public' and p.proname = 'is_van_salesperson')
               then 'gated' else 'MISSING' end,
          case when exists (select 1 from pg_proc p
                              join pg_namespace n on n.oid = p.pronamespace
                             where n.nspname = 'public' and p.proname = 'is_van_salesperson')
               then 'OK' else 'FAIL' end,
          'Being aboard is not the same as being allowed to take money'
  union all select 65, 'Crew: the old driver-insert policy is gone', 'removed',
          case when not exists (select 1 from pg_policies
                                 where tablename = 'van_sales'
                                   and policyname = 'van_sales_driver_insert')
               then 'removed' else 'STILL THERE' end,
          case when not exists (select 1 from pg_policies
                                 where tablename = 'van_sales'
                                   and policyname = 'van_sales_driver_insert')
               then 'OK' else 'FAIL' end,
          'Policies are permissive and OR together; an old one still grants'
  union all select 66, 'Crew: the load records who went out with it', 'present',
          case when to_regclass('public.van_load_crew') is not null
               then 'present' else 'MISSING' end,
          case when to_regclass('public.van_load_crew') is not null
               then 'OK' else 'FAIL' end, ''
  union all select 67, 'Momo: the network is recorded', 'present',
          case when (select count(*) from information_schema.columns
                      where table_name in ('van_sale_payments','payments')
                        and column_name = 'provider') = 2
               then 'present' else 'MISSING' end,
          case when (select count(*) from information_schema.columns
                      where table_name in ('van_sale_payments','payments')
                        and column_name = 'provider') = 2
               then 'OK' else 'FAIL' end,
          'A reference cannot be matched to a statement without it'
  union all select 68, 'Momo: reconcilable by network, van and salesperson', 'present',
          case when to_regclass('public.momo_reconciliation') is not null
               then 'present' else 'MISSING' end,
          case when to_regclass('public.momo_reconciliation') is not null
               then 'OK' else 'FAIL' end, ''
  -- ---- product pictures (migration 0037) ---------------------------
  union all select 69, 'Pictures: the bucket exists and is public', 'public',
          case when exists (select 1 from storage.buckets
                             where id = 'product-images' and public)
               then 'public' else 'MISSING' end,
          case when exists (select 1 from storage.buckets
                             where id = 'product-images' and public)
               then 'OK' else 'FAIL' end,
          'Public on purpose: a signed URL expires, and a phone offline in a van cannot mint one'
  union all select 70, 'Pictures: supplier documents are still private', 'private',
          case when exists (select 1 from storage.buckets
                             where id = 'supplier-documents' and not public)
               then 'private' else 'PUBLIC' end,
          case when exists (select 1 from storage.buckets
                             where id = 'supplier-documents' and not public)
               then 'OK' else 'FAIL' end,
          'Those carry purchase prices and must never be public'
  union all select 71, 'Pictures: only product editors may upload', 'role-gated',
          case when exists (select 1 from pg_policies
                             where schemaname = 'storage' and tablename = 'objects'
                               and policyname = 'product_images_write'
                               and with_check like '%has_role%')
               then 'role-gated' else 'OPEN' end,
          case when exists (select 1 from pg_policies
                             where schemaname = 'storage' and tablename = 'objects'
                               and policyname = 'product_images_write'
                               and with_check like '%has_role%')
               then 'OK' else 'FAIL' end, ''
  union all select 72, 'Pictures: the picture reaches the field', 'in the snapshot',
          case when position('image_path' in
                 coalesce((select pg_get_functiondef(p.oid) from pg_proc p
                             join pg_namespace n on n.oid = p.pronamespace
                            where n.nspname = 'public' and p.proname = 'sync_bootstrap'
                            limit 1), '')) > 0
               then 'in the snapshot' else 'MISSING' end,
          case when position('image_path' in
                 coalesce((select pg_get_functiondef(p.oid) from pg_proc p
                             join pg_namespace n on n.oid = p.pronamespace
                            where n.nspname = 'public' and p.proname = 'sync_bootstrap'
                            limit 1), '')) > 0
               then 'OK' else 'FAIL' end,
          'Otherwise the field catalogue is text again the moment the signal goes'
  -- ---- column grants keep up with the columns (migration 0038) -----
  union all select 73, 'Grants: every product column except cost is readable', 'all but cost',
          coalesce((select string_agg(c.column_name, ', ')
             from information_schema.columns c
            where c.table_schema = 'public' and c.table_name = 'products'
              and c.column_name <> 'cost_price'
              and not exists (select 1 from information_schema.column_privileges g
                               where g.table_name = 'products' and g.column_name = c.column_name
                                 and g.grantee = 'authenticated' and g.privilege_type = 'SELECT')),
            'all but cost'),
          case when not exists (
            select 1 from information_schema.columns c
             where c.table_schema = 'public' and c.table_name = 'products'
               and c.column_name <> 'cost_price'
               and not exists (select 1 from information_schema.column_privileges g
                                where g.table_name = 'products' and g.column_name = c.column_name
                                  and g.grantee = 'authenticated' and g.privilege_type = 'SELECT'))
               then 'OK' else 'FAIL' end,
          'A column added after 0023 with no grant breaks products_priced entirely'
  union all select 74, 'Grants: the masked view exposes what the catalogue reads', 'complete',
          case when (select count(*) from information_schema.columns
                      where table_schema = 'public' and table_name = 'products_priced'
                        and column_name in ('cost_price','list_price','image_path',
                                            'track_batches','track_expiry','shelf_life_days')) = 6
               then 'complete' else 'INCOMPLETE' end,
          case when (select count(*) from information_schema.columns
                      where table_schema = 'public' and table_name = 'products_priced'
                        and column_name in ('cost_price','list_price','image_path',
                                            'track_batches','track_expiry','shelf_life_days')) = 6
               then 'OK' else 'FAIL' end,
          'Table-level SELECT was withdrawn in 0023, so the view is the only route'
  -- ---- a name to sign in with (migration 0039) --------------------
  union all select 75, 'Sign-in: every account has a unique username', 'unique, not null',
          case when exists (select 1 from information_schema.columns
                             where table_schema = 'public' and table_name = 'profiles'
                               and column_name = 'username' and is_nullable = 'NO')
                and exists (select 1 from pg_indexes
                             where schemaname = 'public' and indexname = 'profiles_username_key')
               then 'unique, not null' else 'MISSING' end,
          case when exists (select 1 from information_schema.columns
                             where table_schema = 'public' and table_name = 'profiles'
                               and column_name = 'username' and is_nullable = 'NO')
                and exists (select 1 from pg_indexes
                             where schemaname = 'public' and indexname = 'profiles_username_key')
               then 'OK' else 'FAIL' end,
          'Without it the PIN is the identifier again and a lucky guess lands on somebody'
  union all select 76, 'Sign-in: an issued PIN can be marked provisional', 'present',
          case when exists (select 1 from information_schema.columns
                             where table_schema = 'public' and table_name = 'profiles'
                               and column_name = 'must_change_pin')
               then 'present' else 'MISSING' end,
          case when exists (select 1 from information_schema.columns
                             where table_schema = 'public' and table_name = 'profiles'
                               and column_name = 'must_change_pin')
               then 'OK' else 'FAIL' end,
          'The bootstrap PIN is documented, so it must not survive first sign-in'
  union all select 77, 'Sign-in: nobody is left without a username', '0',
          (select count(*)::text from public.profiles where username is null),
          case when not exists (select 1 from public.profiles where username is null)
               then 'OK' else 'FAIL' end,
          'An account with no username cannot sign in at all'
  -- ---- the attempt limit can actually hold (migration 0040) --------
  union all select 78, 'Sign-in: attempts are counted per device as well as address', 'present',
          case when exists (select 1 from information_schema.columns
                             where table_schema = 'public' and table_name = 'auth_pin_attempts'
                               and column_name = 'device_id')
               then 'present' else 'MISSING' end,
          case when exists (select 1 from information_schema.columns
                             where table_schema = 'public' and table_name = 'auth_pin_attempts'
                               and column_name = 'device_id')
               then 'OK' else 'FAIL' end,
          'A mobile address changes mid-run, so address alone lets guessing continue'
  union all select 79, 'Sign-in: the limiter has indexes to ask its question', '2',
          (select count(*)::text from pg_indexes
            where schemaname = 'public'
              and indexname in ('auth_pin_attempts_device_time','auth_pin_attempts_ip_time')),
          case when (select count(*) from pg_indexes
                      where schemaname = 'public'
                        and indexname in ('auth_pin_attempts_device_time','auth_pin_attempts_ip_time')) = 2
               then 'OK' else 'FAIL' end,
          'Every sign-in reads this table; unindexed it is a scan on the hot path'
  union all select 80, 'Sign-in: one PIN cannot open two accounts', 'unique among active',
          case when exists (select 1 from pg_indexes
                             where schemaname = 'public' and indexname = 'profiles_active_pin_key')
               then 'unique among active' else 'MISSING' end,
          case when exists (select 1 from pg_indexes
                             where schemaname = 'public' and indexname = 'profiles_active_pin_key')
               then 'OK' else 'FAIL' end,
          'Sign-in is by PIN alone, so a shared PIN would make the account ambiguous'
  -- ---- every movement type moves stock somewhere (0043, 0044) -------
  union all select 81, 'Stock: every movement type has a direction', 'all',
          coalesce((select string_agg(e.enumlabel, ', ')
             from pg_enum e join pg_type t on t.oid = e.enumtypid
            where t.typname = 'movement_type'
              and public.movement_direction(e.enumlabel::public.movement_type) is null),
            'all'),
          case when not exists (
            select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
             where t.typname = 'movement_type'
               and public.movement_direction(e.enumlabel::public.movement_type) is null)
               then 'OK' else 'FAIL' end,
          'A null direction does not miscount the balance, it replaces it with null'
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
