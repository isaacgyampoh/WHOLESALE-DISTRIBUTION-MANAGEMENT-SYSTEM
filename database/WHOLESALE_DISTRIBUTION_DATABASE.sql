-- =====================================================================
-- WHOLESALE DISTRIBUTION MANAGEMENT SYSTEM
-- Complete database installer for a fresh Supabase project
--
-- GENERATED FILE - do not edit by hand.
-- Source: supabase/migrations/0001 .. 0015
-- Regenerate: node database/build.mjs
--
-- HOW TO INSTALL
--   1. Open your Supabase project, then SQL Editor.
--   2. New query, paste this entire file, Run.
--   3. Run database/VERIFY_DATABASE.sql to confirm the result.
--   4. Create your first user in Authentication, then promote them:
--        update public.profiles set role = 'admin' where email = 'you@example.com';
--
-- WHAT THIS DOES NOT DO
--   It does not create auth.users. Supabase provides that schema, and a
--   trigger installed here creates a public.profiles row whenever a user
--   signs up. Running this against a database without Supabase Auth will
--   fail on that reference, which is intended.
--
-- SAFE TO RUN ON A FRESH PROJECT ONLY. It creates objects; it does not
-- drop an existing installation.
-- =====================================================================


-- ====================================================================
-- 0001_foundation.sql
-- ====================================================================
-- =====================================================================
-- 0001_foundation.sql
-- Enums, profile/role model, and shared helper functions.
-- Run these migrations in filename order in the Supabase SQL editor.
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ---------------------------------------------------------------- enums
create type public.user_role as enum (
  'admin', 'manager', 'sales_rep', 'warehouse', 'accountant',
  -- Appended by migration 0010; declared here so the whole installer can
  -- run inside one transaction.
  'driver', 'senior_manager'
);

create type public.order_status as enum (
  'draft', 'confirmed', 'picking', 'packed', 'shipped', 'delivered', 'cancelled'
);

create type public.invoice_status as enum (
  'draft', 'issued', 'partially_paid', 'paid', 'overdue', 'void'
);

create type public.po_status as enum (
  'draft', 'submitted', 'partially_received', 'received', 'cancelled'
);

create type public.movement_type as enum (
  'receipt', 'issue', 'adjustment_in', 'adjustment_out',
  'transfer_in', 'transfer_out', 'customer_return', 'supplier_return',
  -- Appended by migration 0010, as above.
  'damage', 'shortage'
);

create type public.payment_method as enum (
  'cash', 'bank_transfer', 'cheque', 'card', 'mobile_money'
);

-- ------------------------------------------------------------- profiles
-- One row per auth.users record. Holds the role that every RLS policy
-- in 0006_rls.sql keys off of.
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text        not null default '',
  email       citext      not null,
  role        public.user_role not null default 'sales_rep',
  phone       text,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is
  'Application user profile; role drives all row level security.';

-- ------------------------------------------------------ shared triggers
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Auto-create a profile whenever a user signs up through Supabase Auth.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce((new.raw_user_meta_data ->> 'role')::public.user_role, 'sales_rep')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------ role helpers
-- Named auth_role() rather than current_role() to avoid the SQL keyword.
create or replace function public.auth_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid() and is_active
$$;

create or replace function public.has_role(variadic allowed public.user_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.auth_role() = any (allowed), false)
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.auth_role() is not null
$$;

-- --------------------------------------------------- document numbering
create sequence public.sales_order_seq  start 1000;
create sequence public.invoice_seq      start 1000;
create sequence public.purchase_order_seq start 1000;
create sequence public.payment_seq      start 1000;

create or replace function public.next_document_number(prefix text, seq regclass)
returns text
language sql
volatile
as $$
  select prefix || '-' || to_char(now(), 'YYYY') || '-'
         || lpad(nextval(seq)::text, 6, '0')
$$;


-- ====================================================================
-- 0002_partners.sql
-- ====================================================================
-- =====================================================================
-- 0002_partners.sql
-- Trading partners: customers (sell side) and suppliers (buy side).
-- =====================================================================

create table public.customers (
  id                  uuid primary key default gen_random_uuid(),
  code                text        not null unique,
  name                text        not null,
  contact_name        text,
  email               citext,
  phone               text,
  tax_id              text,
  billing_address     text,
  shipping_address    text,
  city                text,
  region              text,
  country             text        not null default 'GH',
  -- Wholesale customers buy on account; these two drive credit checks.
  credit_limit        numeric(14,2) not null default 0 check (credit_limit >= 0),
  payment_terms_days  integer     not null default 30 check (payment_terms_days >= 0),
  price_tier          text        not null default 'standard',
  is_active           boolean     not null default true,
  notes               text,
  created_by          uuid references public.profiles (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index customers_name_idx on public.customers using gin (to_tsvector('simple', name));
create index customers_active_idx on public.customers (is_active) where is_active;

create table public.suppliers (
  id                  uuid primary key default gen_random_uuid(),
  code                text        not null unique,
  name                text        not null,
  contact_name        text,
  email               citext,
  phone               text,
  tax_id              text,
  address             text,
  city                text,
  country             text        not null default 'GH',
  payment_terms_days  integer     not null default 30 check (payment_terms_days >= 0),
  lead_time_days      integer     not null default 7 check (lead_time_days >= 0),
  is_active           boolean     not null default true,
  notes               text,
  created_by          uuid references public.profiles (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index suppliers_active_idx on public.suppliers (is_active) where is_active;

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

create trigger suppliers_set_updated_at
  before update on public.suppliers
  for each row execute function public.set_updated_at();


-- ====================================================================
-- 0003_inventory.sql
-- ====================================================================
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


-- ====================================================================
-- 0004_sales.sql
-- ====================================================================
-- =====================================================================
-- 0004_sales.sql
-- Sales orders -> invoices -> payments.
-- Header totals and invoice balances are derived by trigger so the
-- application never has to keep them in sync by hand.
-- =====================================================================

create table public.sales_orders (
  id             uuid primary key default gen_random_uuid(),
  order_number   text not null unique
                 default public.next_document_number('SO', 'public.sales_order_seq'),
  customer_id    uuid not null references public.customers (id) on delete restrict,
  warehouse_id   uuid not null references public.warehouses (id) on delete restrict,
  status         public.order_status not null default 'draft',
  order_date     date not null default current_date,
  required_date  date,
  shipped_date   date,
  shipping_address text,
  subtotal       numeric(14,2) not null default 0,
  discount_total numeric(14,2) not null default 0,
  tax_total      numeric(14,2) not null default 0,
  total          numeric(14,2) not null default 0,
  notes          text,
  created_by     uuid references public.profiles (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index sales_orders_customer_idx on public.sales_orders (customer_id, order_date desc);
create index sales_orders_status_idx on public.sales_orders (status);

create table public.sales_order_items (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.sales_orders (id) on delete cascade,
  product_id     uuid not null references public.products (id) on delete restrict,
  quantity       integer not null check (quantity > 0),
  qty_shipped    integer not null default 0 check (qty_shipped >= 0),
  unit_price     numeric(14,2) not null check (unit_price >= 0),
  discount_pct   numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  tax_rate       numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  line_subtotal  numeric(14,2) generated always as
                   (round(quantity * unit_price * (1 - discount_pct / 100), 2)) stored,
  line_total     numeric(14,2) generated always as
                   (round(quantity * unit_price * (1 - discount_pct / 100)
                          * (1 + tax_rate / 100), 2)) stored,
  created_at     timestamptz not null default now(),
  unique (order_id, product_id)
);

create index sales_order_items_order_idx on public.sales_order_items (order_id);

create table public.invoices (
  id             uuid primary key default gen_random_uuid(),
  invoice_number text not null unique
                 default public.next_document_number('INV', 'public.invoice_seq'),
  order_id       uuid references public.sales_orders (id) on delete set null,
  customer_id    uuid not null references public.customers (id) on delete restrict,
  status         public.invoice_status not null default 'draft',
  issue_date     date not null default current_date,
  due_date       date not null default (current_date + 30),
  subtotal       numeric(14,2) not null default 0,
  tax_total      numeric(14,2) not null default 0,
  total          numeric(14,2) not null default 0,
  amount_paid    numeric(14,2) not null default 0 check (amount_paid >= 0),
  balance        numeric(14,2) generated always as (total - amount_paid) stored,
  notes          text,
  created_by     uuid references public.profiles (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index invoices_customer_idx on public.invoices (customer_id, issue_date desc);
create index invoices_open_idx on public.invoices (status)
  where status in ('issued', 'partially_paid', 'overdue');

create table public.payments (
  id             uuid primary key default gen_random_uuid(),
  payment_number text not null unique
                 default public.next_document_number('PAY', 'public.payment_seq'),
  invoice_id     uuid not null references public.invoices (id) on delete restrict,
  amount         numeric(14,2) not null check (amount > 0),
  method         public.payment_method not null default 'bank_transfer',
  reference      text,
  paid_at        timestamptz not null default now(),
  received_by    uuid references public.profiles (id),
  created_at     timestamptz not null default now()
);

create index payments_invoice_idx on public.payments (invoice_id);

-- ------------------------------------------------- derived order totals
create or replace function public.recalc_order_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.order_id, old.order_id);
begin
  update public.sales_orders o
  set subtotal       = coalesce(t.subtotal, 0),
      tax_total      = coalesce(t.tax, 0),
      discount_total = coalesce(t.discount, 0),
      total          = coalesce(t.subtotal, 0) + coalesce(t.tax, 0),
      updated_at     = now()
  from (
    select
      sum(line_subtotal)                          as subtotal,
      sum(line_total - line_subtotal)             as tax,
      sum(round(quantity * unit_price * discount_pct / 100, 2)) as discount
    from public.sales_order_items
    where order_id = target
  ) t
  where o.id = target;

  return null;
end;
$$;

create trigger sales_order_items_recalc
  after insert or update or delete on public.sales_order_items
  for each row execute function public.recalc_order_totals();

-- ------------------------------------------ payments -> invoice balance
create or replace function public.recalc_invoice_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.invoice_id, old.invoice_id);
  paid   numeric(14,2);
  inv    public.invoices;
begin
  select coalesce(sum(amount), 0) into paid
  from public.payments where invoice_id = target;

  select * into inv from public.invoices where id = target;

  update public.invoices
  set amount_paid = paid,
      status = case
        when status = 'void' then 'void'
        when paid <= 0 and inv.due_date < current_date then 'overdue'
        when paid <= 0 then inv.status
        when paid >= inv.total then 'paid'
        else 'partially_paid'
      end,
      updated_at = now()
  where id = target;

  return null;
end;
$$;

create trigger payments_recalc_invoice
  after insert or update or delete on public.payments
  for each row execute function public.recalc_invoice_payment();

-- ------------------------------------- reserve / release / ship stock
-- Confirming an order reserves stock; shipping converts the reservation
-- into an actual issue; cancelling releases it.
create or replace function public.handle_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  item record;
begin
  if new.status = old.status then
    return new;
  end if;

  -- draft -> confirmed: reserve
  if old.status = 'draft' and new.status = 'confirmed' then
    for item in select * from public.sales_order_items where order_id = new.id loop
      update public.inventory
      set qty_reserved = qty_reserved + item.quantity, updated_at = now()
      where product_id = item.product_id and warehouse_id = new.warehouse_id;

      if not found then
        raise exception 'No stock record for product % in warehouse %',
          item.product_id, new.warehouse_id;
      end if;
    end loop;
  end if;

  -- anything -> shipped: release reservation and issue the stock
  if new.status = 'shipped' and old.status <> 'shipped' then
    for item in select * from public.sales_order_items where order_id = new.id loop
      update public.inventory
      set qty_reserved = greatest(qty_reserved - item.quantity, 0), updated_at = now()
      where product_id = item.product_id and warehouse_id = new.warehouse_id;

      insert into public.stock_movements
        (product_id, warehouse_id, type, quantity, reference_type, reference_id, created_by)
      values
        (item.product_id, new.warehouse_id, 'issue', item.quantity,
         'sales_order', new.id, auth.uid());
    end loop;

    new.shipped_date := coalesce(new.shipped_date, current_date);
  end if;

  -- cancelled before shipping: release the reservation
  if new.status = 'cancelled' and old.status in ('confirmed', 'picking', 'packed') then
    for item in select * from public.sales_order_items where order_id = new.id loop
      update public.inventory
      set qty_reserved = greatest(qty_reserved - item.quantity, 0), updated_at = now()
      where product_id = item.product_id and warehouse_id = new.warehouse_id;
    end loop;
  end if;

  return new;
end;
$$;

create trigger sales_orders_status_change
  before update of status on public.sales_orders
  for each row execute function public.handle_order_status_change();

create trigger sales_orders_set_updated_at before update on public.sales_orders
  for each row execute function public.set_updated_at();
create trigger invoices_set_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();


-- ====================================================================
-- 0005_purchasing.sql
-- ====================================================================
-- =====================================================================
-- 0005_purchasing.sql
-- Purchase orders and goods receipts. Receiving posts a 'receipt'
-- movement, so replenishment flows through the same ledger as sales.
-- =====================================================================

create table public.purchase_orders (
  id             uuid primary key default gen_random_uuid(),
  po_number      text not null unique
                 default public.next_document_number('PO', 'public.purchase_order_seq'),
  supplier_id    uuid not null references public.suppliers (id) on delete restrict,
  warehouse_id   uuid not null references public.warehouses (id) on delete restrict,
  status         public.po_status not null default 'draft',
  order_date     date not null default current_date,
  expected_date  date,
  subtotal       numeric(14,2) not null default 0,
  tax_total      numeric(14,2) not null default 0,
  total          numeric(14,2) not null default 0,
  notes          text,
  created_by     uuid references public.profiles (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index purchase_orders_supplier_idx
  on public.purchase_orders (supplier_id, order_date desc);
create index purchase_orders_status_idx on public.purchase_orders (status);

create table public.purchase_order_items (
  id            uuid primary key default gen_random_uuid(),
  po_id         uuid not null references public.purchase_orders (id) on delete cascade,
  product_id    uuid not null references public.products (id) on delete restrict,
  quantity      integer not null check (quantity > 0),
  qty_received  integer not null default 0 check (qty_received >= 0),
  unit_cost     numeric(14,2) not null check (unit_cost >= 0),
  tax_rate      numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  line_subtotal numeric(14,2) generated always as
                  (round(quantity * unit_cost, 2)) stored,
  line_total    numeric(14,2) generated always as
                  (round(quantity * unit_cost * (1 + tax_rate / 100), 2)) stored,
  created_at    timestamptz not null default now(),
  unique (po_id, product_id)
);

create index purchase_order_items_po_idx on public.purchase_order_items (po_id);

create or replace function public.recalc_po_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.po_id, old.po_id);
begin
  update public.purchase_orders p
  set subtotal   = coalesce(t.subtotal, 0),
      tax_total  = coalesce(t.tax, 0),
      total      = coalesce(t.subtotal, 0) + coalesce(t.tax, 0),
      updated_at = now()
  from (
    select sum(line_subtotal) as subtotal,
           sum(line_total - line_subtotal) as tax
    from public.purchase_order_items
    where po_id = target
  ) t
  where p.id = target;

  return null;
end;
$$;

create trigger purchase_order_items_recalc
  after insert or update or delete on public.purchase_order_items
  for each row execute function public.recalc_po_totals();

-- Receive a quantity against one PO line: posts stock, updates the line,
-- refreshes cost price, and advances the PO status.
create or replace function public.receive_purchase_line(
  p_item_id uuid,
  p_quantity integer
)
returns public.purchase_order_items
language plpgsql
security definer
set search_path = public
as $$
declare
  item public.purchase_order_items;
  po   public.purchase_orders;
  outstanding integer;
begin
  if p_quantity <= 0 then
    raise exception 'Received quantity must be positive';
  end if;

  select * into item from public.purchase_order_items where id = p_item_id for update;
  if not found then
    raise exception 'Purchase order line % not found', p_item_id;
  end if;

  select * into po from public.purchase_orders where id = item.po_id for update;

  if po.status in ('cancelled', 'received') then
    raise exception 'Purchase order % is %', po.po_number, po.status;
  end if;

  if item.qty_received + p_quantity > item.quantity then
    raise exception 'Cannot receive % units: only % outstanding on this line',
      p_quantity, item.quantity - item.qty_received;
  end if;

  insert into public.stock_movements
    (product_id, warehouse_id, type, quantity, unit_cost,
     reference_type, reference_id, created_by)
  values
    (item.product_id, po.warehouse_id, 'receipt', p_quantity, item.unit_cost,
     'purchase_order', po.id, auth.uid());

  update public.purchase_order_items
  set qty_received = qty_received + p_quantity
  where id = p_item_id
  returning * into item;

  -- Latest landed cost becomes the product's standard cost.
  update public.products
  set cost_price = item.unit_cost, updated_at = now()
  where id = item.product_id;

  select sum(quantity - qty_received) into outstanding
  from public.purchase_order_items where po_id = po.id;

  update public.purchase_orders
  set status = case when outstanding = 0 then 'received'::public.po_status
                    else 'partially_received'::public.po_status end,
      updated_at = now()
  where id = po.id;

  return item;
end;
$$;

create trigger purchase_orders_set_updated_at before update on public.purchase_orders
  for each row execute function public.set_updated_at();


-- ====================================================================
-- 0006_views.sql
-- ====================================================================
-- =====================================================================
-- 0006_views.sql
-- Read models for the dashboard and operational screens.
-- security_invoker = on so the querying user's RLS policies still apply.
-- =====================================================================

-- Receivables per customer, for credit checks and the ageing widget.
create view public.customer_balances
with (security_invoker = on) as
  select
    c.id                                            as customer_id,
    c.code,
    c.name,
    c.credit_limit,
    coalesce(sum(i.balance), 0)                     as outstanding,
    greatest(c.credit_limit - coalesce(sum(i.balance), 0), 0) as credit_available,
    count(i.id) filter (where i.status = 'overdue')  as overdue_invoices
  from public.customers c
  left join public.invoices i
    on i.customer_id = c.id
   and i.status in ('issued', 'partially_paid', 'overdue')
  group by c.id, c.code, c.name, c.credit_limit;

-- Stock across all warehouses with a reorder flag for the buyer's queue.
create view public.stock_summary
with (security_invoker = on) as
  select
    p.id            as product_id,
    p.sku,
    p.name,
    p.reorder_point,
    p.reorder_qty,
    p.cost_price,
    p.list_price,
    coalesce(sum(inv.qty_on_hand), 0)   as qty_on_hand,
    coalesce(sum(inv.qty_reserved), 0)  as qty_reserved,
    coalesce(sum(inv.qty_available), 0) as qty_available,
    coalesce(sum(inv.qty_on_hand), 0) * p.cost_price as stock_value,
    coalesce(sum(inv.qty_available), 0) <= p.reorder_point as needs_reorder
  from public.products p
  left join public.inventory inv on inv.product_id = p.id
  where p.is_active
  group by p.id, p.sku, p.name, p.reorder_point, p.reorder_qty,
           p.cost_price, p.list_price;

-- Invoice ageing buckets for the finance dashboard.
create view public.invoice_ageing
with (security_invoker = on) as
  select
    i.id,
    i.invoice_number,
    i.customer_id,
    c.name as customer_name,
    i.due_date,
    i.total,
    i.balance,
    current_date - i.due_date as days_overdue,
    case
      when i.balance <= 0                    then 'settled'
      when current_date <= i.due_date        then 'current'
      when current_date - i.due_date <= 30   then '1-30'
      when current_date - i.due_date <= 60   then '31-60'
      when current_date - i.due_date <= 90   then '61-90'
      else '90+'
    end as bucket
  from public.invoices i
  join public.customers c on c.id = i.customer_id
  where i.status <> 'void';

-- Flip issued invoices to overdue. Schedule via pg_cron or call from the app.
create or replace function public.mark_overdue_invoices()
returns integer
language sql
volatile
security definer
set search_path = public
as $$
  with updated as (
    update public.invoices
    set status = 'overdue', updated_at = now()
    where status in ('issued', 'partially_paid')
      and due_date < current_date
      and balance > 0
    returning 1
  )
  select count(*)::integer from updated;
$$;


-- ====================================================================
-- 0007_rls.sql
-- ====================================================================
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


-- ====================================================================
-- 0008_seed.sql
-- ====================================================================
-- =====================================================================
-- 0008_seed.sql
-- Demo reference data. Safe to re-run; safe to skip in production.
-- Users are NOT seeded here: create them in Authentication > Users,
-- then promote one with the UPDATE at the bottom of this file.
-- =====================================================================

insert into public.warehouses (code, name, city, is_default) values
  ('WH-ACC', 'Accra Main Depot', 'Accra', true),
  ('WH-KUM', 'Kumasi Depot',     'Kumasi', false)
on conflict (code) do nothing;

insert into public.categories (name) values
  ('Beverages'), ('Dry Goods'), ('Household'), ('Personal Care')
on conflict do nothing;

insert into public.suppliers (code, name, contact_name, email, phone, payment_terms_days, lead_time_days) values
  ('SUP-001', 'Volta Beverages Ltd', 'Kofi Mensah',  'sales@voltabev.example',  '+233201110001', 30, 5),
  ('SUP-002', 'Ashanti Foods Ltd',   'Ama Boateng',  'orders@ashfoods.example', '+233201110002', 45, 10)
on conflict (code) do nothing;

insert into public.customers (code, name, contact_name, email, phone, city, credit_limit, payment_terms_days, price_tier) values
  ('CUS-001', 'Madina Retail Mart',   'Yaw Owusu',   'yaw@madinamart.example',  '+233241110001', 'Accra',  50000, 30, 'wholesale'),
  ('CUS-002', 'Suame Provisions',     'Akua Danso',  'akua@suameprov.example',  '+233241110002', 'Kumasi', 25000, 14, 'standard'),
  ('CUS-003', 'Tema Cash & Carry',    'Kwame Asare', 'kwame@temacc.example',    '+233241110003', 'Tema',  120000, 45, 'wholesale')
on conflict (code) do nothing;

insert into public.products (sku, name, category_id, supplier_id, unit_of_measure, units_per_case, cost_price, list_price, tax_rate, reorder_point, reorder_qty)
select v.sku, v.name,
       (select id from public.categories where name = v.category limit 1),
       (select id from public.suppliers  where code = v.supplier limit 1),
       v.uom, v.upc, v.cost, v.list, 15.0, v.rop, v.roq
from (values
  ('SKU-1001', 'Sparkling Water 500ml',   'Beverages',     'SUP-001', 'case', 24, 42.00,  58.00, 100, 200),
  ('SKU-1002', 'Cola 330ml',              'Beverages',     'SUP-001', 'case', 24, 55.00,  74.00, 150, 300),
  ('SKU-2001', 'Long Grain Rice 5kg',     'Dry Goods',     'SUP-002', 'bag',   1, 68.00,  89.00,  80, 150),
  ('SKU-2002', 'Vegetable Oil 5L',        'Dry Goods',     'SUP-002', 'each',  1, 95.00, 124.00,  60, 120),
  ('SKU-3001', 'Laundry Powder 2kg',      'Household',     'SUP-002', 'case', 12, 78.00, 102.00,  40,  80),
  ('SKU-4001', 'Bar Soap 150g',           'Personal Care', 'SUP-002', 'case', 48, 96.00, 130.00,  50, 100)
) as v(sku, name, category, supplier, uom, upc, cost, list, rop, roq)
on conflict (sku) do nothing;

-- Opening stock, posted through the ledger so inventory stays derived.
insert into public.stock_movements (product_id, warehouse_id, type, quantity, unit_cost, reference_type, reason)
select p.id,
       (select id from public.warehouses where code = 'WH-ACC'),
       'receipt', 250, p.cost_price, 'opening_balance', 'Opening stock'
from public.products p
where not exists (
  select 1 from public.stock_movements m
  where m.product_id = p.id and m.reference_type = 'opening_balance'
);

-- ---------------------------------------------------------------------
-- Promote your first user to admin. Create the account in the Supabase
-- dashboard first, then replace the email below and run this line.
--
--   update public.profiles set role = 'admin'
--   where email = 'you@example.com';
-- ---------------------------------------------------------------------


-- ====================================================================
-- 0009_multi_tenancy.sql
-- ====================================================================
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


-- ====================================================================
-- 0010_enum_extensions.sql
-- ====================================================================
-- Migration 0010 appends values to user_role and movement_type.
-- In this consolidated installer those values are already part of the
-- enum declarations in section 0001, because PostgreSQL cannot use a new
-- enum value in the transaction that added it. Nothing to do here.


-- ====================================================================
-- 0011_distribution_operations.sql
-- ====================================================================
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


-- ====================================================================
-- 0012_distribution_logic.sql
-- ====================================================================
-- =====================================================================
-- 0012_distribution_logic.sql
-- Workflow functions and row level security for van operations.
--
-- Every stock effect goes through public.stock_movements, so van stock
-- carries the same audit guarantees as warehouse stock.
-- =====================================================================

-- ---------------------------------------------- org_id backfill triggers
create trigger vans_fill_org before insert on public.vans
  for each row execute function public.fill_org_from_parent();
create trigger van_assignments_fill_org before insert on public.van_assignments
  for each row execute function public.fill_org_from_parent('van_id', 'vans');
create trigger van_inventory_fill_org before insert on public.van_inventory
  for each row execute function public.fill_org_from_parent('van_id', 'vans');
create trigger van_loads_fill_org before insert on public.van_loads
  for each row execute function public.fill_org_from_parent('van_id', 'vans');
create trigger van_load_items_fill_org before insert on public.van_load_items
  for each row execute function public.fill_org_from_parent('load_id', 'van_loads');
create trigger van_sales_fill_org before insert on public.van_sales
  for each row execute function public.fill_org_from_parent('van_id', 'vans');
create trigger van_sale_items_fill_org before insert on public.van_sale_items
  for each row execute function public.fill_org_from_parent('sale_id', 'van_sales');
create trigger van_returns_fill_org before insert on public.van_returns
  for each row execute function public.fill_org_from_parent('van_id', 'vans');
create trigger van_return_items_fill_org before insert on public.van_return_items
  for each row execute function public.fill_org_from_parent('return_id', 'van_returns');
create trigger van_reconciliations_fill_org before insert on public.van_reconciliations
  for each row execute function public.fill_org_from_parent('van_id', 'vans');
create trigger credit_transactions_fill_org before insert on public.credit_transactions
  for each row execute function public.fill_org_from_parent('customer_id', 'customers');
create trigger manager_category_scopes_fill_org before insert on public.manager_category_scopes
  for each row execute function public.fill_org_from_parent('profile_id', 'profiles');
create trigger stock_transfers_fill_org before insert on public.stock_transfers
  for each row execute function public.fill_org_from_parent('from_warehouse_id', 'warehouses');
create trigger stock_transfer_items_fill_org before insert on public.stock_transfer_items
  for each row execute function public.fill_org_from_parent('transfer_id', 'stock_transfers');

create trigger van_sales_same_org_customer before insert or update on public.van_sales
  for each row execute function public.assert_same_org('customer_id', 'customers');
create trigger stock_movements_same_org_van before insert on public.stock_movements
  for each row execute function public.assert_same_org('van_id', 'vans');

-- ===================================================================
-- Authorization inside SECURITY DEFINER functions
--
-- These functions run as their owner and therefore bypass row level
-- security entirely. Each one must re-assert who is allowed to call it,
-- or RLS becomes decorative. auth.uid() is null for the SQL editor,
-- service_role and cron, which are trusted server-side contexts.
-- ===================================================================

create or replace function public.require_role(variadic allowed public.user_role[])
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;  -- trusted server-side context
  end if;
  if not public.has_role(variadic allowed) then
    raise exception 'Permission denied: this action requires one of %', allowed
      using errcode = '42501';
  end if;
end;
$$;

-- ===================================================================
-- Van totals
-- ===================================================================

create or replace function public.recalc_van_sale_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.sale_id, old.sale_id);
begin
  update public.van_sales s
  set subtotal  = coalesce(t.sub, 0),
      tax_total = coalesce(t.tax, 0),
      total     = coalesce(t.sub, 0) + coalesce(t.tax, 0),
      updated_at = now()
  from (
    select sum(line_subtotal) sub, sum(line_total - line_subtotal) tax
    from public.van_sale_items where sale_id = target
  ) t
  where s.id = target;
  return null;
end;
$$;

create trigger van_sale_items_recalc
  after insert or update or delete on public.van_sale_items
  for each row execute function public.recalc_van_sale_totals();

-- ===================================================================
-- Dispatch: warehouse -> van
-- ===================================================================

create or replace function public.dispatch_van_load(p_load_id uuid)
returns public.van_loads
language plpgsql
security definer
set search_path = public
as $$
declare
  load public.van_loads;
  item record;
  available integer;
begin
  perform public.require_role('admin', 'senior_manager', 'manager', 'warehouse');

  select * into load from public.van_loads where id = p_load_id for update;
  if not found then
    raise exception 'Van load % not found', p_load_id;
  end if;

  if load.status <> 'loaded' then
    raise exception 'Load % must be in status loaded to dispatch (currently %)',
      load.load_number, load.status;
  end if;

  -- The driver signs for the goods before they leave the yard.
  if load.driver_confirmed_at is null then
    raise exception 'Load % has not been confirmed by the driver', load.load_number;
  end if;

  if not exists (select 1 from public.van_load_items where load_id = p_load_id) then
    raise exception 'Load % has no items', load.load_number;
  end if;

  for item in select * from public.van_load_items where load_id = p_load_id loop
    select coalesce(qty_available, 0) into available
    from public.inventory
    where product_id = item.product_id and warehouse_id = load.warehouse_id;

    if coalesce(available, 0) < item.qty_loaded then
      raise exception 'Insufficient stock for product %: % available, % requested',
        item.product_id, coalesce(available, 0), item.qty_loaded;
    end if;

    -- Out of the warehouse...
    insert into public.stock_movements
      (org_id, product_id, warehouse_id, type, quantity, unit_cost,
       reference_type, reference_id, created_by)
    values
      (load.org_id, item.product_id, load.warehouse_id, 'transfer_out',
       item.qty_loaded, item.unit_cost, 'van_load', load.id, auth.uid());

    -- ...and onto the van.
    insert into public.stock_movements
      (org_id, product_id, van_id, type, quantity, unit_cost,
       reference_type, reference_id, created_by)
    values
      (load.org_id, item.product_id, load.van_id, 'transfer_in',
       item.qty_loaded, item.unit_cost, 'van_load', load.id, auth.uid());
  end loop;

  update public.van_loads
  set status = 'dispatched', dispatched_at = now(), updated_at = now()
  where id = p_load_id
  returning * into load;

  return load;
end;
$$;

-- ===================================================================
-- Completing a van sale: issue stock, take cash or extend credit
-- ===================================================================

create or replace function public.complete_van_sale(p_sale_id uuid, p_amount_paid numeric default null)
returns public.van_sales
language plpgsql
security definer
set search_path = public
as $$
declare
  sale public.van_sales;
  item record;
  on_van integer;
  owing numeric(14,2);
  limit_amount numeric(14,2);
  terms integer;
begin
  select * into sale from public.van_sales where id = p_sale_id for update;
  if not found then
    raise exception 'Van sale % not found', p_sale_id;
  end if;

  -- Either the driver who owns the sale, or someone managing them.
  if auth.uid() is not null
     and sale.driver_id <> auth.uid()
     and not public.has_role('admin', 'senior_manager', 'manager') then
    raise exception 'Only the assigned driver or a manager may complete this sale'
      using errcode = '42501';
  end if;

  if sale.status <> 'draft' then
    raise exception 'Sale % is already %', sale.sale_number, sale.status;
  end if;

  if not exists (select 1 from public.van_sale_items where sale_id = p_sale_id) then
    raise exception 'Sale % has no items', sale.sale_number;
  end if;

  -- Stock must actually be on the van.
  for item in select * from public.van_sale_items where sale_id = p_sale_id loop
    select coalesce(qty_on_hand, 0) into on_van
    from public.van_inventory
    where van_id = sale.van_id and product_id = item.product_id;

    if coalesce(on_van, 0) < item.quantity then
      raise exception 'Van does not carry enough of product %: % on board, % sold',
        item.product_id, coalesce(on_van, 0), item.quantity;
    end if;
  end loop;

  if sale.sale_type = 'cash' then
    -- Cash sales are settled in full at the point of sale.
    if coalesce(p_amount_paid, sale.total) < sale.total then
      raise exception 'Cash sale % requires full payment of %, received %',
        sale.sale_number, sale.total, coalesce(p_amount_paid, 0);
    end if;
    update public.van_sales
    set amount_paid = sale.total, status = 'completed', updated_at = now()
    where id = p_sale_id;
  else
    -- Credit sales are checked against the customer's remaining credit.
    select credit_limit, payment_terms_days into limit_amount, terms
    from public.customers where id = sale.customer_id;

    select coalesce(sum(amount), 0) into owing
    from public.credit_transactions where customer_id = sale.customer_id;

    if owing + sale.total > limit_amount then
      raise exception
        'Credit limit exceeded for customer: outstanding %, sale %, limit %',
        owing, sale.total, limit_amount;
    end if;

    update public.van_sales
    set amount_paid = coalesce(p_amount_paid, 0),
        status = 'completed',
        due_date = coalesce(sale.due_date, current_date + coalesce(terms, 30)),
        updated_at = now()
    where id = p_sale_id;

    insert into public.credit_transactions
      (org_id, customer_id, type, amount, reference_type, reference_id,
       due_date, created_by, notes)
    values
      (sale.org_id, sale.customer_id, 'charge',
       sale.total - coalesce(p_amount_paid, 0), 'van_sale', sale.id,
       current_date + coalesce(terms, 30), auth.uid(),
       'Credit sale ' || sale.sale_number);
  end if;

  -- Stock leaves the van either way.
  for item in select * from public.van_sale_items where sale_id = p_sale_id loop
    insert into public.stock_movements
      (org_id, product_id, van_id, type, quantity,
       reference_type, reference_id, created_by)
    values
      (sale.org_id, item.product_id, sale.van_id, 'issue', item.quantity,
       'van_sale', sale.id, auth.uid());
  end loop;

  select * into sale from public.van_sales where id = p_sale_id;
  return sale;
end;
$$;

-- Recording a collection against a customer's credit.
create or replace function public.record_credit_payment(
  p_customer_id uuid,
  p_amount numeric,
  p_method public.payment_method default 'cash',
  p_notes text default null
)
returns public.credit_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  txn public.credit_transactions;
  org uuid;
begin
  perform public.require_role('admin', 'senior_manager', 'manager', 'accountant', 'driver');

  if p_amount <= 0 then
    raise exception 'Payment amount must be positive';
  end if;

  select org_id into org from public.customers where id = p_customer_id;
  if org is null then
    raise exception 'Customer % not found', p_customer_id;
  end if;

  insert into public.credit_transactions
    (org_id, customer_id, type, amount, reference_type, created_by, notes)
  values
    (org, p_customer_id, 'payment', -p_amount, p_method::text, auth.uid(),
     coalesce(p_notes, 'Payment received'))
  returning * into txn;

  return txn;
end;
$$;

-- ===================================================================
-- Van return: good stock back to the warehouse, damage and shortage
-- written off against the van.
-- ===================================================================

create or replace function public.approve_van_return(p_return_id uuid)
returns public.van_returns
language plpgsql
security definer
set search_path = public
as $$
declare
  ret public.van_returns;
  item record;
begin
  select * into ret from public.van_returns where id = p_return_id for update;
  if not found then
    raise exception 'Van return % not found', p_return_id;
  end if;

  if ret.status <> 'submitted' then
    raise exception 'Return % must be submitted before approval (currently %)',
      ret.return_number, ret.status;
  end if;

  perform public.require_role('admin', 'senior_manager', 'manager', 'warehouse');

  for item in select * from public.van_return_items where return_id = p_return_id loop
    if item.qty_missing < 0 then
      raise exception 'Returned quantity for product % exceeds what was expected',
        item.product_id;
    end if;

    -- Good stock: off the van, back into the warehouse.
    if item.qty_returned_good > 0 then
      insert into public.stock_movements
        (org_id, product_id, van_id, type, quantity, reference_type, reference_id, created_by)
      values (ret.org_id, item.product_id, ret.van_id, 'transfer_out',
              item.qty_returned_good, 'van_return', ret.id, auth.uid());

      insert into public.stock_movements
        (org_id, product_id, warehouse_id, type, quantity, reference_type, reference_id, created_by)
      values (ret.org_id, item.product_id, ret.warehouse_id, 'transfer_in',
              item.qty_returned_good, 'van_return', ret.id, auth.uid());
    end if;

    -- Damaged stock leaves the van and is not restocked.
    if item.qty_damaged > 0 then
      insert into public.stock_movements
        (org_id, product_id, van_id, type, quantity, reason,
         reference_type, reference_id, created_by)
      values (ret.org_id, item.product_id, ret.van_id, 'damage', item.qty_damaged,
              coalesce(item.damage_reason, 'Damaged in transit'),
              'van_return', ret.id, auth.uid());
    end if;

    -- Anything unaccounted for is a shortage against the driver.
    if item.qty_missing > 0 then
      insert into public.stock_movements
        (org_id, product_id, van_id, type, quantity, reason,
         reference_type, reference_id, created_by)
      values (ret.org_id, item.product_id, ret.van_id, 'shortage', item.qty_missing,
              'Unaccounted for at van return', 'van_return', ret.id, auth.uid());
    end if;
  end loop;

  update public.van_returns
  set status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
  where id = p_return_id
  returning * into ret;

  update public.van_loads set status = 'returned', updated_at = now()
  where id = ret.load_id;

  return ret;
end;
$$;

-- ===================================================================
-- Reconciliation
-- ===================================================================

-- Compute what the driver should be handing back, from the ledger.
create or replace function public.build_reconciliation(p_load_id uuid)
returns public.van_reconciliations
language plpgsql
security definer
set search_path = public
as $$
declare
  load public.van_loads;
  rec  public.van_reconciliations;
  cash numeric(14,2);
  credit numeric(14,2);
  collected numeric(14,2);
  loaded_value numeric(14,2);
  sold_value numeric(14,2);
  damaged numeric(14,2);
  missing numeric(14,2);
  remaining numeric(14,2);
begin
  select * into load from public.van_loads where id = p_load_id;
  if not found then
    raise exception 'Van load % not found', p_load_id;
  end if;

  select
    coalesce(sum(total) filter (where sale_type = 'cash'), 0),
    coalesce(sum(total) filter (where sale_type = 'credit'), 0),
    coalesce(sum(amount_paid) filter (where sale_type = 'credit'), 0)
  into cash, credit, collected
  from public.van_sales
  where load_id = p_load_id and status = 'completed';

  select coalesce(sum(qty_loaded * unit_cost), 0) into loaded_value
  from public.van_load_items where load_id = p_load_id;

  select coalesce(sum(vsi.quantity * vli.unit_cost), 0) into sold_value
  from public.van_sale_items vsi
  join public.van_sales vs on vs.id = vsi.sale_id
  join public.van_load_items vli
    on vli.load_id = vs.load_id and vli.product_id = vsi.product_id
  where vs.load_id = p_load_id and vs.status = 'completed';

  select
    coalesce(sum(vri.qty_damaged * vli.unit_cost), 0),
    coalesce(sum(vri.qty_missing  * vli.unit_cost), 0)
  into damaged, missing
  from public.van_return_items vri
  join public.van_returns vr on vr.id = vri.return_id
  join public.van_load_items vli
    on vli.load_id = vr.load_id and vli.product_id = vri.product_id
  where vr.load_id = p_load_id;

  -- Stock still on the van after selling, at load cost.
  remaining := loaded_value - sold_value;

  insert into public.van_reconciliations (
    org_id, load_id, van_id, driver_id,
    opening_float, cash_sales_total, credit_sales_total, collections_total,
    expected_cash, expected_stock_value, actual_stock_value,
    damaged_value, missing_value, submitted_by
  )
  values (
    load.org_id, load.id, load.van_id, load.driver_id,
    load.opening_float, cash, credit, collected,
    load.opening_float + cash + collected,
    remaining, remaining - damaged - missing,
    damaged, missing, auth.uid()
  )
  on conflict (load_id) do update
  set cash_sales_total   = excluded.cash_sales_total,
      credit_sales_total = excluded.credit_sales_total,
      collections_total  = excluded.collections_total,
      expected_cash      = excluded.expected_cash,
      expected_stock_value = excluded.expected_stock_value,
      actual_stock_value = excluded.actual_stock_value,
      damaged_value      = excluded.damaged_value,
      missing_value      = excluded.missing_value,
      updated_at         = now()
  returning * into rec;

  return rec;
end;
$$;

create or replace function public.approve_reconciliation(
  p_recon_id uuid,
  p_note text default null
)
returns public.van_reconciliations
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.van_reconciliations;
begin
  select * into rec from public.van_reconciliations where id = p_recon_id for update;
  if not found then
    raise exception 'Reconciliation % not found', p_recon_id;
  end if;

  if rec.status <> 'submitted' then
    raise exception 'Reconciliation % must be submitted before approval (currently %)',
      rec.recon_number, rec.status;
  end if;

  -- Enforced again by a check constraint, but fail with a clear message.
  if rec.driver_id = auth.uid() then
    raise exception 'A driver cannot approve their own reconciliation';
  end if;

  perform public.require_role('admin', 'senior_manager', 'manager');

  update public.van_reconciliations
  set status = 'approved', approved_by = auth.uid(), approved_at = now(),
      explanation = coalesce(p_note, explanation), updated_at = now()
  where id = p_recon_id
  returning * into rec;

  update public.van_loads set status = 'reconciled', updated_at = now()
  where id = rec.load_id;

  return rec;
end;
$$;

-- ===================================================================
-- Authorship stamping
--
-- The driver's read policy on credit_transactions keys off created_by.
-- PostgREST returns the inserted row, so an unstamped row is written
-- successfully and then fails the SELECT check, surfacing as a confusing
-- "violates row-level security policy" error. Stamp it automatically.
-- ===================================================================

create or replace function public.stamp_created_by()
returns trigger
language plpgsql
as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger credit_transactions_stamp_author before insert on public.credit_transactions
  for each row execute function public.stamp_created_by();
create trigger stock_transfers_stamp_author before insert on public.stock_transfers
  for each row execute function public.stamp_created_by();


-- ====================================================================
-- 0013_distribution_rls.sql
-- ====================================================================
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


-- ====================================================================
-- 0014_distribution_views.sql
-- ====================================================================
-- =====================================================================
-- 0014_distribution_views.sql
-- Read models for van operations and customer credit.
-- All use security_invoker so RLS and category scopes still apply.
-- =====================================================================

-- Running customer statement from the credit ledger.
create view public.customer_statement
with (security_invoker = on) as
  select
    ct.org_id,
    ct.customer_id,
    c.code   as customer_code,
    c.name   as customer_name,
    ct.id    as transaction_id,
    ct.occurred_at,
    ct.type,
    ct.amount,
    ct.due_date,
    ct.reference_type,
    ct.reference_id,
    ct.notes,
    sum(ct.amount) over (
      partition by ct.customer_id
      order by ct.occurred_at, ct.id
      rows between unbounded preceding and current row
    ) as running_balance
  from public.credit_transactions ct
  join public.customers c on c.id = ct.customer_id;

-- Live credit position per customer, combining invoices and van credit.
create view public.customer_credit_position
with (security_invoker = on) as
  select
    c.org_id,
    c.id as customer_id,
    c.code,
    c.name,
    c.credit_limit,
    c.payment_terms_days,
    coalesce(ct.balance, 0) as ledger_balance,
    greatest(c.credit_limit - coalesce(ct.balance, 0), 0) as credit_available,
    coalesce(ct.balance, 0) > c.credit_limit as over_limit,
    ct.oldest_due,
    case
      when ct.oldest_due is null then null
      else current_date - ct.oldest_due
    end as days_past_due
  from public.customers c
  left join (
    select customer_id,
           sum(amount) as balance,
           min(due_date) filter (where type = 'charge' and due_date < current_date) as oldest_due
    from public.credit_transactions
    group by customer_id
  ) ct on ct.customer_id = c.id;

-- What each van is currently carrying, valued at cost.
create view public.van_stock_summary
with (security_invoker = on) as
  select
    vi.org_id,
    vi.van_id,
    v.code as van_code,
    v.registration_no,
    vi.product_id,
    p.sku,
    p.name as product_name,
    vi.qty_on_hand,
    p.cost_price,
    vi.qty_on_hand * p.cost_price as stock_value
  from public.van_inventory vi
  join public.vans v on v.id = vi.van_id
  join public.products p on p.id = vi.product_id
  where vi.qty_on_hand <> 0;

-- One row per trip: what went out, what sold, what came back.
create view public.van_load_summary
with (security_invoker = on) as
  select
    l.org_id,
    l.id as load_id,
    l.load_number,
    l.load_date,
    l.status,
    v.code as van_code,
    pr.full_name as driver_name,
    l.driver_id,
    l.opening_float,
    coalesce(li.items, 0)          as line_count,
    coalesce(li.loaded_value, 0)   as loaded_value,
    coalesce(s.cash_sales, 0)      as cash_sales,
    coalesce(s.credit_sales, 0)    as credit_sales,
    coalesce(s.sale_count, 0)      as sale_count,
    r.cash_variance,
    r.stock_variance,
    r.status as reconciliation_status
  from public.van_loads l
  join public.vans v on v.id = l.van_id
  join public.profiles pr on pr.id = l.driver_id
  left join (
    select load_id, count(*) as items, sum(qty_loaded * unit_cost) as loaded_value
    from public.van_load_items group by load_id
  ) li on li.load_id = l.id
  left join (
    select load_id,
           count(*) as sale_count,
           sum(total) filter (where sale_type = 'cash')   as cash_sales,
           sum(total) filter (where sale_type = 'credit') as credit_sales
    from public.van_sales where status = 'completed' group by load_id
  ) s on s.load_id = l.id
  left join public.van_reconciliations r on r.load_id = l.id;

-- Variances awaiting a manager decision.
create view public.reconciliation_variances
with (security_invoker = on) as
  select
    r.org_id,
    r.id,
    r.recon_number,
    r.status,
    v.code as van_code,
    p.full_name as driver_name,
    r.expected_cash,
    r.actual_cash,
    r.cash_variance,
    r.expected_stock_value,
    r.actual_stock_value,
    r.stock_variance,
    r.damaged_value,
    r.missing_value,
    r.cash_variance + r.stock_variance as total_variance,
    r.explanation,
    r.submitted_at
  from public.van_reconciliations r
  join public.vans v on v.id = r.van_id
  join public.profiles p on p.id = r.driver_id
  where r.cash_variance <> 0 or r.stock_variance <> 0;


-- ====================================================================
-- 0015_data_api_grants.sql
-- ====================================================================
-- =====================================================================
-- 0015_data_api_grants.sql
--
-- Two hosted-platform problems that local PostgreSQL testing did not
-- expose, fixed together because they are two halves of the same gap:
-- who may reach these objects through the Data API.
--
-- 1. GRANTS
--    Supabase's current cloud default does not auto-expose new entities
--    to the Data API roles. Migrations 0001-0014 issue no GRANT, so on a
--    new project every PostgREST request fails with "permission denied
--    for table ..." before RLS is ever consulted.
--
-- 2. ANONYMOUS AUTHORIZATION BYPASS  (security fix)
--    require_role() treated a null auth.uid() as a trusted server-side
--    context. That is true for the SQL editor and service_role, but an
--    ANONYMOUS PostgREST caller also has a null auth.uid(). Combined
--    with PostgreSQL granting EXECUTE to PUBLIC by default, a holder of
--    the public anon key could call dispatch_van_load,
--    approve_reconciliation, approve_van_return and
--    record_credit_payment. Those functions are SECURITY DEFINER, so
--    they bypass row level security and would have operated on any
--    organization's data.
--
--    Trust is now decided by the database role in effect, not by the
--    absence of a user.
-- =====================================================================

-- ------------------------------------------------- trusted context
create or replace function public.is_trusted_context()
returns boolean
language sql
stable
as $$
  -- current_user cannot be used here: inside a SECURITY DEFINER function
  -- it is the function's owner, not the caller, so it would report every
  -- caller as trusted. session_user is not rewritten by SECURITY DEFINER
  -- or by SET ROLE, and the JWT role claim is what PostgREST switches on.
  select case
    -- A Data API request. Trust only the service role.
    when nullif(current_setting('request.jwt.claims', true), '') is not null then
      (current_setting('request.jwt.claims', true)::json ->> 'role') = 'service_role'
    -- No claims: a direct database connection - SQL editor, psql, cron.
    -- PostgREST connects as 'authenticator' even when it presents no JWT,
    -- so that role is still refused here.
    else session_user not in ('authenticator', 'anon', 'authenticated')
  end
$$;

comment on function public.is_trusted_context is
  'True only for server-side roles. Never true for anon or authenticated.';

create or replace function public.require_role(variadic allowed public.user_role[])
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.is_trusted_context() then
    return;
  end if;

  -- An anonymous caller has no uid; it must not be mistaken for a
  -- trusted server-side context.
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not public.has_role(variadic allowed) then
    raise exception 'Permission denied: this action requires one of %', allowed
      using errcode = '42501';
  end if;
end;
$$;

-- The profile guards carried the same assumption.
create or replace function public.guard_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_trusted_context()
     and (new.role is distinct from old.role
          or new.is_active is distinct from old.is_active)
     and not public.has_role('admin') then
    raise exception 'Only an administrator may change a user role or status'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.guard_org_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_trusted_context() and new.org_id is distinct from old.org_id then
    raise exception 'Organization cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- complete_van_sale checks ownership inline rather than via require_role.
create or replace function public.complete_van_sale(
  p_sale_id uuid,
  p_amount_paid numeric default null
)
returns public.van_sales
language plpgsql
security definer
set search_path = public
as $$
declare
  sale public.van_sales;
  item record;
  on_van integer;
  owing numeric(14,2);
  limit_amount numeric(14,2);
  terms integer;
begin
  if not public.is_trusted_context() and auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into sale from public.van_sales where id = p_sale_id for update;
  if not found then
    raise exception 'Van sale % not found', p_sale_id;
  end if;

  -- Either the driver who owns the sale, or someone managing them.
  if not public.is_trusted_context()
     and sale.driver_id <> auth.uid()
     and not public.has_role('admin', 'senior_manager', 'manager') then
    raise exception 'Only the assigned driver or a manager may complete this sale'
      using errcode = '42501';
  end if;

  if sale.status <> 'draft' then
    raise exception 'Sale % is already %', sale.sale_number, sale.status;
  end if;

  if not exists (select 1 from public.van_sale_items where sale_id = p_sale_id) then
    raise exception 'Sale % has no items', sale.sale_number;
  end if;

  for item in select * from public.van_sale_items where sale_id = p_sale_id loop
    select coalesce(qty_on_hand, 0) into on_van
    from public.van_inventory
    where van_id = sale.van_id and product_id = item.product_id;

    if coalesce(on_van, 0) < item.quantity then
      raise exception 'Van does not carry enough of product %: % on board, % sold',
        item.product_id, coalesce(on_van, 0), item.quantity;
    end if;
  end loop;

  if sale.sale_type = 'cash' then
    if coalesce(p_amount_paid, sale.total) < sale.total then
      raise exception 'Cash sale % requires full payment of %, received %',
        sale.sale_number, sale.total, coalesce(p_amount_paid, 0);
    end if;
    update public.van_sales
    set amount_paid = sale.total, status = 'completed', updated_at = now()
    where id = p_sale_id;
  else
    select credit_limit, payment_terms_days into limit_amount, terms
    from public.customers where id = sale.customer_id;

    select coalesce(sum(amount), 0) into owing
    from public.credit_transactions where customer_id = sale.customer_id;

    if owing + sale.total > limit_amount then
      raise exception
        'Credit limit exceeded for customer: outstanding %, sale %, limit %',
        owing, sale.total, limit_amount;
    end if;

    update public.van_sales
    set amount_paid = coalesce(p_amount_paid, 0),
        status = 'completed',
        due_date = coalesce(sale.due_date, current_date + coalesce(terms, 30)),
        updated_at = now()
    where id = p_sale_id;

    insert into public.credit_transactions
      (org_id, customer_id, type, amount, reference_type, reference_id,
       due_date, created_by, notes)
    values
      (sale.org_id, sale.customer_id, 'charge',
       sale.total - coalesce(p_amount_paid, 0), 'van_sale', sale.id,
       current_date + coalesce(terms, 30), auth.uid(),
       'Credit sale ' || sale.sale_number);
  end if;

  for item in select * from public.van_sale_items where sale_id = p_sale_id loop
    insert into public.stock_movements
      (org_id, product_id, van_id, type, quantity,
       reference_type, reference_id, created_by)
    values
      (sale.org_id, item.product_id, sale.van_id, 'issue', item.quantity,
       'van_sale', sale.id, auth.uid());
  end loop;

  select * into sale from public.van_sales where id = p_sale_id;
  return sale;
end;
$$;

-- ===================================================================
-- Data API grants
--
-- anon receives nothing: this application has no public surface, so an
-- unauthenticated caller should not be able to read or call anything.
-- authenticated receives table access and RLS decides the rows.
-- ===================================================================

grant usage on schema public to authenticated, service_role;
revoke all on schema public from anon;

grant select, insert, update, delete on all tables in schema public
  to authenticated;
grant all on all tables in schema public to service_role;

-- Document-number defaults call nextval as the inserting role.
grant usage, select on all sequences in schema public to authenticated, service_role;

-- The stock ledger is append-only. A trigger already refuses these, but
-- withholding the privilege means the attempt fails before it is tried.
revoke update, delete on public.stock_movements from authenticated;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC. Withdraw that for
-- our own functions (extension-owned functions are left alone, since
-- citext and pgcrypto operators must stay callable) and re-grant only to
-- signed-in roles.
do $grants$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (
        select 1 from pg_depend d
        where d.objid = p.oid
          and d.deptype = 'e'          -- owned by an extension
      )
  loop
    execute format('revoke all on function %s from public, anon', fn.sig);
    execute format('grant execute on function %s to authenticated, service_role', fn.sig);
  end loop;
end
$grants$;

-- Anything created by later migrations inherits the same treatment.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;
alter default privileges in schema public
  grant execute on functions to authenticated, service_role;

-- ===================================================================
-- Authorize before looking up
--
-- Both approval functions read the record first and raise "not found"
-- before checking the caller's role. That lets an authenticated user
-- without approval rights probe which reconciliation and return ids
-- exist. The privilege check moves to the top.
-- ===================================================================

create or replace function public.approve_reconciliation(
  p_recon_id uuid,
  p_note text default null
)
returns public.van_reconciliations
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.van_reconciliations;
begin
  perform public.require_role('admin', 'senior_manager', 'manager');

  select * into rec from public.van_reconciliations where id = p_recon_id for update;
  if not found then
    raise exception 'Reconciliation % not found', p_recon_id;
  end if;

  if rec.status <> 'submitted' then
    raise exception 'Reconciliation % must be submitted before approval (currently %)',
      rec.recon_number, rec.status;
  end if;

  -- Also enforced by a check constraint; this gives a clearer message.
  if rec.driver_id = auth.uid() then
    raise exception 'A driver cannot approve their own reconciliation'
      using errcode = '42501';
  end if;

  update public.van_reconciliations
  set status = 'approved', approved_by = auth.uid(), approved_at = now(),
      explanation = coalesce(p_note, explanation), updated_at = now()
  where id = p_recon_id
  returning * into rec;

  update public.van_loads set status = 'reconciled', updated_at = now()
  where id = rec.load_id;

  return rec;
end;
$$;

create or replace function public.approve_van_return(p_return_id uuid)
returns public.van_returns
language plpgsql
security definer
set search_path = public
as $$
declare
  ret public.van_returns;
  item record;
begin
  perform public.require_role('admin', 'senior_manager', 'manager', 'warehouse');

  select * into ret from public.van_returns where id = p_return_id for update;
  if not found then
    raise exception 'Van return % not found', p_return_id;
  end if;

  if ret.status <> 'submitted' then
    raise exception 'Return % must be submitted before approval (currently %)',
      ret.return_number, ret.status;
  end if;

  for item in select * from public.van_return_items where return_id = p_return_id loop
    if item.qty_missing < 0 then
      raise exception 'Returned quantity for product % exceeds what was expected',
        item.product_id;
    end if;

    if item.qty_returned_good > 0 then
      insert into public.stock_movements
        (org_id, product_id, van_id, type, quantity, reference_type, reference_id, created_by)
      values (ret.org_id, item.product_id, ret.van_id, 'transfer_out',
              item.qty_returned_good, 'van_return', ret.id, auth.uid());

      insert into public.stock_movements
        (org_id, product_id, warehouse_id, type, quantity, reference_type, reference_id, created_by)
      values (ret.org_id, item.product_id, ret.warehouse_id, 'transfer_in',
              item.qty_returned_good, 'van_return', ret.id, auth.uid());
    end if;

    if item.qty_damaged > 0 then
      insert into public.stock_movements
        (org_id, product_id, van_id, type, quantity, reason,
         reference_type, reference_id, created_by)
      values (ret.org_id, item.product_id, ret.van_id, 'damage', item.qty_damaged,
              coalesce(item.damage_reason, 'Damaged in transit'),
              'van_return', ret.id, auth.uid());
    end if;

    if item.qty_missing > 0 then
      insert into public.stock_movements
        (org_id, product_id, van_id, type, quantity, reason,
         reference_type, reference_id, created_by)
      values (ret.org_id, item.product_id, ret.van_id, 'shortage', item.qty_missing,
              'Unaccounted for at van return', 'van_return', ret.id, auth.uid());
    end if;
  end loop;

  update public.van_returns
  set status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
  where id = p_return_id
  returning * into ret;

  update public.van_loads set status = 'returned', updated_at = now()
  where id = ret.load_id;

  return ret;
end;
$$;

-- The redefinitions above are new function bodies, so they arrive with
-- PUBLIC execute again. Withdraw it once more.
do $regrant$
declare
  fn text;
begin
  foreach fn in array array[
    'public.approve_reconciliation(uuid, text)',
    'public.approve_van_return(uuid)',
    'public.complete_van_sale(uuid, numeric)',
    'public.require_role(public.user_role[])',
    'public.is_trusted_context()',
    'public.guard_role_change()',
    'public.guard_org_change()'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end
$regrant$;


-- ====================================================================
-- 0016_revoke_anon_privileges.sql
-- ====================================================================
-- =====================================================================
-- 0016_revoke_anon_privileges.sql
--
-- Removes table, sequence and function privileges from the anon role.
--
-- WHY THIS IS NEEDED
--   Migration 0015 assumed anon would hold no object privileges, because
--   Supabase's current cloud default does not auto-expose new entities.
--   Projects created before that change carry default privileges that
--   grant every newly created table to anon as it is created, so the
--   installer left 259 grant rows behind on such a project and anon held
--   SELECT on all 29 tables and 8 views.
--
-- WAS DATA EXPOSED?
--   No. Verified by execution against a database reproducing that state:
--   every anonymous read and write failed with "permission denied for
--   function auth_org_id", because 0015 revoked EXECUTE from anon and
--   every row level security policy calls that function.
--
--   That protection is incidental rather than designed. It holds only
--   while every policy happens to call a function anon cannot execute.
--   A future table with a simpler policy would be readable. The
--   privileges are therefore removed at the source.
--
-- SAFE TO RUN on a project that never had the legacy grants: the
-- statements are no-ops there.
-- =====================================================================

-- Stop future objects from being granted to anon. This is the root
-- cause: without it, the next table created would be exposed again.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

-- Remove what the legacy defaults already granted.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- Withdraw schema access. anon also inherits USAGE from the PUBLIC
-- pseudo-role, which is left in place: revoking it from PUBLIC would
-- affect Supabase's own roles. It is inert once anon holds no object
-- privileges, and this application has no anonymous surface.
revoke all on schema public from anon;

-- The roles the application actually uses keep exactly what 0015 gave
-- them. Restated so this migration is self-contained and so a project
-- that runs it in isolation cannot end up with authenticated locked out.
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- The stock ledger stays append-only for ordinary users.
revoke update, delete on public.stock_movements from authenticated;

-- Re-assert EXECUTE on our own functions, since the blanket revoke above
-- also stripped anon's inherited rights and we want the signed-in roles
-- to keep theirs. Extension-owned functions are left untouched so citext
-- and pgcrypto operators keep working.
do $grants$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (
        select 1 from pg_depend d
        where d.objid = p.oid and d.deptype = 'e'
      )
  loop
    execute format('revoke all on function %s from public, anon', fn.sig);
    execute format('grant execute on function %s to authenticated, service_role', fn.sig);
  end loop;
end
$grants$;


-- ====================================================================
-- 0017_identity_and_signup_guard.sql
-- ====================================================================
-- =====================================================================
-- 0017_identity_and_signup_guard.sql
--
-- Two changes to how accounts come into existence.
--
-- 1. SIGNUP GUARD (security)
--    handle_new_user() placed every new auth.users row into the default
--    organization as an active sales_rep. Nothing in the application
--    causes that today, because email signup is disabled. The moment an
--    OAuth provider such as Google is enabled, anyone with an account at
--    that provider could sign in and immediately read the catalogue and
--    the customer list.
--
--    Verified before this migration: an uninvited signup could see 6
--    products and 3 customers. Verified after marking such a profile
--    inactive: auth_role() returns null, is_staff() is false, and every
--    table returns nothing.
--
--    An account is now active only when the signup carries an org_id in
--    its metadata, which is what an administrator-issued invitation
--    does. A self-registered account is created but inert until someone
--    with authority activates it.
--
-- 2. PHONE AS AN IDENTITY
--    profiles.email was NOT NULL, so a phone-only signup failed outright
--    with a not-null violation. Drivers are the reason this matters:
--    they carry phones, often have no work email, and typing an address
--    into a phone in a van is slow. Either identifier is now sufficient,
--    and at least one is required.
-- =====================================================================

-- ------------------------------------------------- phone as identity
alter table public.profiles alter column email drop not null;

-- A profile must be reachable by something.
alter table public.profiles
  add constraint profiles_needs_an_identity
  check (email is not null or phone is not null);

-- Phone numbers identify a person within an organization, so they must
-- not repeat there. Stored as given; normalise to E.164 in the
-- application before writing.
create unique index profiles_org_phone_key
  on public.profiles (org_id, phone)
  where phone is not null;

-- ------------------------------------------------------- signup guard
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_org uuid;
  was_invited boolean;
begin
  -- An invitation is an org_id placed in user metadata by an
  -- administrator. Anything arriving without one is self-registration,
  -- whatever provider it came through.
  target_org := nullif(new.raw_user_meta_data ->> 'org_id', '')::uuid;
  was_invited := target_org is not null;

  if target_org is null then
    select id into target_org from public.organizations where slug = 'default';
  end if;

  insert into public.profiles (id, email, phone, full_name, role, org_id, is_active)
  values (
    new.id,
    new.email,
    new.phone,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',        -- Google sends 'name'
      ''
    ),
    -- A self-registered account never chooses its own role.
    case
      when was_invited
        then coalesce((new.raw_user_meta_data ->> 'role')::public.user_role, 'sales_rep')
      else 'sales_rep'
    end,
    target_org,
    was_invited
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user is
  'Creates the profile for a new auth user. Accounts without an org_id in '
  'their metadata are created inactive, so a self-registered account can '
  'sign in but reach nothing until an administrator activates it.';

-- ------------------------------------------- keep identities in step
-- A user who adds a phone number or changes their email in Supabase Auth
-- should not drift from their profile.
create or replace function public.sync_identity_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email or new.phone is distinct from old.phone then
    update public.profiles
    set email = coalesce(new.email, email),
        phone = coalesce(new.phone, phone),
        updated_at = now()
    where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_identity_changed
  after update of email, phone on auth.users
  for each row execute function public.sync_identity_from_auth();


-- ====================================================================
-- 0018_pin_authentication.sql
-- ====================================================================
-- =====================================================================
-- 0018_pin_authentication.sql
--
-- Four-digit PIN sign-in.
--
-- HOW THE PIN IS STORED
--   Never in the clear. What is kept is an HMAC-SHA256 of the PIN under
--   a secret held only in the server environment (PIN_PEPPER), so a copy
--   of this database is not enough to recover anyone's PIN.
--
--   The digest is deterministic, which two things depend on:
--   sign-in can find the account with one indexed lookup rather than
--   testing every user in turn, and the database itself can guarantee
--   that no two active people share a PIN.
--
-- WHY UNIQUENESS IS GLOBAL, NOT PER ORGANIZATION
--   The sign-in screen asks for nothing but the PIN, so at the moment of
--   lookup there is no organization to scope by. A PIN must therefore
--   resolve to exactly one active person across the whole system. Two
--   organizations cannot each hold PIN 1024.
--
--   Inactive accounts are excluded from the constraint, so a PIN becomes
--   free for reuse once someone leaves.
--
-- WHAT THIS DOES NOT CHANGE
--   Supabase still issues and holds the session. Row level security,
--   auth_role(), organization isolation, the role escalation guard and
--   the 0017 signup guard are untouched: this migration decides who is
--   asking, and everything after that works exactly as before.
-- =====================================================================

alter table public.profiles add column pin_hash text;
alter table public.profiles add column pin_set_at timestamptz;

comment on column public.profiles.pin_hash is
  'HMAC-SHA256 of the four-digit PIN under the server-side PIN_PEPPER. '
  'Deterministic so sign-in is a single indexed lookup and uniqueness is '
  'enforceable. Never a plaintext PIN.';

-- No two active people may share a PIN, or one PIN could not identify
-- one person. Enforced here rather than in application code so a race
-- between two administrators cannot slip a duplicate through.
create unique index profiles_active_pin_key
  on public.profiles (pin_hash)
  where pin_hash is not null and is_active;

-- A PIN is a credential, so only an administrator may set someone
-- else's. Changing your own is handled by a function that requires the
-- current PIN.
create or replace function public.guard_pin_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_trusted_context()
     and new.pin_hash is distinct from old.pin_hash
     and auth.uid() <> new.id
     and not public.has_role('admin', 'senior_manager') then
    raise exception 'Only an administrator may change another user''s PIN'
      using errcode = '42501';
  end if;

  if new.pin_hash is distinct from old.pin_hash then
    new.pin_set_at := now();
  end if;

  return new;
end;
$$;

create trigger profiles_guard_pin_change
  before update on public.profiles
  for each row execute function public.guard_pin_change();

-- ------------------------------------------------- brute force defence
-- Four digits is ten thousand possibilities, so unlimited guessing would
-- find someone's PIN quickly. Attempts are recorded and throttled.
create table public.auth_pin_attempts (
  id           uuid primary key default gen_random_uuid(),
  request_ip   inet,
  user_agent   text,
  succeeded    boolean not null default false,
  -- Only set on success. A failed attempt matched nobody by definition.
  profile_id   uuid references public.profiles (id) on delete set null,
  attempted_at timestamptz not null default now()
);

create index auth_pin_attempts_by_ip
  on public.auth_pin_attempts (request_ip, attempted_at desc)
  where request_ip is not null;
create index auth_pin_attempts_recent
  on public.auth_pin_attempts (attempted_at desc);

comment on table public.auth_pin_attempts is
  'Sign-in attempt log, for rate limiting. Holds no PIN and no digest.';

-- Server-side machinery. Nothing in the browser reads this, and 0015
-- granted new tables to authenticated by default, so that is withdrawn.
alter table public.auth_pin_attempts enable row level security;
revoke all on public.auth_pin_attempts from anon, authenticated;
grant all on public.auth_pin_attempts to service_role;

-- No policy: with row level security on and none defined, a caller who
-- somehow held a privilege still reads nothing. service_role bypasses
-- row level security and is the only intended reader.

create or replace function public.purge_old_pin_attempts(older_than interval default '7 days')
returns integer
language sql
volatile
security definer
set search_path = public
as $$
  with removed as (
    delete from public.auth_pin_attempts
    where attempted_at < now() - older_than
    returning 1
  )
  select count(*)::integer from removed;
$$;

revoke all on function public.purge_old_pin_attempts(interval) from public, anon, authenticated;
grant execute on function public.purge_old_pin_attempts(interval) to service_role;

