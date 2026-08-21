-- =====================================================================
-- 0003_inventory.sql
-- Catalogue, warehouses, per-location stock, and the movement ledger.
-- Stock levels are never written directly: every change is a row in
-- stock_movements, and a trigger folds it into public.inventory.
-- =====================================================================

create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  parent_id   uuid references public.categories (id) on delete set null,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (name, parent_id)
);

create table public.warehouses (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  address     text,
  city        text,
  is_default  boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- At most one default warehouse.
create unique index warehouses_single_default_idx
  on public.warehouses ((true)) where is_default;

create table public.products (
  id              uuid primary key default gen_random_uuid(),
  sku             text        not null unique,
  barcode         text        unique,
  name            text        not null,
  description     text,
  category_id     uuid        references public.categories (id) on delete set null,
  supplier_id     uuid        references public.suppliers (id) on delete set null,
  unit_of_measure text        not null default 'each',
  -- Wholesale sells by the case; units_per_case converts case <-> each.
  units_per_case  integer     not null default 1 check (units_per_case > 0),
  cost_price      numeric(14,2) not null default 0 check (cost_price >= 0),
  list_price      numeric(14,2) not null default 0 check (list_price >= 0),
  tax_rate        numeric(5,2)  not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  reorder_point   integer     not null default 0 check (reorder_point >= 0),
  reorder_qty     integer     not null default 0 check (reorder_qty >= 0),
  is_active       boolean     not null default true,
  created_by      uuid        references public.profiles (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index products_category_idx on public.products (category_id);
create index products_supplier_idx on public.products (supplier_id);
create index products_search_idx
  on public.products using gin (to_tsvector('simple', sku || ' ' || name));

-- Current stock, one row per product/warehouse pair.
create table public.inventory (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products (id) on delete cascade,
  warehouse_id  uuid not null references public.warehouses (id) on delete cascade,
  qty_on_hand   integer not null default 0,
  -- Reserved by confirmed-but-unshipped sales orders.
  qty_reserved  integer not null default 0 check (qty_reserved >= 0),
  qty_available integer generated always as (qty_on_hand - qty_reserved) stored,
  bin_location  text,
  updated_at    timestamptz not null default now(),
  unique (product_id, warehouse_id)
);

create index inventory_warehouse_idx on public.inventory (warehouse_id);

-- Append-only ledger. quantity is always positive; direction comes from type.
create table public.stock_movements (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products (id) on delete restrict,
  warehouse_id  uuid not null references public.warehouses (id) on delete restrict,
  type          public.movement_type not null,
  quantity      integer not null check (quantity > 0),
  unit_cost     numeric(14,2),
  -- Free-form link back to the document that caused the movement.
  reference_type text,
  reference_id   uuid,
  reason        text,
  created_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now()
);

create index stock_movements_product_idx on public.stock_movements (product_id, created_at desc);
create index stock_movements_ref_idx on public.stock_movements (reference_type, reference_id);

-- ------------------------------------------------- movement -> inventory
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
  end
$$;

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

  insert into public.inventory (product_id, warehouse_id, qty_on_hand)
  values (new.product_id, new.warehouse_id, delta)
  on conflict (product_id, warehouse_id) do update
    set qty_on_hand = public.inventory.qty_on_hand + delta,
        updated_at  = now();

  return new;
end;
$$;

create trigger stock_movements_apply
  after insert on public.stock_movements
  for each row execute function public.apply_stock_movement();

-- The ledger is immutable: correct mistakes with a reversing movement.
create or replace function public.block_movement_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'stock_movements is append-only; post a reversing movement instead';
end;
$$;

create trigger stock_movements_no_update
  before update or delete on public.stock_movements
  for each row execute function public.block_movement_mutation();

create trigger categories_set_updated_at before update on public.categories
  for each row execute function public.set_updated_at();
create trigger warehouses_set_updated_at before update on public.warehouses
  for each row execute function public.set_updated_at();
create trigger products_set_updated_at before update on public.products
  for each row execute function public.set_updated_at();
