-- =====================================================================
-- 0007_rls.sql
-- Row level security. Every table is locked by default; access is
-- granted per role via public.has_role() from 0001_foundation.sql.
--
-- Role summary
--   admin       full access
--   manager     full operational access, no user administration
--   sales_rep   catalogue + customers read, owns their sales orders
--   warehouse   catalogue read, stock movements, order fulfilment
--   accountant  invoices, payments, customer financials
-- =====================================================================

alter table public.profiles            enable row level security;
alter table public.customers           enable row level security;
alter table public.suppliers           enable row level security;
alter table public.categories          enable row level security;
alter table public.warehouses          enable row level security;
alter table public.products            enable row level security;
alter table public.inventory           enable row level security;
alter table public.stock_movements     enable row level security;
alter table public.sales_orders        enable row level security;
alter table public.sales_order_items   enable row level security;
alter table public.invoices            enable row level security;
alter table public.payments            enable row level security;
alter table public.purchase_orders     enable row level security;
alter table public.purchase_order_items enable row level security;

-- ------------------------------------------------------------ profiles
create policy profiles_select_self on public.profiles
  for select using (id = auth.uid() or public.has_role('admin', 'manager'));

create policy profiles_update_self on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and role = public.auth_role());  -- cannot self-promote

create policy profiles_admin_all on public.profiles
  for all using (public.has_role('admin'))
  with check (public.has_role('admin'));

-- ------------------------------------------------------- master data
-- Any active staff member may read the catalogue and partner lists.
create policy categories_read on public.categories
  for select using (public.is_staff());
create policy categories_write on public.categories
  for all using (public.has_role('admin', 'manager'))
  with check (public.has_role('admin', 'manager'));

create policy warehouses_read on public.warehouses
  for select using (public.is_staff());
create policy warehouses_write on public.warehouses
  for all using (public.has_role('admin', 'manager'))
  with check (public.has_role('admin', 'manager'));

create policy products_read on public.products
  for select using (public.is_staff());
create policy products_write on public.products
  for all using (public.has_role('admin', 'manager'))
  with check (public.has_role('admin', 'manager'));

create policy customers_read on public.customers
  for select using (public.is_staff());
create policy customers_write on public.customers
  for all using (public.has_role('admin', 'manager', 'sales_rep'))
  with check (public.has_role('admin', 'manager', 'sales_rep'));

create policy suppliers_read on public.suppliers
  for select using (public.is_staff());
create policy suppliers_write on public.suppliers
  for all using (public.has_role('admin', 'manager'))
  with check (public.has_role('admin', 'manager'));

-- ------------------------------------------------------------ stock
create policy inventory_read on public.inventory
  for select using (public.is_staff());
create policy inventory_write on public.inventory
  for all using (public.has_role('admin', 'manager', 'warehouse'))
  with check (public.has_role('admin', 'manager', 'warehouse'));

create policy stock_movements_read on public.stock_movements
  for select using (public.is_staff());
create policy stock_movements_insert on public.stock_movements
  for insert with check (public.has_role('admin', 'manager', 'warehouse'));

-- ------------------------------------------------------ sales orders
-- Sales reps see and edit their own orders; everyone else operational
-- sees all of them.
create policy sales_orders_read on public.sales_orders
  for select using (
    public.has_role('admin', 'manager', 'warehouse', 'accountant')
    or created_by = auth.uid()
  );

create policy sales_orders_insert on public.sales_orders
  for insert with check (
    public.has_role('admin', 'manager', 'sales_rep')
    and created_by = auth.uid()
  );

create policy sales_orders_update on public.sales_orders
  for update using (
    public.has_role('admin', 'manager', 'warehouse')
    or (public.has_role('sales_rep') and created_by = auth.uid() and status = 'draft')
  );

create policy sales_orders_delete on public.sales_orders
  for delete using (
    public.has_role('admin')
    or (public.has_role('manager', 'sales_rep') and status = 'draft'
        and created_by = auth.uid())
  );

-- Line items inherit their parent order's visibility.
create policy sales_order_items_read on public.sales_order_items
  for select using (
    exists (select 1 from public.sales_orders o where o.id = order_id)
  );

create policy sales_order_items_write on public.sales_order_items
  for all using (
    exists (
      select 1 from public.sales_orders o
      where o.id = order_id
        and (public.has_role('admin', 'manager')
             or (o.created_by = auth.uid() and o.status = 'draft'))
    )
  )
  with check (
    exists (
      select 1 from public.sales_orders o
      where o.id = order_id
        and (public.has_role('admin', 'manager')
             or (o.created_by = auth.uid() and o.status = 'draft'))
    )
  );

-- ------------------------------------------------------- receivables
create policy invoices_read on public.invoices
  for select using (
    public.has_role('admin', 'manager', 'accountant')
    or exists (select 1 from public.sales_orders o
               where o.id = order_id and o.created_by = auth.uid())
  );

create policy invoices_write on public.invoices
  for all using (public.has_role('admin', 'manager', 'accountant'))
  with check (public.has_role('admin', 'manager', 'accountant'));

create policy payments_read on public.payments
  for select using (public.has_role('admin', 'manager', 'accountant'));

create policy payments_write on public.payments
  for all using (public.has_role('admin', 'manager', 'accountant'))
  with check (public.has_role('admin', 'manager', 'accountant'));

-- --------------------------------------------------------- purchasing
create policy purchase_orders_read on public.purchase_orders
  for select using (public.has_role('admin', 'manager', 'warehouse', 'accountant'));

create policy purchase_orders_write on public.purchase_orders
  for all using (public.has_role('admin', 'manager'))
  with check (public.has_role('admin', 'manager'));

create policy purchase_order_items_read on public.purchase_order_items
  for select using (
    exists (select 1 from public.purchase_orders p where p.id = po_id)
  );

create policy purchase_order_items_write on public.purchase_order_items
  for all using (public.has_role('admin', 'manager'))
  with check (public.has_role('admin', 'manager'));

-- ------------------------------------------------- role escalation guard
-- Belt and braces alongside profiles_update_self: only an admin may ever
-- change a role or reactivate an account, whatever the policies allow.
create or replace function public.guard_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- auth.uid() is null for the SQL editor, service_role and cron jobs;
  -- those are trusted server-side contexts and are left alone.
  if auth.uid() is not null
     and (new.role is distinct from old.role
          or new.is_active is distinct from old.is_active)
     and not public.has_role('admin') then
    raise exception 'Only an administrator may change a user role or status';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_role_change
  before update on public.profiles
  for each row execute function public.guard_role_change();
