-- =====================================================================
-- 0011_distribution_operations.sql
-- Van-based distribution: vans, drivers, loading, van sales, returns,
-- and end-of-day cash/stock reconciliation.
--
-- The stock ledger from 0003 is generalised rather than duplicated: a
-- movement now happens at exactly one location, which is either a
-- warehouse or a van. Van stock is therefore derived from the same
-- append-only ledger as warehouse stock.
-- =====================================================================

create type public.van_load_status as enum (
  'draft', 'loaded', 'dispatched', 'returned', 'reconciled', 'cancelled'
);

create type public.van_sale_type as enum ('cash', 'credit');

create type public.van_sale_status as enum ('draft', 'completed', 'void');

create type public.van_return_status as enum (
  'draft', 'submitted', 'approved', 'rejected'
);

create type public.reconciliation_status as enum (
  'draft', 'submitted', 'approved', 'rejected', 'settled'
);

create type public.credit_txn_type as enum (
  'charge', 'payment', 'adjustment', 'write_off'
);

create sequence public.van_load_seq        start 1000;
create sequence public.van_sale_seq        start 1000;
create sequence public.van_return_seq      start 1000;
create sequence public.reconciliation_seq  start 1000;
create sequence public.stock_transfer_seq  start 1000;

-- ===================================================================
-- Vans and drivers
-- ===================================================================

create table public.vans (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete restrict,
  code           text not null,
  registration_no text not null,
  make           text,
  model          text,
  capacity_kg    numeric(10,2) check (capacity_kg is null or capacity_kg > 0),
  home_warehouse_id uuid references public.warehouses (id) on delete set null,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (org_id, code),
  unique (org_id, registration_no)
);

create index vans_org_idx on public.vans (org_id) where is_active;

-- Assignment history. The open row (unassigned_at is null) is current.
create table public.van_assignments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete restrict,
  van_id        uuid not null references public.vans (id) on delete cascade,
  driver_id     uuid not null references public.profiles (id) on delete restrict,
  assigned_at   timestamptz not null default now(),
  unassigned_at timestamptz,
  assigned_by   uuid references public.profiles (id),
  notes         text,
  check (unassigned_at is null or unassigned_at >= assigned_at)
);

-- A van has at most one active driver, and a driver at most one active van.
create unique index van_assignments_one_active_van
  on public.van_assignments (van_id) where unassigned_at is null;
create unique index van_assignments_one_active_driver
  on public.van_assignments (driver_id) where unassigned_at is null;

create index van_assignments_driver_idx on public.van_assignments (driver_id);

-- Convenience: the van the calling user currently drives.
create or replace function public.my_van_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select van_id from public.van_assignments
  where driver_id = auth.uid() and unassigned_at is null
  limit 1
$$;

-- ===================================================================
-- Van stock, on the same ledger as warehouse stock
-- ===================================================================

create table public.van_inventory (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete restrict,
  van_id       uuid not null references public.vans (id) on delete cascade,
  product_id   uuid not null references public.products (id) on delete restrict,
  qty_on_hand  integer not null default 0,
  updated_at   timestamptz not null default now(),
  unique (van_id, product_id)
);

create index van_inventory_van_idx on public.van_inventory (van_id);

-- A movement is now located at a warehouse OR a van, never both.
alter table public.stock_movements
  add column van_id uuid references public.vans (id) on delete restrict;

alter table public.stock_movements
  alter column warehouse_id drop not null;

alter table public.stock_movements
  add constraint stock_movements_one_location check (
    (warehouse_id is not null and van_id is null)
    or (warehouse_id is null and van_id is not null)
  );

create index stock_movements_van_idx on public.stock_movements (van_id, created_at desc);

-- Damage and shortage both remove stock from wherever they are recorded.
create or replace function public.movement_direction(t public.movement_type)
returns integer
language sql
immutable
as $$
  select case t
    when 'receipt'          then  1
    when 'transfer_in'      then  1
    when 'customer_return'  then  1
    when 'adjustment_in'    then  1
    when 'issue'            then -1
    when 'transfer_out'     then -1
    when 'supplier_return'  then -1
    when 'adjustment_out'   then -1
    when 'damage'           then -1
    when 'shortage'         then -1
  end
$$;

-- Route the movement to warehouse inventory or van inventory.
create or replace function public.apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  delta integer;
begin
  delta := public.movement_direction(new.type) * new.quantity;

  if new.warehouse_id is not null then
    insert into public.inventory (org_id, product_id, warehouse_id, qty_on_hand)
    values (new.org_id, new.product_id, new.warehouse_id, delta)
    on conflict (product_id, warehouse_id) do update
      set qty_on_hand = public.inventory.qty_on_hand + delta,
          updated_at  = now();
  else
    insert into public.van_inventory (org_id, van_id, product_id, qty_on_hand)
    values (new.org_id, new.van_id, new.product_id, delta)
    on conflict (van_id, product_id) do update
      set qty_on_hand = public.van_inventory.qty_on_hand + delta,
          updated_at  = now();
  end if;

  return new;
end;
$$;

-- ===================================================================
-- Warehouse to warehouse transfers (the missing transfer document)
-- ===================================================================

create table public.stock_transfers (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete restrict,
  transfer_number text not null unique
                  default public.next_document_number('TRF', 'public.stock_transfer_seq'),
  from_warehouse_id uuid not null references public.warehouses (id) on delete restrict,
  to_warehouse_id   uuid not null references public.warehouses (id) on delete restrict,
  status          text not null default 'draft'
                  check (status in ('draft','in_transit','received','cancelled')),
  transfer_date   date not null default current_date,
  notes           text,
  created_by      uuid references public.profiles (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (from_warehouse_id <> to_warehouse_id)
);

create table public.stock_transfer_items (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete restrict,
  transfer_id uuid not null references public.stock_transfers (id) on delete cascade,
  product_id  uuid not null references public.products (id) on delete restrict,
  quantity    integer not null check (quantity > 0),
  unique (transfer_id, product_id)
);

-- ===================================================================
-- Van loading
-- ===================================================================

create table public.van_loads (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete restrict,
  load_number   text not null unique
                default public.next_document_number('LOAD', 'public.van_load_seq'),
  van_id        uuid not null references public.vans (id) on delete restrict,
  driver_id     uuid not null references public.profiles (id) on delete restrict,
  warehouse_id  uuid not null references public.warehouses (id) on delete restrict,
  status        public.van_load_status not null default 'draft',
  load_date     date not null default current_date,
  dispatched_at timestamptz,
  -- The driver signs for the goods; without this the load cannot dispatch.
  driver_confirmed_at timestamptz,
  opening_float numeric(14,2) not null default 0 check (opening_float >= 0),
  notes         text,
  loaded_by     uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index van_loads_van_idx on public.van_loads (van_id, load_date desc);
create index van_loads_driver_idx on public.van_loads (driver_id, load_date desc);
create index van_loads_status_idx on public.van_loads (status);

-- One open load per van at a time.
create unique index van_loads_one_open_per_van
  on public.van_loads (van_id)
  where status in ('loaded', 'dispatched');

create table public.van_load_items (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete restrict,
  load_id      uuid not null references public.van_loads (id) on delete cascade,
  product_id   uuid not null references public.products (id) on delete restrict,
  qty_loaded   integer not null check (qty_loaded > 0),
  -- Selling price fixed at load time so the driver cannot discount freely.
  unit_price   numeric(14,2) not null check (unit_price >= 0),
  unit_cost    numeric(14,2) not null default 0 check (unit_cost >= 0),
  created_at   timestamptz not null default now(),
  unique (load_id, product_id)
);

create index van_load_items_load_idx on public.van_load_items (load_id);

-- ===================================================================
-- Van sales
-- ===================================================================

create table public.van_sales (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete restrict,
  sale_number  text not null unique
               default public.next_document_number('VS', 'public.van_sale_seq'),
  load_id      uuid not null references public.van_loads (id) on delete restrict,
  van_id       uuid not null references public.vans (id) on delete restrict,
  driver_id    uuid not null references public.profiles (id) on delete restrict,
  customer_id  uuid not null references public.customers (id) on delete restrict,
  sale_type    public.van_sale_type not null,
  status       public.van_sale_status not null default 'draft',
  sold_at      timestamptz not null default now(),
  subtotal     numeric(14,2) not null default 0,
  tax_total    numeric(14,2) not null default 0,
  total        numeric(14,2) not null default 0,
  amount_paid  numeric(14,2) not null default 0 check (amount_paid >= 0),
  balance      numeric(14,2) generated always as (total - amount_paid) stored,
  due_date     date,
  latitude     numeric(9,6),
  longitude    numeric(9,6),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index van_sales_load_idx on public.van_sales (load_id);
create index van_sales_customer_idx on public.van_sales (customer_id, sold_at desc);
create index van_sales_driver_idx on public.van_sales (driver_id, sold_at desc);

create table public.van_sale_items (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete restrict,
  sale_id      uuid not null references public.van_sales (id) on delete cascade,
  product_id   uuid not null references public.products (id) on delete restrict,
  quantity     integer not null check (quantity > 0),
  unit_price   numeric(14,2) not null check (unit_price >= 0),
  discount_pct numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  tax_rate     numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  line_subtotal numeric(14,2) generated always as
                 (round(quantity * unit_price * (1 - discount_pct / 100), 2)) stored,
  line_total   numeric(14,2) generated always as
                 (round(quantity * unit_price * (1 - discount_pct / 100)
                        * (1 + tax_rate / 100), 2)) stored,
  created_at   timestamptz not null default now(),
  unique (sale_id, product_id)
);

create index van_sale_items_sale_idx on public.van_sale_items (sale_id);

-- ===================================================================
-- Customer credit ledger
-- ===================================================================

create table public.credit_transactions (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete restrict,
  customer_id    uuid not null references public.customers (id) on delete restrict,
  type           public.credit_txn_type not null,
  -- Positive increases what the customer owes, negative reduces it.
  amount         numeric(14,2) not null check (amount <> 0),
  reference_type text,
  reference_id   uuid,
  due_date       date,
  occurred_at    timestamptz not null default now(),
  created_by     uuid references public.profiles (id),
  notes          text
);

create index credit_transactions_customer_idx
  on public.credit_transactions (customer_id, occurred_at desc);

-- ===================================================================
-- Van returns
-- ===================================================================

create table public.van_returns (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete restrict,
  return_number text not null unique
                default public.next_document_number('VR', 'public.van_return_seq'),
  load_id       uuid not null references public.van_loads (id) on delete restrict,
  van_id        uuid not null references public.vans (id) on delete restrict,
  driver_id     uuid not null references public.profiles (id) on delete restrict,
  warehouse_id  uuid not null references public.warehouses (id) on delete restrict,
  status        public.van_return_status not null default 'draft',
  returned_at   timestamptz not null default now(),
  received_by   uuid references public.profiles (id),
  approved_by   uuid references public.profiles (id),
  approved_at   timestamptz,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (load_id)
);

create table public.van_return_items (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations (id) on delete restrict,
  return_id          uuid not null references public.van_returns (id) on delete cascade,
  product_id         uuid not null references public.products (id) on delete restrict,
  -- What the system says should still be on the van.
  qty_expected       integer not null check (qty_expected >= 0),
  qty_returned_good  integer not null default 0 check (qty_returned_good >= 0),
  qty_damaged        integer not null default 0 check (qty_damaged >= 0),
  qty_missing        integer generated always as
                       (qty_expected - qty_returned_good - qty_damaged) stored,
  damage_reason      text,
  created_at         timestamptz not null default now(),
  unique (return_id, product_id)
);

create index van_return_items_return_idx on public.van_return_items (return_id);

-- ===================================================================
-- End-of-day reconciliation
-- ===================================================================

create table public.van_reconciliations (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete restrict,
  recon_number   text not null unique
                 default public.next_document_number('REC', 'public.reconciliation_seq'),
  load_id        uuid not null references public.van_loads (id) on delete restrict,
  van_id         uuid not null references public.vans (id) on delete restrict,
  driver_id      uuid not null references public.profiles (id) on delete restrict,
  status         public.reconciliation_status not null default 'draft',

  -- Cash side: float plus cash sales is what the driver should hand in.
  opening_float    numeric(14,2) not null default 0,
  cash_sales_total numeric(14,2) not null default 0,
  credit_sales_total numeric(14,2) not null default 0,
  collections_total  numeric(14,2) not null default 0,
  expected_cash    numeric(14,2) not null default 0,
  actual_cash      numeric(14,2) not null default 0 check (actual_cash >= 0),
  cash_variance    numeric(14,2) generated always as (actual_cash - expected_cash) stored,

  -- Stock side, valued at cost.
  expected_stock_value numeric(14,2) not null default 0,
  actual_stock_value   numeric(14,2) not null default 0,
  stock_variance       numeric(14,2) generated always as
                         (actual_stock_value - expected_stock_value) stored,
  damaged_value        numeric(14,2) not null default 0,
  missing_value        numeric(14,2) not null default 0,

  explanation      text,
  submitted_by     uuid references public.profiles (id),
  submitted_at     timestamptz,
  approved_by      uuid references public.profiles (id),
  approved_at      timestamptz,
  rejection_reason text,
  settled_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (load_id),

  -- A driver must never sign off their own variance.
  constraint reconciliation_no_self_approval
    check (approved_by is null or approved_by <> driver_id),
  -- An approved reconciliation must name its approver.
  constraint reconciliation_approval_complete
    check (status <> 'approved' or (approved_by is not null and approved_at is not null)),
  -- A rejection must say why.
  constraint reconciliation_rejection_reason
    check (status <> 'rejected' or rejection_reason is not null)
);

create index van_reconciliations_driver_idx
  on public.van_reconciliations (driver_id, created_at desc);
create index van_reconciliations_status_idx on public.van_reconciliations (status);

-- ===================================================================
-- Manager product scopes
-- ===================================================================

create table public.manager_category_scopes (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete restrict,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  granted_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  unique (profile_id, category_id)
);

create index manager_category_scopes_profile_idx
  on public.manager_category_scopes (profile_id);

-- Which product categories the caller may see.
--   admin / senior_manager  -> everything
--   manager                 -> only granted categories
--   driver                  -> only what is on their van right now
--   everyone else           -> everything in their organization
create or replace function public.can_access_category(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.has_role('admin', 'senior_manager') then true
    when public.has_role('manager') then exists (
      select 1 from public.manager_category_scopes s
      where s.profile_id = auth.uid() and s.category_id = target
    )
    when public.auth_role() is null then false
    else true
  end
$$;

create or replace function public.can_access_product(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.has_role('admin', 'senior_manager') then true
    when public.has_role('manager') then exists (
      select 1 from public.products p
      join public.manager_category_scopes s on s.category_id = p.category_id
      where p.id = target and s.profile_id = auth.uid()
    )
    when public.has_role('driver') then exists (
      select 1 from public.van_inventory vi
      where vi.product_id = target and vi.van_id = public.my_van_id()
    )
    when public.auth_role() is null then false
    else true
  end
$$;

create trigger vans_set_updated_at before update on public.vans
  for each row execute function public.set_updated_at();
create trigger van_loads_set_updated_at before update on public.van_loads
  for each row execute function public.set_updated_at();
create trigger van_sales_set_updated_at before update on public.van_sales
  for each row execute function public.set_updated_at();
create trigger van_returns_set_updated_at before update on public.van_returns
  for each row execute function public.set_updated_at();
create trigger van_reconciliations_set_updated_at before update on public.van_reconciliations
  for each row execute function public.set_updated_at();
create trigger stock_transfers_set_updated_at before update on public.stock_transfers
  for each row execute function public.set_updated_at();
