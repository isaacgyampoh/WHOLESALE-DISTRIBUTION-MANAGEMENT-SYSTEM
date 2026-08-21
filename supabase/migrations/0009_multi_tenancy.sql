-- =====================================================================
-- 0009_multi_tenancy.sql
-- Introduces organizations and isolates every existing table by tenant.
--
-- 0001-0008 assumed a single company. This migration backfills all
-- existing rows into one default organization, makes org_id mandatory,
-- rescopes the "global" unique keys to be per-organization, and rebuilds
-- every RLS policy so tenancy is enforced in the database rather than in
-- application query filters.
-- =====================================================================

create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  country     text not null default 'GH',
  currency    text not null default 'GHS',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger organizations_set_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();

insert into public.organizations (name, slug)
values ('Default Organization', 'default');

-- ------------------------------------------------------- add org_id
do $mig$
declare
  t text;
  default_org uuid;
begin
  select id into default_org from public.organizations where slug = 'default';

  -- The ledger's append-only guard would reject this backfill. Suspend it
  -- for the duration of the migration only, then restore it.
  alter table public.stock_movements disable trigger stock_movements_no_update;

  foreach t in array array[
    'profiles','customers','suppliers','categories','warehouses','products',
    'inventory','stock_movements','sales_orders','sales_order_items',
    'invoices','payments','purchase_orders','purchase_order_items'
  ] loop
    execute format('alter table public.%I add column org_id uuid', t);
    execute format('update public.%I set org_id = %L', t, default_org);
    execute format('alter table public.%I alter column org_id set not null', t);
    execute format(
      'alter table public.%I add constraint %I foreign key (org_id) '
      'references public.organizations (id) on delete restrict',
      t, t || '_org_id_fkey');
    execute format('create index %I on public.%I (org_id)', t || '_org_idx', t);
  end loop;

  alter table public.stock_movements enable trigger stock_movements_no_update;
end
$mig$;

-- --------------------------------------- rescope uniqueness per tenant
-- A code that is unique globally would let one tenant's data collide with
-- another's, so every business key becomes unique within its organization.
alter table public.customers  drop constraint customers_code_key;
alter table public.customers  add constraint customers_org_code_key unique (org_id, code);

alter table public.suppliers  drop constraint suppliers_code_key;
alter table public.suppliers  add constraint suppliers_org_code_key unique (org_id, code);

alter table public.warehouses drop constraint warehouses_code_key;
alter table public.warehouses add constraint warehouses_org_code_key unique (org_id, code);

alter table public.products   drop constraint products_sku_key;
alter table public.products   add constraint products_org_sku_key unique (org_id, sku);

alter table public.products   drop constraint products_barcode_key;
alter table public.products   add constraint products_org_barcode_key unique (org_id, barcode);

alter table public.categories drop constraint categories_name_parent_id_key;
alter table public.categories add constraint categories_org_name_parent_key
  unique (org_id, name, parent_id);

-- One default warehouse per organization, not one globally.
drop index public.warehouses_single_default_idx;
create unique index warehouses_single_default_idx
  on public.warehouses (org_id) where is_default;

-- ------------------------------------------------------ tenant helper
create or replace function public.auth_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.profiles where id = auth.uid() and is_active
$$;

comment on function public.auth_org_id is
  'Organization of the calling user; null when unauthenticated or disabled.';

-- Keep new signups inside an organization. Supabase Auth cannot know the
-- tenant, so it is taken from user metadata set at invite time.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_org uuid;
begin
  target_org := nullif(new.raw_user_meta_data ->> 'org_id', '')::uuid;

  if target_org is null then
    select id into target_org from public.organizations where slug = 'default';
  end if;

  insert into public.profiles (id, email, full_name, role, org_id)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce((new.raw_user_meta_data ->> 'role')::public.user_role, 'sales_rep'),
    target_org
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- A user must never be moved between organizations by an ordinary update.
create or replace function public.guard_org_change()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null and new.org_id is distinct from old.org_id then
    raise exception 'Organization cannot be changed';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_org_change
  before update on public.profiles
  for each row execute function public.guard_org_change();

-- ----------------------------------------------- rebuild RLS policies
-- Every policy from 0007 is replaced with an org-scoped equivalent.
do $mig$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end
$mig$;

alter table public.organizations enable row level security;

create policy organizations_read on public.organizations
  for select using (id = public.auth_org_id());

-- ------------------------------------------------------------ profiles
create policy profiles_select on public.profiles
  for select using (
    id = auth.uid()
    or (org_id = public.auth_org_id() and public.has_role('admin', 'manager'))
  );

create policy profiles_update_self on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_admin_manage on public.profiles
  for all using (org_id = public.auth_org_id() and public.has_role('admin'))
  with check (org_id = public.auth_org_id() and public.has_role('admin'));

-- --------------------------------------------------------- master data
create policy categories_read on public.categories
  for select using (org_id = public.auth_org_id());
create policy categories_write on public.categories
  for all using (org_id = public.auth_org_id() and public.has_role('admin', 'manager'))
  with check (org_id = public.auth_org_id() and public.has_role('admin', 'manager'));

create policy warehouses_read on public.warehouses
  for select using (org_id = public.auth_org_id());
create policy warehouses_write on public.warehouses
  for all using (org_id = public.auth_org_id() and public.has_role('admin', 'manager'))
  with check (org_id = public.auth_org_id() and public.has_role('admin', 'manager'));

create policy products_read on public.products
  for select using (org_id = public.auth_org_id());
create policy products_write on public.products
  for all using (org_id = public.auth_org_id() and public.has_role('admin', 'manager'))
  with check (org_id = public.auth_org_id() and public.has_role('admin', 'manager'));

create policy customers_read on public.customers
  for select using (org_id = public.auth_org_id());
create policy customers_write on public.customers
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'manager', 'sales_rep'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'manager', 'sales_rep'));

create policy suppliers_read on public.suppliers
  for select using (org_id = public.auth_org_id());
create policy suppliers_write on public.suppliers
  for all using (org_id = public.auth_org_id() and public.has_role('admin', 'manager'))
  with check (org_id = public.auth_org_id() and public.has_role('admin', 'manager'));

-- --------------------------------------------------------------- stock
create policy inventory_read on public.inventory
  for select using (org_id = public.auth_org_id());
create policy inventory_write on public.inventory
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'manager', 'warehouse'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'manager', 'warehouse'));

create policy stock_movements_read on public.stock_movements
  for select using (org_id = public.auth_org_id());
create policy stock_movements_insert on public.stock_movements
  for insert with check (org_id = public.auth_org_id()
                         and public.has_role('admin', 'manager', 'warehouse'));

-- -------------------------------------------------------- sales orders
create policy sales_orders_read on public.sales_orders
  for select using (
    org_id = public.auth_org_id()
    and (public.has_role('admin', 'manager', 'warehouse', 'accountant')
         or created_by = auth.uid())
  );

create policy sales_orders_insert on public.sales_orders
  for insert with check (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'manager', 'sales_rep')
    and created_by = auth.uid()
  );

create policy sales_orders_update on public.sales_orders
  for update using (
    org_id = public.auth_org_id()
    and (public.has_role('admin', 'manager', 'warehouse')
         or (public.has_role('sales_rep') and created_by = auth.uid() and status = 'draft'))
  );

create policy sales_orders_delete on public.sales_orders
  for delete using (
    org_id = public.auth_org_id()
    and (public.has_role('admin')
         or (public.has_role('manager', 'sales_rep') and status = 'draft'
             and created_by = auth.uid()))
  );

create policy sales_order_items_read on public.sales_order_items
  for select using (
    org_id = public.auth_org_id()
    and exists (select 1 from public.sales_orders o where o.id = order_id)
  );

create policy sales_order_items_write on public.sales_order_items
  for all using (
    org_id = public.auth_org_id()
    and exists (
      select 1 from public.sales_orders o
      where o.id = order_id
        and (public.has_role('admin', 'manager')
             or (o.created_by = auth.uid() and o.status = 'draft'))
    )
  )
  with check (
    org_id = public.auth_org_id()
    and exists (
      select 1 from public.sales_orders o
      where o.id = order_id
        and (public.has_role('admin', 'manager')
             or (o.created_by = auth.uid() and o.status = 'draft'))
    )
  );

-- --------------------------------------------------------- receivables
create policy invoices_read on public.invoices
  for select using (
    org_id = public.auth_org_id()
    and (public.has_role('admin', 'manager', 'accountant')
         or exists (select 1 from public.sales_orders o
                    where o.id = order_id and o.created_by = auth.uid()))
  );

create policy invoices_write on public.invoices
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'manager', 'accountant'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'manager', 'accountant'));

create policy payments_read on public.payments
  for select using (org_id = public.auth_org_id()
                    and public.has_role('admin', 'manager', 'accountant'));
create policy payments_write on public.payments
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'manager', 'accountant'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'manager', 'accountant'));

-- ---------------------------------------------------------- purchasing
create policy purchase_orders_read on public.purchase_orders
  for select using (org_id = public.auth_org_id()
                    and public.has_role('admin', 'manager', 'warehouse', 'accountant'));
create policy purchase_orders_write on public.purchase_orders
  for all using (org_id = public.auth_org_id() and public.has_role('admin', 'manager'))
  with check (org_id = public.auth_org_id() and public.has_role('admin', 'manager'));

create policy purchase_order_items_read on public.purchase_order_items
  for select using (
    org_id = public.auth_org_id()
    and exists (select 1 from public.purchase_orders p where p.id = po_id)
  );
create policy purchase_order_items_write on public.purchase_order_items
  for all using (org_id = public.auth_org_id() and public.has_role('admin', 'manager'))
  with check (org_id = public.auth_org_id() and public.has_role('admin', 'manager'));

-- ================================================================
-- org_id backfill on insert
-- Existing triggers (apply_stock_movement, handle_order_status_change,
-- receive_purchase_line) insert child rows without knowing the tenant.
-- Rather than thread org_id through every caller, each table derives it
-- from its parent, falling back to the caller's own organization.
-- ================================================================

create or replace function public.fill_org_from_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Trigger arguments arrive as text, so a table with no parent is
  -- declared by passing no arguments at all rather than a null one.
  parent_col text := case when tg_nargs >= 2 then tg_argv[0] end;
  parent_tbl text := case when tg_nargs >= 2 then tg_argv[1] end;
  parent_id  uuid;
  derived    uuid;
begin
  if new.org_id is not null then
    return new;
  end if;

  if parent_col is not null then
    execute format('select ($1).%I', parent_col) into parent_id using new;
    if parent_id is not null then
      execute format('select org_id from public.%I where id = $1', parent_tbl)
        into derived using parent_id;
    end if;
  end if;

  new.org_id := coalesce(derived, public.auth_org_id());

  if new.org_id is null then
    raise exception 'Cannot determine organization for %', tg_table_name;
  end if;

  return new;
end;
$$;

create trigger inventory_fill_org before insert on public.inventory
  for each row execute function public.fill_org_from_parent('product_id', 'products');
create trigger stock_movements_fill_org before insert on public.stock_movements
  for each row execute function public.fill_org_from_parent('product_id', 'products');
create trigger sales_order_items_fill_org before insert on public.sales_order_items
  for each row execute function public.fill_org_from_parent('order_id', 'sales_orders');
create trigger payments_fill_org before insert on public.payments
  for each row execute function public.fill_org_from_parent('invoice_id', 'invoices');
create trigger purchase_order_items_fill_org before insert on public.purchase_order_items
  for each row execute function public.fill_org_from_parent('po_id', 'purchase_orders');
create trigger sales_orders_fill_org before insert on public.sales_orders
  for each row execute function public.fill_org_from_parent('customer_id', 'customers');
create trigger invoices_fill_org before insert on public.invoices
  for each row execute function public.fill_org_from_parent('customer_id', 'customers');
create trigger purchase_orders_fill_org before insert on public.purchase_orders
  for each row execute function public.fill_org_from_parent('supplier_id', 'suppliers');
create trigger products_fill_org before insert on public.products
  for each row execute function public.fill_org_from_parent();
create trigger customers_fill_org before insert on public.customers
  for each row execute function public.fill_org_from_parent();
create trigger suppliers_fill_org before insert on public.suppliers
  for each row execute function public.fill_org_from_parent();
create trigger categories_fill_org before insert on public.categories
  for each row execute function public.fill_org_from_parent();
create trigger warehouses_fill_org before insert on public.warehouses
  for each row execute function public.fill_org_from_parent();

-- A cross-tenant reference would silently leak data, so reject any row
-- whose parent belongs to a different organization.
create or replace function public.assert_same_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ref_col text := tg_argv[0];
  ref_tbl text := tg_argv[1];
  ref_id  uuid;
  ref_org uuid;
begin
  execute format('select ($1).%I', ref_col) into ref_id using new;
  if ref_id is null then
    return new;
  end if;

  execute format('select org_id from public.%I where id = $1', ref_tbl)
    into ref_org using ref_id;

  if ref_org is not null and ref_org <> new.org_id then
    raise exception 'Cross-organization reference: %.% points at another organization',
      tg_table_name, ref_col;
  end if;

  return new;
end;
$$;

create trigger products_same_org_category before insert or update on public.products
  for each row execute function public.assert_same_org('category_id', 'categories');
create trigger products_same_org_supplier before insert or update on public.products
  for each row execute function public.assert_same_org('supplier_id', 'suppliers');
create trigger sales_orders_same_org_customer before insert or update on public.sales_orders
  for each row execute function public.assert_same_org('customer_id', 'customers');
create trigger sales_orders_same_org_warehouse before insert or update on public.sales_orders
  for each row execute function public.assert_same_org('warehouse_id', 'warehouses');
create trigger sales_order_items_same_org before insert or update on public.sales_order_items
  for each row execute function public.assert_same_org('product_id', 'products');
create trigger stock_movements_same_org_wh before insert on public.stock_movements
  for each row execute function public.assert_same_org('warehouse_id', 'warehouses');
create trigger invoices_same_org_customer before insert or update on public.invoices
  for each row execute function public.assert_same_org('customer_id', 'customers');

-- Views must be org-aware too; security_invoker keeps RLS applied, but the
-- ageing view joins customers directly and is rebuilt here for clarity.
-- Dropped and recreated rather than replaced: org_id is inserted into the
-- middle of the column list, which CREATE OR REPLACE VIEW cannot do.
drop view public.customer_balances;
create view public.customer_balances
with (security_invoker = on) as
  select
    c.id as customer_id, c.org_id, c.code, c.name, c.credit_limit,
    coalesce(sum(i.balance), 0) as outstanding,
    greatest(c.credit_limit - coalesce(sum(i.balance), 0), 0) as credit_available,
    count(i.id) filter (where i.status = 'overdue') as overdue_invoices
  from public.customers c
  left join public.invoices i
    on i.customer_id = c.id
   and i.status in ('issued', 'partially_paid', 'overdue')
  group by c.id, c.org_id, c.code, c.name, c.credit_limit;
