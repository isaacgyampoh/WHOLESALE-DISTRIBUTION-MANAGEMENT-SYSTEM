--
--
-- ===================================================================
-- GAB PREMIUM ENT - REMOVING THE DEMONSTRATION DATA
-- ===================================================================
--
-- Prefer `npm run production:clean`. It shows you what it is about to
-- delete, refuses if the data does not look like a demonstration, and
-- removes the Supabase Auth accounts as well - which SQL alone cannot
-- do, because they live in the auth schema and are managed through the
-- Auth API.
--
-- This file is here for the case where you cannot run the application:
-- you have SQL access and nothing else.
--
-- WHAT IT DOES
--   Removes the demonstration organization and every row belonging to
--   it. Scoped by the slug 'gab-premium-ent-demo' throughout.
--
-- WHAT IT NEVER TOUCHES
--   The schema, migrations, functions, triggers, views, row level
--   security, grants, storage configuration, or any other organization.
--
-- WHAT IT CANNOT DO
--   Delete the Supabase Auth users. Their profiles go, but the accounts
--   remain in Authentication -> Users and must be deleted there, or by
--   `npm run production:clean`. An auth user with no profile cannot sign
--   in - the sign-in path requires an active profile - so this is untidy
--   rather than unsafe.
--
-- HOW TO RUN IT
--   1. Run the SELECT block below on its own first. It changes nothing
--      and shows you exactly what would go.
--   2. Read it. If it names anything real, stop.
--   3. Then run the DO block.
--
--
-- ===================================================================
-- STEP 1 - WHAT WOULD BE REMOVED  (safe, reads only)
-- ===================================================================

with demo as (
  select id, name from public.organizations where slug = 'gab-premium-ent-demo'
)
select 'organization'   as what, (select name from demo)                                as detail,
       (select count(*) from demo)                                                       as rows
union all select 'staff',        '', (select count(*) from public.profiles     where org_id = (select id from demo))
union all select 'customers',    '', (select count(*) from public.customers    where org_id = (select id from demo))
union all select 'suppliers',    '', (select count(*) from public.suppliers    where org_id = (select id from demo))
union all select 'products',     '', (select count(*) from public.products     where org_id = (select id from demo))
union all select 'warehouses',   '', (select count(*) from public.warehouses   where org_id = (select id from demo))
union all select 'vans',         '', (select count(*) from public.vans         where org_id = (select id from demo))
union all select 'sales',        '', (select count(*) from public.van_sales    where org_id = (select id from demo))
union all select 'invoices',     '', (select count(*) from public.invoices     where org_id = (select id from demo))
union all select 'receipts',     '', (select count(*) from public.payments     where org_id = (select id from demo))
union all select 'stock moves',  '', (select count(*) from public.stock_movements where org_id = (select id from demo))
union all select 'purchases',    '', (select count(*) from public.purchase_orders  where org_id = (select id from demo))
union all select 'audit rows',   '', (select count(*) from public.audit_log    where org_id = (select id from demo))
union all select 'OTHER ORGS (untouched)', '',
       (select count(*) from public.organizations where slug <> 'gab-premium-ent-demo');


-- ===================================================================
-- STEP 2 - REMOVE IT
-- ===================================================================
--
-- Everything below runs in one transaction: it removes all of the
-- demonstration data or none of it.

do $clean$
declare
  demo_org uuid;
  latest   timestamptz;
  strays   bigint;
  tbl      text;
  removed  bigint := 0;
  n        bigint;
begin
  select id into demo_org from public.organizations where slug = 'gab-premium-ent-demo';

  if demo_org is null then
    raise notice 'Nothing to remove: no organization with the slug gab-premium-ent-demo.';
    return;
  end if;

  -- The same guard the script applies: every account is classified, and
  -- this refuses only on ones it cannot place.
  --
  -- Asking "was this created by the seed" is not enough. The hosted test
  -- suites leave accounts behind that look exactly like real people, so
  -- that question refuses for ever on a database holding nothing but
  -- test data - and the refusal can never be cleared.
  select count(*) into strays
    from public.profiles
   where org_id = demo_org
     -- Created by the demo seed.
     and coalesce(email, '') not like '%@demo.invalid'
     -- Left behind by a hosted test run. Address and name together:
     -- either alone is too loose to be safe.
     and not (
       coalesce(email, '') ~* '@example\.(com|org|net)$'
       and trim(coalesce(full_name, '')) ~* '^(offline tester|flow tester|visual (audit|tester))$'
     );

  if strays > 0 then
    raise exception
      'Refused: % account(s) in the demonstration organization are neither '
      'demo-seed nor test-harness accounts. If any of them is a real person, '
      'this is not demonstration data. Nothing has been removed.', strays;
  end if;

  -- A recent sale only means something if somebody unaccounted-for could
  -- have made it, and by here nobody is unaccounted-for.
  select max(sold_at) into latest from public.van_sales where org_id = demo_org;

  if latest is not null and latest > now() - interval '1 day' then
    raise notice
      'Note: the most recent sale here was %. Every account is a demo or test '
      'account, so this is a test rather than trading.', latest;
  end if;

  -- Children before parents. Several of these references are ON DELETE
  -- RESTRICT deliberately, so a tenant cannot be removed while its
  -- history still points at it.
  foreach tbl in array array[
    'notifications',
    'van_load_crew',
    'van_reconciliations', 'van_return_items', 'van_returns',
    'van_sale_payments', 'van_sale_items', 'van_sales',
    'credit_transactions',
    'van_load_items', 'van_loads', 'van_assignments', 'van_inventory', 'vans',
    'waybill_items', 'waybills',
    'stock_return_items', 'stock_returns',
    'stock_transfer_items', 'stock_transfers',
    'payments', 'invoices', 'sales_order_items', 'sales_orders',
    'supplier_documents', 'supplier_portal_tokens',
    'purchase_order_items', 'purchase_orders',
    'product_batches',
    'stock_movements', 'inventory',
    'manager_category_scopes', 'products', 'categories',
    'customers', 'suppliers', 'warehouses',
    'audit_log'
  ]
  loop
    -- A table the schema does not have yet is skipped rather than
    -- fatal: this file may be run against a database that is behind.
    if to_regclass('public.' || tbl) is null then
      continue;
    end if;

    execute format('delete from public.%I where org_id = $1', tbl) using demo_org;
    get diagnostics n = row_count;
    removed := removed + n;

    if n > 0 then
      raise notice '  % : % row(s)', tbl, n;
    end if;
  end loop;

  -- Sign-in attempts belong to a person rather than an organization.
  delete from public.auth_pin_attempts
   where profile_id in (select id from public.profiles where org_id = demo_org);

  -- Profiles last of the rows, then the organization itself.
  delete from public.profiles where org_id = demo_org;
  get diagnostics n = row_count;
  removed := removed + n;
  raise notice '  profiles : % row(s)', n;

  delete from public.organizations where id = demo_org;

  raise notice '';
  raise notice 'Removed % row(s). No other organization was touched.', removed;
  raise notice '';
  raise notice 'The Supabase Auth accounts still exist. Delete them under';
  raise notice 'Authentication -> Users, or run: npm run production:clean';
end
$clean$;


-- ===================================================================
-- STEP 3 - CONFIRM
-- ===================================================================

select
  case when exists (select 1 from public.organizations where slug = 'gab-premium-ent-demo')
       then 'FAIL' else 'PASS' end                                as demo_organization_gone,
  (select count(*) from public.organizations)                     as organizations_remaining,
  (select count(*) from public.profiles where is_active)          as staff_who_can_sign_in,
  (select count(*) from public.products where sku like 'DEMO-%')  as demo_products_left,
  (select count(*) from public.customers where code like 'DEMO-%') as demo_customers_left;
