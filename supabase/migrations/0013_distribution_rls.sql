-- =====================================================================
-- 0013_distribution_rls.sql
-- Row level security for van operations, plus the manager category
-- scopes and driver product restriction promised by the business rules.
-- =====================================================================

alter table public.vans                    enable row level security;
alter table public.van_assignments         enable row level security;
alter table public.van_inventory           enable row level security;
alter table public.van_loads               enable row level security;
alter table public.van_load_items          enable row level security;
alter table public.van_sales               enable row level security;
alter table public.van_sale_items          enable row level security;
alter table public.van_returns             enable row level security;
alter table public.van_return_items        enable row level security;
alter table public.van_reconciliations     enable row level security;
alter table public.credit_transactions     enable row level security;
alter table public.manager_category_scopes enable row level security;
alter table public.stock_transfers         enable row level security;
alter table public.stock_transfer_items    enable row level security;

-- ================================================================
-- Product visibility: managers are limited to their granted
-- categories, drivers to what is physically on their van.
-- ================================================================

-- Existing managers keep the access they had before scopes existed;
-- newly created managers must be granted categories explicitly.
insert into public.manager_category_scopes (org_id, profile_id, category_id)
select p.org_id, p.id, c.id
from public.profiles p
join public.categories c on c.org_id = p.org_id
where p.role = 'manager'
on conflict do nothing;

drop policy products_read on public.products;
create policy products_read on public.products
  for select using (
    org_id = public.auth_org_id()
    and public.can_access_product(id)
  );

drop policy products_write on public.products;
create policy products_write on public.products
  for all using (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager')
    and public.can_access_product(id)
  )
  with check (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager')
    and (category_id is null or public.can_access_category(category_id))
  );

drop policy categories_read on public.categories;
create policy categories_read on public.categories
  for select using (
    org_id = public.auth_org_id()
    and public.can_access_category(id)
  );

-- senior_manager inherits every policy that named 'manager' before it
-- existed, so those policies are widened here.
drop policy categories_write on public.categories;
create policy categories_write on public.categories
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'senior_manager'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager'));

create policy manager_scopes_read on public.manager_category_scopes
  for select using (
    org_id = public.auth_org_id()
    and (profile_id = auth.uid() or public.has_role('admin', 'senior_manager'))
  );

-- Only admins and senior managers grant scopes: a scoped manager must not
-- be able to widen their own access.
create policy manager_scopes_write on public.manager_category_scopes
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'senior_manager'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager'));

-- ================================================================
-- Vans and assignments
-- ================================================================

create policy vans_read on public.vans
  for select using (
    org_id = public.auth_org_id()
    and (not public.has_role('driver') or id = public.my_van_id())
  );

create policy vans_write on public.vans
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'senior_manager', 'manager'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager', 'manager'));

create policy van_assignments_read on public.van_assignments
  for select using (
    org_id = public.auth_org_id()
    and (driver_id = auth.uid()
         or public.has_role('admin', 'senior_manager', 'manager', 'warehouse'))
  );

-- A driver must never assign themselves a van.
create policy van_assignments_write on public.van_assignments
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'senior_manager', 'manager'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager', 'manager'));

create policy van_inventory_read on public.van_inventory
  for select using (
    org_id = public.auth_org_id()
    and (not public.has_role('driver') or van_id = public.my_van_id())
  );

-- Van stock is derived from the ledger; nobody edits it directly.
create policy van_inventory_write on public.van_inventory
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'senior_manager'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager'));

-- ================================================================
-- Loading
-- ================================================================

create policy van_loads_read on public.van_loads
  for select using (
    org_id = public.auth_org_id()
    and (driver_id = auth.uid()
         or public.has_role('admin', 'senior_manager', 'manager', 'warehouse', 'accountant'))
  );

create policy van_loads_write on public.van_loads
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'senior_manager', 'manager', 'warehouse'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager', 'manager', 'warehouse'));

-- The driver confirms receipt of their own load, and nothing else on it.
create policy van_loads_driver_confirm on public.van_loads
  for update using (org_id = public.auth_org_id()
                    and driver_id = auth.uid()
                    and status = 'loaded')
  with check (org_id = public.auth_org_id() and driver_id = auth.uid());

create policy van_load_items_read on public.van_load_items
  for select using (
    org_id = public.auth_org_id()
    and exists (select 1 from public.van_loads l where l.id = load_id)
  );

create policy van_load_items_write on public.van_load_items
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'senior_manager', 'manager', 'warehouse'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager', 'manager', 'warehouse'));

-- ================================================================
-- Van sales
-- ================================================================

create policy van_sales_read on public.van_sales
  for select using (
    org_id = public.auth_org_id()
    and (driver_id = auth.uid()
         or public.has_role('admin', 'senior_manager', 'manager', 'accountant'))
  );

-- A driver may only sell from the van they are actually assigned to.
create policy van_sales_driver_insert on public.van_sales
  for insert with check (
    org_id = public.auth_org_id()
    and public.has_role('driver')
    and driver_id = auth.uid()
    and van_id = public.my_van_id()
  );

create policy van_sales_driver_update on public.van_sales
  for update using (
    org_id = public.auth_org_id()
    and public.has_role('driver')
    and driver_id = auth.uid()
    and status = 'draft'
  );

create policy van_sales_manage on public.van_sales
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'senior_manager', 'manager'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager', 'manager'));

create policy van_sale_items_read on public.van_sale_items
  for select using (
    org_id = public.auth_org_id()
    and exists (select 1 from public.van_sales s where s.id = sale_id)
  );

create policy van_sale_items_write on public.van_sale_items
  for all using (
    org_id = public.auth_org_id()
    and exists (
      select 1 from public.van_sales s
      where s.id = sale_id
        and (public.has_role('admin', 'senior_manager', 'manager')
             or (s.driver_id = auth.uid() and s.status = 'draft'))
    )
  )
  with check (
    org_id = public.auth_org_id()
    and exists (
      select 1 from public.van_sales s
      where s.id = sale_id
        and (public.has_role('admin', 'senior_manager', 'manager')
             or (s.driver_id = auth.uid() and s.status = 'draft'))
    )
  );

-- ================================================================
-- Credit
-- ================================================================

create policy credit_transactions_read on public.credit_transactions
  for select using (
    org_id = public.auth_org_id()
    and (public.has_role('admin', 'senior_manager', 'manager', 'accountant')
         or created_by = auth.uid())
  );

-- Drivers record collections in the field; nobody edits history afterwards.
create policy credit_transactions_insert on public.credit_transactions
  for insert with check (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'accountant', 'driver')
  );

create policy credit_transactions_manage on public.credit_transactions
  for update using (org_id = public.auth_org_id()
                    and public.has_role('admin', 'senior_manager', 'accountant'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager', 'accountant'));

-- ================================================================
-- Returns
-- ================================================================

create policy van_returns_read on public.van_returns
  for select using (
    org_id = public.auth_org_id()
    and (driver_id = auth.uid()
         or public.has_role('admin', 'senior_manager', 'manager', 'warehouse', 'accountant'))
  );

create policy van_returns_driver on public.van_returns
  for insert with check (
    org_id = public.auth_org_id()
    and public.has_role('driver')
    and driver_id = auth.uid()
  );

create policy van_returns_driver_update on public.van_returns
  for update using (
    org_id = public.auth_org_id()
    and public.has_role('driver')
    and driver_id = auth.uid()
    and status = 'draft'
  );

create policy van_returns_manage on public.van_returns
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'senior_manager', 'manager', 'warehouse'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager', 'manager', 'warehouse'));

create policy van_return_items_read on public.van_return_items
  for select using (
    org_id = public.auth_org_id()
    and exists (select 1 from public.van_returns r where r.id = return_id)
  );

create policy van_return_items_write on public.van_return_items
  for all using (
    org_id = public.auth_org_id()
    and exists (
      select 1 from public.van_returns r
      where r.id = return_id
        and (public.has_role('admin', 'senior_manager', 'manager', 'warehouse')
             or (r.driver_id = auth.uid() and r.status = 'draft'))
    )
  )
  with check (
    org_id = public.auth_org_id()
    and exists (
      select 1 from public.van_returns r
      where r.id = return_id
        and (public.has_role('admin', 'senior_manager', 'manager', 'warehouse')
             or (r.driver_id = auth.uid() and r.status = 'draft'))
    )
  );

-- ================================================================
-- Reconciliation
-- ================================================================

create policy van_reconciliations_read on public.van_reconciliations
  for select using (
    org_id = public.auth_org_id()
    and (driver_id = auth.uid()
         or public.has_role('admin', 'senior_manager', 'manager', 'accountant'))
  );

-- A driver may submit their own reconciliation, but only while it is a
-- draft: once submitted the numbers are out of their hands.
create policy van_reconciliations_driver on public.van_reconciliations
  for update using (
    org_id = public.auth_org_id()
    and public.has_role('driver')
    and driver_id = auth.uid()
    and status = 'draft'
  )
  with check (
    org_id = public.auth_org_id()
    and driver_id = auth.uid()
    and status in ('draft', 'submitted')
  );

create policy van_reconciliations_manage on public.van_reconciliations
  for all using (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'accountant')
  )
  with check (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'accountant')
    -- Belt and braces with the table's check constraint.
    and (approved_by is null or approved_by <> driver_id)
  );

-- ================================================================
-- Transfers
-- ================================================================

create policy stock_transfers_read on public.stock_transfers
  for select using (org_id = public.auth_org_id());

create policy stock_transfers_write on public.stock_transfers
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'senior_manager', 'manager', 'warehouse'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager', 'manager', 'warehouse'));

create policy stock_transfer_items_read on public.stock_transfer_items
  for select using (
    org_id = public.auth_org_id()
    and exists (select 1 from public.stock_transfers t where t.id = transfer_id)
  );

create policy stock_transfer_items_write on public.stock_transfer_items
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'senior_manager', 'manager', 'warehouse'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager', 'manager', 'warehouse'));

-- ================================================================
-- Widen existing policies to include senior_manager and let drivers
-- see the customers and stock they need to do their job.
-- ================================================================

drop policy customers_write on public.customers;
create policy customers_write on public.customers
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'senior_manager', 'manager', 'sales_rep', 'driver'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager', 'manager', 'sales_rep', 'driver'));

drop policy warehouses_write on public.warehouses;
create policy warehouses_write on public.warehouses
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'senior_manager', 'manager'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager', 'manager'));

-- Drivers have no business writing warehouse stock.
drop policy inventory_write on public.inventory;
create policy inventory_write on public.inventory
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'senior_manager', 'manager', 'warehouse'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager', 'manager', 'warehouse'));

drop policy stock_movements_insert on public.stock_movements;
create policy stock_movements_insert on public.stock_movements
  for insert with check (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'warehouse')
  );

drop policy profiles_admin_manage on public.profiles;
create policy profiles_admin_manage on public.profiles
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'senior_manager'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager'));
