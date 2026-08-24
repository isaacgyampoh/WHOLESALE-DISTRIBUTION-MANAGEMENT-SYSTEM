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
create extension if not exists "citext";do $enum$
declare
  found text[];
  wanted text[] := array['admin', 'manager', 'sales_rep', 'warehouse', 'accountant', 'driver', 'senior_manager', 'salesperson'];
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'user_role'
  ) then
    create type public.user_role as enum ('admin', 'manager', 'sales_rep', 'warehouse', 'accountant', 'driver', 'senior_manager', 'salesperson');
  else
    select array_agg(e.enumlabel order by e.enumsortorder) into found
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'user_role';

    -- Already correct: nothing to do, and the script carries on.
    if found is distinct from wanted then
      raise exception
        'public.user_role already exists with different values. Found %, expected %. '
        'Reconcile it before running this script; this script will not alter an '
        'enum other code may already depend on.',
        found, wanted;
    end if;
  end if;
end $enum$;
do $enum$
declare
  found text[];
  wanted text[] := array['draft', 'confirmed', 'picking', 'packed', 'shipped', 'delivered', 'cancelled'];
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'order_status'
  ) then
    create type public.order_status as enum ('draft', 'confirmed', 'picking', 'packed', 'shipped', 'delivered', 'cancelled');
  else
    select array_agg(e.enumlabel order by e.enumsortorder) into found
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'order_status';

    -- Already correct: nothing to do, and the script carries on.
    if found is distinct from wanted then
      raise exception
        'public.order_status already exists with different values. Found %, expected %. '
        'Reconcile it before running this script; this script will not alter an '
        'enum other code may already depend on.',
        found, wanted;
    end if;
  end if;
end $enum$;
do $enum$
declare
  found text[];
  wanted text[] := array['draft', 'issued', 'partially_paid', 'paid', 'overdue', 'void'];
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'invoice_status'
  ) then
    create type public.invoice_status as enum ('draft', 'issued', 'partially_paid', 'paid', 'overdue', 'void');
  else
    select array_agg(e.enumlabel order by e.enumsortorder) into found
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'invoice_status';

    -- Already correct: nothing to do, and the script carries on.
    if found is distinct from wanted then
      raise exception
        'public.invoice_status already exists with different values. Found %, expected %. '
        'Reconcile it before running this script; this script will not alter an '
        'enum other code may already depend on.',
        found, wanted;
    end if;
  end if;
end $enum$;
do $enum$
declare
  found text[];
  wanted text[] := array['draft', 'submitted', 'partially_received', 'received', 'cancelled'];
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'po_status'
  ) then
    create type public.po_status as enum ('draft', 'submitted', 'partially_received', 'received', 'cancelled');
  else
    select array_agg(e.enumlabel order by e.enumsortorder) into found
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'po_status';

    -- Already correct: nothing to do, and the script carries on.
    if found is distinct from wanted then
      raise exception
        'public.po_status already exists with different values. Found %, expected %. '
        'Reconcile it before running this script; this script will not alter an '
        'enum other code may already depend on.',
        found, wanted;
    end if;
  end if;
end $enum$;
do $enum$
declare
  found text[];
  wanted text[] := array['receipt', 'issue', 'adjustment_in', 'adjustment_out', 'transfer_in', 'transfer_out', 'customer_return', 'supplier_return', 'damage', 'shortage'];
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'movement_type'
  ) then
    create type public.movement_type as enum ('receipt', 'issue', 'adjustment_in', 'adjustment_out', 'transfer_in', 'transfer_out', 'customer_return', 'supplier_return', 'damage', 'shortage');
  else
    select array_agg(e.enumlabel order by e.enumsortorder) into found
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'movement_type';

    -- Already correct: nothing to do, and the script carries on.
    if found is distinct from wanted then
      raise exception
        'public.movement_type already exists with different values. Found %, expected %. '
        'Reconcile it before running this script; this script will not alter an '
        'enum other code may already depend on.',
        found, wanted;
    end if;
  end if;
end $enum$;
do $enum$
declare
  found text[];
  wanted text[] := array['cash', 'bank_transfer', 'cheque', 'card', 'mobile_money'];
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'payment_method'
  ) then
    create type public.payment_method as enum ('cash', 'bank_transfer', 'cheque', 'card', 'mobile_money');
  else
    select array_agg(e.enumlabel order by e.enumsortorder) into found
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'payment_method';

    -- Already correct: nothing to do, and the script carries on.
    if found is distinct from wanted then
      raise exception
        'public.payment_method already exists with different values. Found %, expected %. '
        'Reconcile it before running this script; this script will not alter an '
        'enum other code may already depend on.',
        found, wanted;
    end if;
  end if;
end $enum$;


-- ------------------------------------------------------------- profiles
-- One row per auth.users record. Holds the role that every RLS policy
-- in 0006_rls.sql keys off of.
create table if not exists public.profiles (
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
$$;drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
drop trigger if exists profiles_set_updated_at on public.profiles;
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

create table if not exists public.customers (
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


create index if not exists customers_name_idx on public.customers using gin (to_tsvector('simple', name));

create index if not exists customers_active_idx on public.customers (is_active) where is_active;


create table if not exists public.suppliers (
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


create index if not exists suppliers_active_idx on public.suppliers (is_active) where is_active;
drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();
drop trigger if exists suppliers_set_updated_at on public.suppliers;
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

create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  parent_id   uuid references public.categories (id) on delete set null,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (name, parent_id)
);


create table if not exists public.warehouses (
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
create unique index if not exists warehouses_single_default_idx
  on public.warehouses ((true)) where is_default;


create table if not exists public.products (
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


create index if not exists products_category_idx on public.products (category_id);

create index if not exists products_supplier_idx on public.products (supplier_id);

create index if not exists products_search_idx
  on public.products using gin (to_tsvector('simple', sku || ' ' || name));


-- Current stock, one row per product/warehouse pair.
create table if not exists public.inventory (
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


create index if not exists inventory_warehouse_idx on public.inventory (warehouse_id);


-- Append-only ledger. quantity is always positive; direction comes from type.
create table if not exists public.stock_movements (
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


create index if not exists stock_movements_product_idx on public.stock_movements (product_id, created_at desc);

create index if not exists stock_movements_ref_idx on public.stock_movements (reference_type, reference_id);


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
$$;drop trigger if exists stock_movements_apply on public.stock_movements;
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
$$;drop trigger if exists stock_movements_no_update on public.stock_movements;
create trigger stock_movements_no_update
  before update or delete on public.stock_movements
  for each row execute function public.block_movement_mutation();
drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at before update on public.categories
  for each row execute function public.set_updated_at();
drop trigger if exists warehouses_set_updated_at on public.warehouses;
create trigger warehouses_set_updated_at before update on public.warehouses
  for each row execute function public.set_updated_at();
drop trigger if exists products_set_updated_at on public.products;
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

create table if not exists public.sales_orders (
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


create index if not exists sales_orders_customer_idx on public.sales_orders (customer_id, order_date desc);

create index if not exists sales_orders_status_idx on public.sales_orders (status);


create table if not exists public.sales_order_items (
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


create index if not exists sales_order_items_order_idx on public.sales_order_items (order_id);


create table if not exists public.invoices (
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


create index if not exists invoices_customer_idx on public.invoices (customer_id, issue_date desc);

create index if not exists invoices_open_idx on public.invoices (status)
  where status in ('issued', 'partially_paid', 'overdue');


create table if not exists public.payments (
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


create index if not exists payments_invoice_idx on public.payments (invoice_id);


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
$$;drop trigger if exists sales_order_items_recalc on public.sales_order_items;
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
$$;drop trigger if exists payments_recalc_invoice on public.payments;
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
$$;drop trigger if exists sales_orders_status_change on public.sales_orders;
create trigger sales_orders_status_change
  before update of status on public.sales_orders
  for each row execute function public.handle_order_status_change();
drop trigger if exists sales_orders_set_updated_at on public.sales_orders;
create trigger sales_orders_set_updated_at before update on public.sales_orders
  for each row execute function public.set_updated_at();
drop trigger if exists invoices_set_updated_at on public.invoices;
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

create table if not exists public.purchase_orders (
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


create index if not exists purchase_orders_supplier_idx
  on public.purchase_orders (supplier_id, order_date desc);

create index if not exists purchase_orders_status_idx on public.purchase_orders (status);


create table if not exists public.purchase_order_items (
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


create index if not exists purchase_order_items_po_idx on public.purchase_order_items (po_id);


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
$$;drop trigger if exists purchase_order_items_recalc on public.purchase_order_items;
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
$$;drop trigger if exists purchase_orders_set_updated_at on public.purchase_orders;
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
create or replace view public.customer_balances
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
create or replace view public.stock_summary
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
create or replace view public.invoice_ageing
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
alter table public.purchase_order_items enable row level security;drop policy if exists profiles_select_self on public.profiles;
-- ------------------------------------------------------------ profiles
create policy profiles_select_self on public.profiles
  for select using (id = auth.uid() or public.has_role('admin', 'manager'));
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and role = public.auth_role());
drop policy if exists profiles_admin_all on public.profiles;
-- cannot self-promote

create policy profiles_admin_all on public.profiles
  for all using (public.has_role('admin'))
  with check (public.has_role('admin'));
drop policy if exists categories_read on public.categories;
-- ------------------------------------------------------- master data
-- Any active staff member may read the catalogue and partner lists.
create policy categories_read on public.categories
  for select using (public.is_staff());
drop policy if exists categories_write on public.categories;
create policy categories_write on public.categories
  for all using (public.has_role('admin', 'manager'))
  with check (public.has_role('admin', 'manager'));
drop policy if exists warehouses_read on public.warehouses;
create policy warehouses_read on public.warehouses
  for select using (public.is_staff());
drop policy if exists warehouses_write on public.warehouses;
create policy warehouses_write on public.warehouses
  for all using (public.has_role('admin', 'manager'))
  with check (public.has_role('admin', 'manager'));
drop policy if exists products_read on public.products;
create policy products_read on public.products
  for select using (public.is_staff());
drop policy if exists products_write on public.products;
create policy products_write on public.products
  for all using (public.has_role('admin', 'manager'))
  with check (public.has_role('admin', 'manager'));
drop policy if exists customers_read on public.customers;
create policy customers_read on public.customers
  for select using (public.is_staff());
drop policy if exists customers_write on public.customers;
create policy customers_write on public.customers
  for all using (public.has_role('admin', 'manager', 'sales_rep'))
  with check (public.has_role('admin', 'manager', 'sales_rep'));
drop policy if exists suppliers_read on public.suppliers;
create policy suppliers_read on public.suppliers
  for select using (public.is_staff());
drop policy if exists suppliers_write on public.suppliers;
create policy suppliers_write on public.suppliers
  for all using (public.has_role('admin', 'manager'))
  with check (public.has_role('admin', 'manager'));
drop policy if exists inventory_read on public.inventory;
-- ------------------------------------------------------------ stock
create policy inventory_read on public.inventory
  for select using (public.is_staff());
drop policy if exists inventory_write on public.inventory;
create policy inventory_write on public.inventory
  for all using (public.has_role('admin', 'manager', 'warehouse'))
  with check (public.has_role('admin', 'manager', 'warehouse'));
drop policy if exists stock_movements_read on public.stock_movements;
create policy stock_movements_read on public.stock_movements
  for select using (public.is_staff());
drop policy if exists stock_movements_insert on public.stock_movements;
create policy stock_movements_insert on public.stock_movements
  for insert with check (public.has_role('admin', 'manager', 'warehouse'));
drop policy if exists sales_orders_read on public.sales_orders;
-- ------------------------------------------------------ sales orders
-- Sales reps see and edit their own orders; everyone else operational
-- sees all of them.
create policy sales_orders_read on public.sales_orders
  for select using (
    public.has_role('admin', 'manager', 'warehouse', 'accountant')
    or created_by = auth.uid()
  );
drop policy if exists sales_orders_insert on public.sales_orders;
create policy sales_orders_insert on public.sales_orders
  for insert with check (
    public.has_role('admin', 'manager', 'sales_rep')
    and created_by = auth.uid()
  );
drop policy if exists sales_orders_update on public.sales_orders;
create policy sales_orders_update on public.sales_orders
  for update using (
    public.has_role('admin', 'manager', 'warehouse')
    or (public.has_role('sales_rep') and created_by = auth.uid() and status = 'draft')
  );
drop policy if exists sales_orders_delete on public.sales_orders;
create policy sales_orders_delete on public.sales_orders
  for delete using (
    public.has_role('admin')
    or (public.has_role('manager', 'sales_rep') and status = 'draft'
        and created_by = auth.uid())
  );
drop policy if exists sales_order_items_read on public.sales_order_items;
-- Line items inherit their parent order's visibility.
create policy sales_order_items_read on public.sales_order_items
  for select using (
    exists (select 1 from public.sales_orders o where o.id = order_id)
  );
drop policy if exists sales_order_items_write on public.sales_order_items;
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
drop policy if exists invoices_read on public.invoices;
-- ------------------------------------------------------- receivables
create policy invoices_read on public.invoices
  for select using (
    public.has_role('admin', 'manager', 'accountant')
    or exists (select 1 from public.sales_orders o
               where o.id = order_id and o.created_by = auth.uid())
  );
drop policy if exists invoices_write on public.invoices;
create policy invoices_write on public.invoices
  for all using (public.has_role('admin', 'manager', 'accountant'))
  with check (public.has_role('admin', 'manager', 'accountant'));
drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments
  for select using (public.has_role('admin', 'manager', 'accountant'));
drop policy if exists payments_write on public.payments;
create policy payments_write on public.payments
  for all using (public.has_role('admin', 'manager', 'accountant'))
  with check (public.has_role('admin', 'manager', 'accountant'));
drop policy if exists purchase_orders_read on public.purchase_orders;
-- --------------------------------------------------------- purchasing
create policy purchase_orders_read on public.purchase_orders
  for select using (public.has_role('admin', 'manager', 'warehouse', 'accountant'));
drop policy if exists purchase_orders_write on public.purchase_orders;
create policy purchase_orders_write on public.purchase_orders
  for all using (public.has_role('admin', 'manager'))
  with check (public.has_role('admin', 'manager'));
drop policy if exists purchase_order_items_read on public.purchase_order_items;
create policy purchase_order_items_read on public.purchase_order_items
  for select using (
    exists (select 1 from public.purchase_orders p where p.id = po_id)
  );
drop policy if exists purchase_order_items_write on public.purchase_order_items;
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
$$;drop trigger if exists profiles_guard_role_change on public.profiles;
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

create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  country     text not null default 'GH',
  currency    text not null default 'GHS',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
drop trigger if exists organizations_set_updated_at on public.organizations;
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
create unique index if not exists warehouses_single_default_idx
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
$$;drop trigger if exists profiles_guard_org_change on public.profiles;
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

alter table public.organizations enable row level security;drop policy if exists organizations_read on public.organizations;
create policy organizations_read on public.organizations
  for select using (id = public.auth_org_id());
drop policy if exists profiles_select on public.profiles;
-- ------------------------------------------------------------ profiles
create policy profiles_select on public.profiles
  for select using (
    id = auth.uid()
    or (org_id = public.auth_org_id() and public.has_role('admin', 'manager'))
  );
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid());
drop policy if exists profiles_admin_manage on public.profiles;
create policy profiles_admin_manage on public.profiles
  for all using (org_id = public.auth_org_id() and public.has_role('admin'))
  with check (org_id = public.auth_org_id() and public.has_role('admin'));
drop policy if exists categories_read on public.categories;
-- --------------------------------------------------------- master data
create policy categories_read on public.categories
  for select using (org_id = public.auth_org_id());
drop policy if exists categories_write on public.categories;
create policy categories_write on public.categories
  for all using (org_id = public.auth_org_id() and public.has_role('admin', 'manager'))
  with check (org_id = public.auth_org_id() and public.has_role('admin', 'manager'));
drop policy if exists warehouses_read on public.warehouses;
create policy warehouses_read on public.warehouses
  for select using (org_id = public.auth_org_id());
drop policy if exists warehouses_write on public.warehouses;
create policy warehouses_write on public.warehouses
  for all using (org_id = public.auth_org_id() and public.has_role('admin', 'manager'))
  with check (org_id = public.auth_org_id() and public.has_role('admin', 'manager'));
drop policy if exists products_read on public.products;
create policy products_read on public.products
  for select using (org_id = public.auth_org_id());
drop policy if exists products_write on public.products;
create policy products_write on public.products
  for all using (org_id = public.auth_org_id() and public.has_role('admin', 'manager'))
  with check (org_id = public.auth_org_id() and public.has_role('admin', 'manager'));
drop policy if exists customers_read on public.customers;
create policy customers_read on public.customers
  for select using (org_id = public.auth_org_id());
drop policy if exists customers_write on public.customers;
create policy customers_write on public.customers
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'manager', 'sales_rep'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'manager', 'sales_rep'));
drop policy if exists suppliers_read on public.suppliers;
create policy suppliers_read on public.suppliers
  for select using (org_id = public.auth_org_id());
drop policy if exists suppliers_write on public.suppliers;
create policy suppliers_write on public.suppliers
  for all using (org_id = public.auth_org_id() and public.has_role('admin', 'manager'))
  with check (org_id = public.auth_org_id() and public.has_role('admin', 'manager'));
drop policy if exists inventory_read on public.inventory;
-- --------------------------------------------------------------- stock
create policy inventory_read on public.inventory
  for select using (org_id = public.auth_org_id());
drop policy if exists inventory_write on public.inventory;
create policy inventory_write on public.inventory
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'manager', 'warehouse'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'manager', 'warehouse'));
drop policy if exists stock_movements_read on public.stock_movements;
create policy stock_movements_read on public.stock_movements
  for select using (org_id = public.auth_org_id());
drop policy if exists stock_movements_insert on public.stock_movements;
create policy stock_movements_insert on public.stock_movements
  for insert with check (org_id = public.auth_org_id()
                         and public.has_role('admin', 'manager', 'warehouse'));
drop policy if exists sales_orders_read on public.sales_orders;
-- -------------------------------------------------------- sales orders
create policy sales_orders_read on public.sales_orders
  for select using (
    org_id = public.auth_org_id()
    and (public.has_role('admin', 'manager', 'warehouse', 'accountant')
         or created_by = auth.uid())
  );
drop policy if exists sales_orders_insert on public.sales_orders;
create policy sales_orders_insert on public.sales_orders
  for insert with check (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'manager', 'sales_rep')
    and created_by = auth.uid()
  );
drop policy if exists sales_orders_update on public.sales_orders;
create policy sales_orders_update on public.sales_orders
  for update using (
    org_id = public.auth_org_id()
    and (public.has_role('admin', 'manager', 'warehouse')
         or (public.has_role('sales_rep') and created_by = auth.uid() and status = 'draft'))
  );
drop policy if exists sales_orders_delete on public.sales_orders;
create policy sales_orders_delete on public.sales_orders
  for delete using (
    org_id = public.auth_org_id()
    and (public.has_role('admin')
         or (public.has_role('manager', 'sales_rep') and status = 'draft'
             and created_by = auth.uid()))
  );
drop policy if exists sales_order_items_read on public.sales_order_items;
create policy sales_order_items_read on public.sales_order_items
  for select using (
    org_id = public.auth_org_id()
    and exists (select 1 from public.sales_orders o where o.id = order_id)
  );
drop policy if exists sales_order_items_write on public.sales_order_items;
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
drop policy if exists invoices_read on public.invoices;
-- --------------------------------------------------------- receivables
create policy invoices_read on public.invoices
  for select using (
    org_id = public.auth_org_id()
    and (public.has_role('admin', 'manager', 'accountant')
         or exists (select 1 from public.sales_orders o
                    where o.id = order_id and o.created_by = auth.uid()))
  );
drop policy if exists invoices_write on public.invoices;
create policy invoices_write on public.invoices
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'manager', 'accountant'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'manager', 'accountant'));
drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments
  for select using (org_id = public.auth_org_id()
                    and public.has_role('admin', 'manager', 'accountant'));
drop policy if exists payments_write on public.payments;
create policy payments_write on public.payments
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'manager', 'accountant'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'manager', 'accountant'));
drop policy if exists purchase_orders_read on public.purchase_orders;
-- ---------------------------------------------------------- purchasing
create policy purchase_orders_read on public.purchase_orders
  for select using (org_id = public.auth_org_id()
                    and public.has_role('admin', 'manager', 'warehouse', 'accountant'));
drop policy if exists purchase_orders_write on public.purchase_orders;
create policy purchase_orders_write on public.purchase_orders
  for all using (org_id = public.auth_org_id() and public.has_role('admin', 'manager'))
  with check (org_id = public.auth_org_id() and public.has_role('admin', 'manager'));
drop policy if exists purchase_order_items_read on public.purchase_order_items;
create policy purchase_order_items_read on public.purchase_order_items
  for select using (
    org_id = public.auth_org_id()
    and exists (select 1 from public.purchase_orders p where p.id = po_id)
  );
drop policy if exists purchase_order_items_write on public.purchase_order_items;
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
$$;drop trigger if exists inventory_fill_org on public.inventory;
create trigger inventory_fill_org before insert on public.inventory
  for each row execute function public.fill_org_from_parent('product_id', 'products');
drop trigger if exists stock_movements_fill_org on public.stock_movements;
create trigger stock_movements_fill_org before insert on public.stock_movements
  for each row execute function public.fill_org_from_parent('product_id', 'products');
drop trigger if exists sales_order_items_fill_org on public.sales_order_items;
create trigger sales_order_items_fill_org before insert on public.sales_order_items
  for each row execute function public.fill_org_from_parent('order_id', 'sales_orders');
drop trigger if exists payments_fill_org on public.payments;
create trigger payments_fill_org before insert on public.payments
  for each row execute function public.fill_org_from_parent('invoice_id', 'invoices');
drop trigger if exists purchase_order_items_fill_org on public.purchase_order_items;
create trigger purchase_order_items_fill_org before insert on public.purchase_order_items
  for each row execute function public.fill_org_from_parent('po_id', 'purchase_orders');
drop trigger if exists sales_orders_fill_org on public.sales_orders;
create trigger sales_orders_fill_org before insert on public.sales_orders
  for each row execute function public.fill_org_from_parent('customer_id', 'customers');
drop trigger if exists invoices_fill_org on public.invoices;
create trigger invoices_fill_org before insert on public.invoices
  for each row execute function public.fill_org_from_parent('customer_id', 'customers');
drop trigger if exists purchase_orders_fill_org on public.purchase_orders;
create trigger purchase_orders_fill_org before insert on public.purchase_orders
  for each row execute function public.fill_org_from_parent('supplier_id', 'suppliers');
drop trigger if exists products_fill_org on public.products;
create trigger products_fill_org before insert on public.products
  for each row execute function public.fill_org_from_parent();
drop trigger if exists customers_fill_org on public.customers;
create trigger customers_fill_org before insert on public.customers
  for each row execute function public.fill_org_from_parent();
drop trigger if exists suppliers_fill_org on public.suppliers;
create trigger suppliers_fill_org before insert on public.suppliers
  for each row execute function public.fill_org_from_parent();
drop trigger if exists categories_fill_org on public.categories;
create trigger categories_fill_org before insert on public.categories
  for each row execute function public.fill_org_from_parent();
drop trigger if exists warehouses_fill_org on public.warehouses;
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
$$;drop trigger if exists products_same_org_category on public.products;
create trigger products_same_org_category before insert or update on public.products
  for each row execute function public.assert_same_org('category_id', 'categories');
drop trigger if exists products_same_org_supplier on public.products;
create trigger products_same_org_supplier before insert or update on public.products
  for each row execute function public.assert_same_org('supplier_id', 'suppliers');
drop trigger if exists sales_orders_same_org_customer on public.sales_orders;
create trigger sales_orders_same_org_customer before insert or update on public.sales_orders
  for each row execute function public.assert_same_org('customer_id', 'customers');
drop trigger if exists sales_orders_same_org_warehouse on public.sales_orders;
create trigger sales_orders_same_org_warehouse before insert or update on public.sales_orders
  for each row execute function public.assert_same_org('warehouse_id', 'warehouses');
drop trigger if exists sales_order_items_same_org on public.sales_order_items;
create trigger sales_order_items_same_org before insert or update on public.sales_order_items
  for each row execute function public.assert_same_org('product_id', 'products');
drop trigger if exists stock_movements_same_org_wh on public.stock_movements;
create trigger stock_movements_same_org_wh before insert on public.stock_movements
  for each row execute function public.assert_same_org('warehouse_id', 'warehouses');
drop trigger if exists invoices_same_org_customer on public.invoices;
create trigger invoices_same_org_customer before insert or update on public.invoices
  for each row execute function public.assert_same_org('customer_id', 'customers');


-- Views must be org-aware too; security_invoker keeps RLS applied, but the
-- ageing view joins customers directly and is rebuilt here for clarity.
-- Dropped and recreated rather than replaced: org_id is inserted into the
-- middle of the column list, which CREATE OR REPLACE VIEW cannot do.
drop view public.customer_balances;
create or replace view public.customer_balances
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
do $enum$
declare
  found text[];
  wanted text[] := array['draft', 'loaded', 'dispatched', 'returned', 'reconciled', 'cancelled'];
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'van_load_status'
  ) then
    create type public.van_load_status as enum ('draft', 'loaded', 'dispatched', 'returned', 'reconciled', 'cancelled');
  else
    select array_agg(e.enumlabel order by e.enumsortorder) into found
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'van_load_status';

    -- Already correct: nothing to do, and the script carries on.
    if found is distinct from wanted then
      raise exception
        'public.van_load_status already exists with different values. Found %, expected %. '
        'Reconcile it before running this script; this script will not alter an '
        'enum other code may already depend on.',
        found, wanted;
    end if;
  end if;
end $enum$;
do $enum$
declare
  found text[];
  wanted text[] := array['cash', 'credit'];
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'van_sale_type'
  ) then
    create type public.van_sale_type as enum ('cash', 'credit');
  else
    select array_agg(e.enumlabel order by e.enumsortorder) into found
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'van_sale_type';

    -- Already correct: nothing to do, and the script carries on.
    if found is distinct from wanted then
      raise exception
        'public.van_sale_type already exists with different values. Found %, expected %. '
        'Reconcile it before running this script; this script will not alter an '
        'enum other code may already depend on.',
        found, wanted;
    end if;
  end if;
end $enum$;
do $enum$
declare
  found text[];
  wanted text[] := array['draft', 'completed', 'void'];
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'van_sale_status'
  ) then
    create type public.van_sale_status as enum ('draft', 'completed', 'void');
  else
    select array_agg(e.enumlabel order by e.enumsortorder) into found
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'van_sale_status';

    -- Already correct: nothing to do, and the script carries on.
    if found is distinct from wanted then
      raise exception
        'public.van_sale_status already exists with different values. Found %, expected %. '
        'Reconcile it before running this script; this script will not alter an '
        'enum other code may already depend on.',
        found, wanted;
    end if;
  end if;
end $enum$;
do $enum$
declare
  found text[];
  wanted text[] := array['draft', 'submitted', 'approved', 'rejected'];
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'van_return_status'
  ) then
    create type public.van_return_status as enum ('draft', 'submitted', 'approved', 'rejected');
  else
    select array_agg(e.enumlabel order by e.enumsortorder) into found
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'van_return_status';

    -- Already correct: nothing to do, and the script carries on.
    if found is distinct from wanted then
      raise exception
        'public.van_return_status already exists with different values. Found %, expected %. '
        'Reconcile it before running this script; this script will not alter an '
        'enum other code may already depend on.',
        found, wanted;
    end if;
  end if;
end $enum$;
do $enum$
declare
  found text[];
  wanted text[] := array['draft', 'submitted', 'approved', 'rejected', 'settled'];
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'reconciliation_status'
  ) then
    create type public.reconciliation_status as enum ('draft', 'submitted', 'approved', 'rejected', 'settled');
  else
    select array_agg(e.enumlabel order by e.enumsortorder) into found
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'reconciliation_status';

    -- Already correct: nothing to do, and the script carries on.
    if found is distinct from wanted then
      raise exception
        'public.reconciliation_status already exists with different values. Found %, expected %. '
        'Reconcile it before running this script; this script will not alter an '
        'enum other code may already depend on.',
        found, wanted;
    end if;
  end if;
end $enum$;
do $enum$
declare
  found text[];
  wanted text[] := array['charge', 'payment', 'adjustment', 'write_off'];
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'credit_txn_type'
  ) then
    create type public.credit_txn_type as enum ('charge', 'payment', 'adjustment', 'write_off');
  else
    select array_agg(e.enumlabel order by e.enumsortorder) into found
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'credit_txn_type';

    -- Already correct: nothing to do, and the script carries on.
    if found is distinct from wanted then
      raise exception
        'public.credit_txn_type already exists with different values. Found %, expected %. '
        'Reconcile it before running this script; this script will not alter an '
        'enum other code may already depend on.',
        found, wanted;
    end if;
  end if;
end $enum$;


create sequence public.van_load_seq        start 1000;
create sequence public.van_sale_seq        start 1000;
create sequence public.van_return_seq      start 1000;
create sequence public.reconciliation_seq  start 1000;
create sequence public.stock_transfer_seq  start 1000;

-- ===================================================================
-- Vans and drivers
-- ===================================================================

create table if not exists public.vans (
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


create index if not exists vans_org_idx on public.vans (org_id) where is_active;


-- Assignment history. The open row (unassigned_at is null) is current.
create table if not exists public.van_assignments (
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
create unique index if not exists van_assignments_one_active_van
  on public.van_assignments (van_id) where unassigned_at is null;

create unique index if not exists van_assignments_one_active_driver
  on public.van_assignments (driver_id) where unassigned_at is null;


create index if not exists van_assignments_driver_idx on public.van_assignments (driver_id);


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

create table if not exists public.van_inventory (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete restrict,
  van_id       uuid not null references public.vans (id) on delete cascade,
  product_id   uuid not null references public.products (id) on delete restrict,
  qty_on_hand  integer not null default 0,
  updated_at   timestamptz not null default now(),
  unique (van_id, product_id)
);


create index if not exists van_inventory_van_idx on public.van_inventory (van_id);


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

create index if not exists stock_movements_van_idx on public.stock_movements (van_id, created_at desc);


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

create table if not exists public.stock_transfers (
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


create table if not exists public.stock_transfer_items (
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

create table if not exists public.van_loads (
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


create index if not exists van_loads_van_idx on public.van_loads (van_id, load_date desc);

create index if not exists van_loads_driver_idx on public.van_loads (driver_id, load_date desc);

create index if not exists van_loads_status_idx on public.van_loads (status);


-- One open load per van at a time.
create unique index if not exists van_loads_one_open_per_van
  on public.van_loads (van_id)
  where status in ('loaded', 'dispatched');


create table if not exists public.van_load_items (
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


create index if not exists van_load_items_load_idx on public.van_load_items (load_id);


-- ===================================================================
-- Van sales
-- ===================================================================

create table if not exists public.van_sales (
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


create index if not exists van_sales_load_idx on public.van_sales (load_id);

create index if not exists van_sales_customer_idx on public.van_sales (customer_id, sold_at desc);

create index if not exists van_sales_driver_idx on public.van_sales (driver_id, sold_at desc);


create table if not exists public.van_sale_items (
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


create index if not exists van_sale_items_sale_idx on public.van_sale_items (sale_id);


-- ===================================================================
-- Customer credit ledger
-- ===================================================================

create table if not exists public.credit_transactions (
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


create index if not exists credit_transactions_customer_idx
  on public.credit_transactions (customer_id, occurred_at desc);


-- ===================================================================
-- Van returns
-- ===================================================================

create table if not exists public.van_returns (
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


create table if not exists public.van_return_items (
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


create index if not exists van_return_items_return_idx on public.van_return_items (return_id);


-- ===================================================================
-- End-of-day reconciliation
-- ===================================================================

create table if not exists public.van_reconciliations (
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


create index if not exists van_reconciliations_driver_idx
  on public.van_reconciliations (driver_id, created_at desc);

create index if not exists van_reconciliations_status_idx on public.van_reconciliations (status);


-- ===================================================================
-- Manager product scopes
-- ===================================================================

create table if not exists public.manager_category_scopes (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete restrict,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  granted_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  unique (profile_id, category_id)
);


create index if not exists manager_category_scopes_profile_idx
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
$$;drop trigger if exists vans_set_updated_at on public.vans;
create trigger vans_set_updated_at before update on public.vans
  for each row execute function public.set_updated_at();
drop trigger if exists van_loads_set_updated_at on public.van_loads;
create trigger van_loads_set_updated_at before update on public.van_loads
  for each row execute function public.set_updated_at();
drop trigger if exists van_sales_set_updated_at on public.van_sales;
create trigger van_sales_set_updated_at before update on public.van_sales
  for each row execute function public.set_updated_at();
drop trigger if exists van_returns_set_updated_at on public.van_returns;
create trigger van_returns_set_updated_at before update on public.van_returns
  for each row execute function public.set_updated_at();
drop trigger if exists van_reconciliations_set_updated_at on public.van_reconciliations;
create trigger van_reconciliations_set_updated_at before update on public.van_reconciliations
  for each row execute function public.set_updated_at();
drop trigger if exists stock_transfers_set_updated_at on public.stock_transfers;
create trigger stock_transfers_set_updated_at before update on public.stock_transfers
  for each row execute function public.set_updated_at();
drop trigger if exists vans_fill_org on public.vans;
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
drop trigger if exists van_assignments_fill_org on public.van_assignments;
create trigger van_assignments_fill_org before insert on public.van_assignments
  for each row execute function public.fill_org_from_parent('van_id', 'vans');
drop trigger if exists van_inventory_fill_org on public.van_inventory;
create trigger van_inventory_fill_org before insert on public.van_inventory
  for each row execute function public.fill_org_from_parent('van_id', 'vans');
drop trigger if exists van_loads_fill_org on public.van_loads;
create trigger van_loads_fill_org before insert on public.van_loads
  for each row execute function public.fill_org_from_parent('van_id', 'vans');
drop trigger if exists van_load_items_fill_org on public.van_load_items;
create trigger van_load_items_fill_org before insert on public.van_load_items
  for each row execute function public.fill_org_from_parent('load_id', 'van_loads');
drop trigger if exists van_sales_fill_org on public.van_sales;
create trigger van_sales_fill_org before insert on public.van_sales
  for each row execute function public.fill_org_from_parent('van_id', 'vans');
drop trigger if exists van_sale_items_fill_org on public.van_sale_items;
create trigger van_sale_items_fill_org before insert on public.van_sale_items
  for each row execute function public.fill_org_from_parent('sale_id', 'van_sales');
drop trigger if exists van_returns_fill_org on public.van_returns;
create trigger van_returns_fill_org before insert on public.van_returns
  for each row execute function public.fill_org_from_parent('van_id', 'vans');
drop trigger if exists van_return_items_fill_org on public.van_return_items;
create trigger van_return_items_fill_org before insert on public.van_return_items
  for each row execute function public.fill_org_from_parent('return_id', 'van_returns');
drop trigger if exists van_reconciliations_fill_org on public.van_reconciliations;
create trigger van_reconciliations_fill_org before insert on public.van_reconciliations
  for each row execute function public.fill_org_from_parent('van_id', 'vans');
drop trigger if exists credit_transactions_fill_org on public.credit_transactions;
create trigger credit_transactions_fill_org before insert on public.credit_transactions
  for each row execute function public.fill_org_from_parent('customer_id', 'customers');
drop trigger if exists manager_category_scopes_fill_org on public.manager_category_scopes;
create trigger manager_category_scopes_fill_org before insert on public.manager_category_scopes
  for each row execute function public.fill_org_from_parent('profile_id', 'profiles');
drop trigger if exists stock_transfers_fill_org on public.stock_transfers;
create trigger stock_transfers_fill_org before insert on public.stock_transfers
  for each row execute function public.fill_org_from_parent('from_warehouse_id', 'warehouses');
drop trigger if exists stock_transfer_items_fill_org on public.stock_transfer_items;
create trigger stock_transfer_items_fill_org before insert on public.stock_transfer_items
  for each row execute function public.fill_org_from_parent('transfer_id', 'stock_transfers');
drop trigger if exists van_sales_same_org_customer on public.van_sales;
create trigger van_sales_same_org_customer before insert or update on public.van_sales
  for each row execute function public.assert_same_org('customer_id', 'customers');
drop trigger if exists stock_movements_same_org_van on public.stock_movements;
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
$$;drop trigger if exists van_sale_items_recalc on public.van_sale_items;
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
$$;drop trigger if exists credit_transactions_stamp_author on public.credit_transactions;
create trigger credit_transactions_stamp_author before insert on public.credit_transactions
  for each row execute function public.stamp_created_by();
drop trigger if exists stock_transfers_stamp_author on public.stock_transfers;
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

drop policy products_read on public.products;drop policy if exists products_read on public.products;
create policy products_read on public.products
  for select using (
    org_id = public.auth_org_id()
    and public.can_access_product(id)
  );


drop policy products_write on public.products;drop policy if exists products_write on public.products;
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


drop policy categories_read on public.categories;drop policy if exists categories_read on public.categories;
create policy categories_read on public.categories
  for select using (
    org_id = public.auth_org_id()
    and public.can_access_category(id)
  );


-- senior_manager inherits every policy that named 'manager' before it
-- existed, so those policies are widened here.
drop policy categories_write on public.categories;drop policy if exists categories_write on public.categories;
create policy categories_write on public.categories
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'senior_manager'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager'));
drop policy if exists manager_scopes_read on public.manager_category_scopes;
create policy manager_scopes_read on public.manager_category_scopes
  for select using (
    org_id = public.auth_org_id()
    and (profile_id = auth.uid() or public.has_role('admin', 'senior_manager'))
  );
drop policy if exists manager_scopes_write on public.manager_category_scopes;
-- Only admins and senior managers grant scopes: a scoped manager must not
-- be able to widen their own access.
create policy manager_scopes_write on public.manager_category_scopes
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'senior_manager'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager'));
drop policy if exists vans_read on public.vans;
-- ================================================================
-- Vans and assignments
-- ================================================================

create policy vans_read on public.vans
  for select using (
    org_id = public.auth_org_id()
    and (not public.has_role('driver') or id = public.my_van_id())
  );
drop policy if exists vans_write on public.vans;
create policy vans_write on public.vans
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'senior_manager', 'manager'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager', 'manager'));
drop policy if exists van_assignments_read on public.van_assignments;
create policy van_assignments_read on public.van_assignments
  for select using (
    org_id = public.auth_org_id()
    and (driver_id = auth.uid()
         or public.has_role('admin', 'senior_manager', 'manager', 'warehouse'))
  );
drop policy if exists van_assignments_write on public.van_assignments;
-- A driver must never assign themselves a van.
create policy van_assignments_write on public.van_assignments
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'senior_manager', 'manager'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager', 'manager'));
drop policy if exists van_inventory_read on public.van_inventory;
create policy van_inventory_read on public.van_inventory
  for select using (
    org_id = public.auth_org_id()
    and (not public.has_role('driver') or van_id = public.my_van_id())
  );
drop policy if exists van_inventory_write on public.van_inventory;
-- Van stock is derived from the ledger; nobody edits it directly.
create policy van_inventory_write on public.van_inventory
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'senior_manager'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager'));
drop policy if exists van_loads_read on public.van_loads;
-- ================================================================
-- Loading
-- ================================================================

create policy van_loads_read on public.van_loads
  for select using (
    org_id = public.auth_org_id()
    and (driver_id = auth.uid()
         or public.has_role('admin', 'senior_manager', 'manager', 'warehouse', 'accountant'))
  );
drop policy if exists van_loads_write on public.van_loads;
create policy van_loads_write on public.van_loads
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'senior_manager', 'manager', 'warehouse'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager', 'manager', 'warehouse'));
drop policy if exists van_loads_driver_confirm on public.van_loads;
-- The driver confirms receipt of their own load, and nothing else on it.
create policy van_loads_driver_confirm on public.van_loads
  for update using (org_id = public.auth_org_id()
                    and driver_id = auth.uid()
                    and status = 'loaded')
  with check (org_id = public.auth_org_id() and driver_id = auth.uid());
drop policy if exists van_load_items_read on public.van_load_items;
create policy van_load_items_read on public.van_load_items
  for select using (
    org_id = public.auth_org_id()
    and exists (select 1 from public.van_loads l where l.id = load_id)
  );
drop policy if exists van_load_items_write on public.van_load_items;
create policy van_load_items_write on public.van_load_items
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'senior_manager', 'manager', 'warehouse'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager', 'manager', 'warehouse'));
drop policy if exists van_sales_read on public.van_sales;
-- ================================================================
-- Van sales
-- ================================================================

create policy van_sales_read on public.van_sales
  for select using (
    org_id = public.auth_org_id()
    and (driver_id = auth.uid()
         or public.has_role('admin', 'senior_manager', 'manager', 'accountant'))
  );
drop policy if exists van_sales_driver_insert on public.van_sales;
-- A driver may only sell from the van they are actually assigned to.
create policy van_sales_driver_insert on public.van_sales
  for insert with check (
    org_id = public.auth_org_id()
    and public.has_role('driver')
    and driver_id = auth.uid()
    and van_id = public.my_van_id()
  );
drop policy if exists van_sales_driver_update on public.van_sales;
create policy van_sales_driver_update on public.van_sales
  for update using (
    org_id = public.auth_org_id()
    and public.has_role('driver')
    and driver_id = auth.uid()
    and status = 'draft'
  );
drop policy if exists van_sales_manage on public.van_sales;
create policy van_sales_manage on public.van_sales
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'senior_manager', 'manager'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager', 'manager'));
drop policy if exists van_sale_items_read on public.van_sale_items;
create policy van_sale_items_read on public.van_sale_items
  for select using (
    org_id = public.auth_org_id()
    and exists (select 1 from public.van_sales s where s.id = sale_id)
  );
drop policy if exists van_sale_items_write on public.van_sale_items;
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
drop policy if exists credit_transactions_read on public.credit_transactions;
-- ================================================================
-- Credit
-- ================================================================

create policy credit_transactions_read on public.credit_transactions
  for select using (
    org_id = public.auth_org_id()
    and (public.has_role('admin', 'senior_manager', 'manager', 'accountant')
         or created_by = auth.uid())
  );
drop policy if exists credit_transactions_insert on public.credit_transactions;
-- Drivers record collections in the field; nobody edits history afterwards.
create policy credit_transactions_insert on public.credit_transactions
  for insert with check (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'accountant', 'driver')
  );
drop policy if exists credit_transactions_manage on public.credit_transactions;
create policy credit_transactions_manage on public.credit_transactions
  for update using (org_id = public.auth_org_id()
                    and public.has_role('admin', 'senior_manager', 'accountant'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager', 'accountant'));
drop policy if exists van_returns_read on public.van_returns;
-- ================================================================
-- Returns
-- ================================================================

create policy van_returns_read on public.van_returns
  for select using (
    org_id = public.auth_org_id()
    and (driver_id = auth.uid()
         or public.has_role('admin', 'senior_manager', 'manager', 'warehouse', 'accountant'))
  );
drop policy if exists van_returns_driver on public.van_returns;
create policy van_returns_driver on public.van_returns
  for insert with check (
    org_id = public.auth_org_id()
    and public.has_role('driver')
    and driver_id = auth.uid()
  );
drop policy if exists van_returns_driver_update on public.van_returns;
create policy van_returns_driver_update on public.van_returns
  for update using (
    org_id = public.auth_org_id()
    and public.has_role('driver')
    and driver_id = auth.uid()
    and status = 'draft'
  );
drop policy if exists van_returns_manage on public.van_returns;
create policy van_returns_manage on public.van_returns
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'senior_manager', 'manager', 'warehouse'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager', 'manager', 'warehouse'));
drop policy if exists van_return_items_read on public.van_return_items;
create policy van_return_items_read on public.van_return_items
  for select using (
    org_id = public.auth_org_id()
    and exists (select 1 from public.van_returns r where r.id = return_id)
  );
drop policy if exists van_return_items_write on public.van_return_items;
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
drop policy if exists van_reconciliations_read on public.van_reconciliations;
-- ================================================================
-- Reconciliation
-- ================================================================

create policy van_reconciliations_read on public.van_reconciliations
  for select using (
    org_id = public.auth_org_id()
    and (driver_id = auth.uid()
         or public.has_role('admin', 'senior_manager', 'manager', 'accountant'))
  );
drop policy if exists van_reconciliations_driver on public.van_reconciliations;
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
drop policy if exists van_reconciliations_manage on public.van_reconciliations;
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
drop policy if exists stock_transfers_read on public.stock_transfers;
-- ================================================================
-- Transfers
-- ================================================================

create policy stock_transfers_read on public.stock_transfers
  for select using (org_id = public.auth_org_id());
drop policy if exists stock_transfers_write on public.stock_transfers;
create policy stock_transfers_write on public.stock_transfers
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'senior_manager', 'manager', 'warehouse'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager', 'manager', 'warehouse'));
drop policy if exists stock_transfer_items_read on public.stock_transfer_items;
create policy stock_transfer_items_read on public.stock_transfer_items
  for select using (
    org_id = public.auth_org_id()
    and exists (select 1 from public.stock_transfers t where t.id = transfer_id)
  );
drop policy if exists stock_transfer_items_write on public.stock_transfer_items;
create policy stock_transfer_items_write on public.stock_transfer_items
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'senior_manager', 'manager', 'warehouse'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager', 'manager', 'warehouse'));


-- ================================================================
-- Widen existing policies to include senior_manager and let drivers
-- see the customers and stock they need to do their job.
-- ================================================================

drop policy customers_write on public.customers;drop policy if exists customers_write on public.customers;
create policy customers_write on public.customers
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'senior_manager', 'manager', 'sales_rep', 'driver'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager', 'manager', 'sales_rep', 'driver'));


drop policy warehouses_write on public.warehouses;drop policy if exists warehouses_write on public.warehouses;
create policy warehouses_write on public.warehouses
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'senior_manager', 'manager'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager', 'manager'));


-- Drivers have no business writing warehouse stock.
drop policy inventory_write on public.inventory;drop policy if exists inventory_write on public.inventory;
create policy inventory_write on public.inventory
  for all using (org_id = public.auth_org_id()
                 and public.has_role('admin', 'senior_manager', 'manager', 'warehouse'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager', 'manager', 'warehouse'));


drop policy stock_movements_insert on public.stock_movements;drop policy if exists stock_movements_insert on public.stock_movements;
create policy stock_movements_insert on public.stock_movements
  for insert with check (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'warehouse')
  );


drop policy profiles_admin_manage on public.profiles;drop policy if exists profiles_admin_manage on public.profiles;
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
create or replace view public.customer_statement
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
create or replace view public.customer_credit_position
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
create or replace view public.van_stock_summary
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
create or replace view public.van_load_summary
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
create or replace view public.reconciliation_variances
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
create unique index if not exists profiles_org_phone_key
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
$$;drop trigger if exists on_auth_user_identity_changed on auth.users;
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
create unique index if not exists profiles_active_pin_key
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
$$;drop trigger if exists profiles_guard_pin_change on public.profiles;
create trigger profiles_guard_pin_change
  before update on public.profiles
  for each row execute function public.guard_pin_change();


-- ------------------------------------------------- brute force defence
-- Four digits is ten thousand possibilities, so unlimited guessing would
-- find someone's PIN quickly. Attempts are recorded and throttled.
create table if not exists public.auth_pin_attempts (
  id           uuid primary key default gen_random_uuid(),
  request_ip   inet,
  user_agent   text,
  succeeded    boolean not null default false,
  -- Only set on success. A failed attempt matched nobody by definition.
  profile_id   uuid references public.profiles (id) on delete set null,
  attempted_at timestamptz not null default now()
);


create index if not exists auth_pin_attempts_by_ip
  on public.auth_pin_attempts (request_ip, attempted_at desc)
  where request_ip is not null;

create index if not exists auth_pin_attempts_recent
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


-- ====================================================================
-- 0019_audit_log.sql
-- ====================================================================
-- =====================================================================
-- 0019_audit_log.sql
--
-- A record of who changed what about whom.
--
-- Append-only, in the same spirit as the stock ledger: an audit trail an
-- administrator can edit is not an audit trail. Updates and deletes are
-- refused by trigger and the privileges are withheld as well, so the
-- attempt fails before it is tried.
--
-- Secrets never enter it. A trigger strips known credential keys from
-- the before and after snapshots, so a careless caller cannot write a
-- PIN digest into the log by passing a whole row.
-- =====================================================================

create table if not exists public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete restrict,

  -- Who acted. The name is copied rather than joined so the entry still
  -- reads years later, after the actor's account has gone.
  actor_id     uuid references public.profiles (id) on delete set null,
  actor_name   text not null default '',
  actor_role   public.user_role,

  action       text not null,
  target_type  text not null,
  target_id    uuid,
  target_label text,

  -- Only the fields that changed, not whole rows.
  before       jsonb,
  after        jsonb,

  request_ip   inet,
  user_agent   text,
  occurred_at  timestamptz not null default now()
);


create index if not exists audit_log_org_time on public.audit_log (org_id, occurred_at desc);

create index if not exists audit_log_actor on public.audit_log (actor_id, occurred_at desc);

create index if not exists audit_log_target on public.audit_log (target_type, target_id, occurred_at desc);

create index if not exists audit_log_action on public.audit_log (action, occurred_at desc);


comment on table public.audit_log is
  'Append-only record of administrative actions. Never holds a PIN, a '
  'PIN digest or any other secret.';

-- ------------------------------------------------------- append only
create or replace function public.block_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only; history cannot be altered'
    using errcode = '42501';
end;
$$;drop trigger if exists audit_log_no_update on public.audit_log;
create trigger audit_log_no_update
  before update or delete on public.audit_log
  for each row execute function public.block_audit_mutation();


-- ------------------------------------------------ secrets never enter
create or replace function public.redact_audit_secrets()
returns trigger
language plpgsql
as $$
declare
  secret_keys text[] := array[
    'pin', 'pin_hash', 'pin_salt', 'password', 'token', 'secret',
    'api_key', 'service_role_key', 'code_hash'
  ];
  key text;
begin
  foreach key in array secret_keys loop
    if new.before ? key then new.before := new.before - key; end if;
    if new.after ? key then new.after := new.after - key; end if;
  end loop;
  return new;
end;
$$;drop trigger if exists audit_log_redact on public.audit_log;
create trigger audit_log_redact
  before insert on public.audit_log
  for each row execute function public.redact_audit_secrets();


-- ------------------------------------------------------------ access
alter table public.audit_log enable row level security;

-- 0015 grants new tables to authenticated by default. Reading is right
-- for an administrator; writing never is, because entries come from
-- server actions running as the service role.
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
grant all on public.audit_log to service_role;drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log
  for select using (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager')
  );


-- No insert, update or delete policy for authenticated. Even with a
-- privilege granted by mistake, row level security would refuse.


-- ====================================================================
-- 0020_category_status.sql
-- ====================================================================
-- =====================================================================
-- 0020_category_status.sql
--
-- Lets a category be retired without being destroyed.
--
-- Categories are referenced by products, and products by stock
-- movements, sales and van loads. Deleting one would either fail on a
-- foreign key or, worse, orphan history. Retiring it keeps every past
-- record readable while removing the category from future use.
--
-- Products already work this way (products.is_active). This brings
-- categories into line.
--
-- Nothing else changes: the manager category scopes from 0011, the
-- can_access_category() helper and every policy that depends on them
-- are untouched.
-- =====================================================================

alter table public.categories
  add column is_active boolean not null default true;

comment on column public.categories.is_active is
  'A retired category keeps its products and their history but is not '
  'offered when creating or reassigning a product.';

-- Category lists are almost always filtered by status within one
-- organization.
create index if not exists categories_org_active_idx
  on public.categories (org_id, is_active);


-- The reporting view gains the two columns the product screens filter
-- on, so a product list does not have to join twice to show stock.
-- Appended at the end: CREATE OR REPLACE VIEW cannot reorder columns.
create or replace view public.stock_summary
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
    coalesce(sum(inv.qty_available), 0) <= p.reorder_point as needs_reorder,
    p.org_id,
    p.category_id,
    p.unit_of_measure,
    p.is_active
  from public.products p
  left join public.inventory inv on inv.product_id = p.id
  where p.is_active
  group by p.id, p.sku, p.name, p.reorder_point, p.reorder_qty,
           p.cost_price, p.list_price, p.org_id, p.category_id,
           p.unit_of_measure, p.is_active;

-- ------------------------------------------------- stock stays derived
-- The whole inventory design rests on quantities coming from the ledger,
-- yet inventory was directly writable by an administrator, a manager or
-- a warehouse controller. The application never does it, but a principle
-- the database does not enforce is a principle that will eventually be
-- broken.
--
-- Quantities are now written only by the triggers and functions that
-- post movements, which run as their owner and are unaffected by this.
-- bin_location stays editable: it describes where stock sits, not how
-- much there is.
revoke insert, update, delete on public.inventory from authenticated;
grant select on public.inventory to authenticated;
grant update (bin_location) on public.inventory to authenticated;

comment on table public.inventory is
  'Derived stock levels. Written only by the movement triggers; a '
  'signed-in user may read it and set a bin location, nothing more.';


-- ====================================================================
-- 0021_audit_tenant_purge.sql
-- ====================================================================
-- ===================================================================
-- 0021  Removing a tenant must remain possible
-- ===================================================================
--
-- audit_log is append-only, enforced two ways: `authenticated` is
-- granted SELECT and nothing else, and a trigger refuses UPDATE and
-- DELETE for everyone including the service role.
--
-- That second guard was absolute, and it made a whole class of
-- operation impossible. audit_log.org_id references organizations with
-- ON DELETE RESTRICT, so once an organization had a single audited
-- action its row could never be removed: the audit entries could not be
-- deleted, and the organization could not be deleted while they existed.
-- `npm run demo:clean` hit exactly this and left the demo tenant behind.
--
-- The rule worth keeping is that history is never *rewritten*, and that
-- nobody reaching the database through the Data API can touch it at all.
-- Neither is weakened here:
--
--   * UPDATE stays refused for every caller, without exception. An
--     audit entry that says something other than what happened is the
--     failure this table exists to prevent.
--   * DELETE stays refused for every caller that is not a trusted
--     server-side role. anon and authenticated are not trusted, and
--     `authenticated` has no DELETE privilege to begin with, so for a
--     signed-in user nothing changes.
--   * DELETE by a trusted role is now permitted, which is what removing
--     a tenant and honouring a retention policy both require.
--
-- A caller holding the service role could already read every row in
-- every table and write to any of them; this does not widen what such a
-- key can reach.

create or replace function public.block_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and public.is_trusted_context() then
    -- Removing a tenant, or ageing out history under a retention
    -- policy. Never reachable from the Data API.
    return old;
  end if;

  raise exception 'audit_log is append-only; history cannot be altered'
    using errcode = '42501';
end;
$$;

comment on function public.block_audit_mutation is
  'Refuses every UPDATE, and every DELETE except from a trusted '
  'server-side role. Rewriting history is never allowed; removing a '
  'tenant wholesale is.';do $enum$
declare
  found text[];
  wanted text[] := array['applied', 'failed', 'conflict'];
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'sync_status'
  ) then
    create type public.sync_status as enum ('applied', 'failed', 'conflict');
  else
    select array_agg(e.enumlabel order by e.enumsortorder) into found
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'sync_status';

    -- Already correct: nothing to do, and the script carries on.
    if found is distinct from wanted then
      raise exception
        'public.sync_status already exists with different values. Found %, expected %. '
        'Reconcile it before running this script; this script will not alter an '
        'enum other code may already depend on.',
        found, wanted;
    end if;
  end if;
end $enum$;
do $enum$
declare
  found text[];
  wanted text[] := array['van_sale', 'collection', 'van_return', 'reconciliation'];
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'sync_operation'
  ) then
    create type public.sync_operation as enum ('van_sale', 'collection', 'van_return', 'reconciliation');
  else
    select array_agg(e.enumlabel order by e.enumsortorder) into found
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'sync_operation';

    -- Already correct: nothing to do, and the script carries on.
    if found is distinct from wanted then
      raise exception
        'public.sync_operation already exists with different values. Found %, expected %. '
        'Reconcile it before running this script; this script will not alter an '
        'enum other code may already depend on.',
        found, wanted;
    end if;
  end if;
end $enum$;


create table if not exists public.sync_operations (
  -- Generated on the device. This is what makes a retry safe.
  id            uuid primary key,
  org_id        uuid not null references public.organizations(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  device_id     text not null,
  operation     public.sync_operation not null,
  payload       jsonb not null,
  status        public.sync_status not null,
  result        jsonb,
  error         text,
  attempts      integer not null default 1,
  -- When the driver performed it, as the device saw it. Kept apart
  -- from received_at: the gap between them is how long the round was
  -- offline, and it is the first thing anyone investigating a
  -- discrepancy wants to see.
  occurred_at   timestamptz not null,
  received_at   timestamptz not null default now(),
  constraint sync_operations_device_not_blank check (length(trim(device_id)) > 0),
  constraint sync_operations_attempts_sane check (attempts between 1 and 1000)
);


comment on table public.sync_operations is
  'One row per offline mutation, keyed by a client-generated uuid so a '
  'retried upload cannot apply the same work twice. Never holds a '
  'credential.';
comment on column public.sync_operations.id is
  'Idempotency key, generated on the device before queueing.';

create index if not exists sync_operations_org_time on public.sync_operations (org_id, received_at desc);

create index if not exists sync_operations_profile on public.sync_operations (profile_id, received_at desc);

create index if not exists sync_operations_status on public.sync_operations (org_id, status, received_at desc);


alter table public.sync_operations enable row level security;drop policy if exists sync_operations_select on public.sync_operations;
-- A person sees their own sync history. A supervisor sees the
-- organization's, because a failed sale that never arrived is an
-- operational problem, not a private one.
create policy sync_operations_select on public.sync_operations
  for select using (
    org_id = public.auth_org_id()
    and (
      profile_id = auth.uid()
      or public.has_role('admin', 'senior_manager', 'manager', 'accountant')
    )
  );


-- Nothing writes here through the Data API. Rows are written by
-- sync_submit(), which is SECURITY DEFINER and re-checks authorization.
revoke all on public.sync_operations from anon, authenticated;
grant select on public.sync_operations to authenticated;
grant all on public.sync_operations to service_role;

-- History of what a device did is not editable, for the same reason the
-- audit trail is not.
create or replace function public.block_sync_mutation()
returns trigger
language plpgsql
as $$
begin
  if public.is_trusted_context() then
    return case tg_op when 'DELETE' then old else new end;
  end if;
  raise exception 'sync history cannot be altered'
    using errcode = '42501';
end;
$$;drop trigger if exists sync_operations_no_edit on public.sync_operations;
create trigger sync_operations_no_edit
  before update or delete on public.sync_operations
  for each row execute function public.block_sync_mutation();


-- ------------------------------------------------------------------
-- Applying a queued operation
-- ------------------------------------------------------------------
--
-- One entry point for every offline mutation. It is deliberately the
-- only way a queued operation reaches the business functions, so the
-- idempotency check cannot be skipped by calling the underlying
-- function directly from the client.
create or replace function public.sync_submit(
  p_id           uuid,
  p_device_id    text,
  p_operation    public.sync_operation,
  p_payload      jsonb,
  p_occurred_at  timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing   public.sync_operations;
  actor      uuid := auth.uid();
  org        uuid;
  outcome    jsonb;
  line       jsonb;
  sale       public.van_sales;
  ret        public.van_returns;
  recon      public.van_reconciliations;
  load_row   public.van_loads;
  v_customer uuid;
  v_van      uuid;
  v_avail    integer;
begin
  -- Authorization is re-derived here, from the session doing the
  -- syncing. Anything the payload says about who the driver is or what
  -- they may do is ignored.
  perform public.require_role(
    'admin', 'senior_manager', 'manager', 'accountant', 'sales_rep', 'driver');

  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select org_id into org from public.profiles where id = actor;
  if org is null then
    raise exception 'No profile for the calling user' using errcode = '42501';
  end if;

  -- Already seen? Hand back exactly what happened the first time. This
  -- is the whole point: a retry is free and cannot double-apply.
  select * into existing from public.sync_operations where id = p_id;
  if found then
    -- A key belonging to somebody else is not a replay, it is a
    -- collision or an attack. Say nothing about the original.
    if existing.profile_id <> actor then
      raise exception 'Operation % is not yours', p_id using errcode = '42501';
    end if;
    return jsonb_build_object(
      'id', existing.id,
      'status', existing.status,
      'result', existing.result,
      'error', existing.error,
      'replayed', true
    );
  end if;

  begin
    case p_operation

      -- ---------------------------------------------------------- sale
      when 'van_sale' then
        v_customer := (p_payload ->> 'customer_id')::uuid;
        select * into load_row from public.van_loads
         where id = (p_payload ->> 'load_id')::uuid;

        if load_row.id is null then
          raise exception 'That load no longer exists';
        end if;
        if load_row.org_id <> org then
          raise exception 'That load belongs to another organization';
        end if;
        if load_row.status not in ('dispatched', 'loaded') then
          raise exception 'Load % is % and cannot take further sales',
            load_row.load_number, load_row.status;
        end if;
        if not exists (select 1 from public.customers
                        where id = v_customer and org_id = org and is_active) then
          raise exception 'That customer is no longer active';
        end if;

        v_van := load_row.van_id;

        insert into public.van_sales (
          org_id, load_id, van_id, driver_id, customer_id,
          sale_type, status, sold_at, due_date, notes,
          latitude, longitude
        ) values (
          org, load_row.id, v_van, load_row.driver_id, v_customer,
          (p_payload ->> 'sale_type')::public.van_sale_type, 'draft',
          p_occurred_at,
          nullif(p_payload ->> 'due_date', '')::date,
          nullif(p_payload ->> 'notes', ''),
          nullif(p_payload ->> 'latitude', '')::numeric,
          nullif(p_payload ->> 'longitude', '')::numeric
        ) returning * into sale;

        for line in select * from jsonb_array_elements(p_payload -> 'lines') loop
          -- The van must actually be carrying it. A sale made offline
          -- against stock that was never on board is a conflict, not a
          -- sale, and it is caught here rather than going through.
          select qty_on_hand into v_avail from public.van_inventory
           where van_id = v_van and product_id = (line ->> 'product_id')::uuid;

          if coalesce(v_avail, 0) < (line ->> 'quantity')::integer then
            raise exception 'Only % of that product on the van, % were sold',
              coalesce(v_avail, 0), (line ->> 'quantity')::integer;
          end if;

          insert into public.van_sale_items (
            org_id, sale_id, product_id, quantity, unit_price, discount_pct, tax_rate
          ) values (
            org, sale.id, (line ->> 'product_id')::uuid,
            (line ->> 'quantity')::integer,
            (line ->> 'unit_price')::numeric,
            coalesce((line ->> 'discount_pct')::numeric, 0),
            coalesce((line ->> 'tax_rate')::numeric, 0)
          );
        end loop;

        -- The existing business function moves the stock and puts a
        -- credit sale on the customer ledger. None of that is
        -- reimplemented here.
        sale := public.complete_van_sale(
          sale.id, nullif(p_payload ->> 'amount_paid', '')::numeric);

        outcome := jsonb_build_object(
          'sale_id', sale.id, 'sale_number', sale.sale_number,
          'total', sale.total, 'balance', sale.balance);

      -- ---------------------------------------------------- collection
      when 'collection' then
        v_customer := (p_payload ->> 'customer_id')::uuid;
        if not exists (select 1 from public.customers where id = v_customer and org_id = org) then
          raise exception 'That customer no longer exists';
        end if;

        perform public.record_credit_payment(
          v_customer,
          (p_payload ->> 'amount')::numeric,
          coalesce((p_payload ->> 'method')::public.payment_method, 'cash'),
          nullif(p_payload ->> 'notes', ''));

        outcome := jsonb_build_object(
          'customer_id', v_customer, 'amount', (p_payload ->> 'amount')::numeric);

      -- -------------------------------------------------------- return
      when 'van_return' then
        select * into load_row from public.van_loads
         where id = (p_payload ->> 'load_id')::uuid;
        if load_row.id is null or load_row.org_id <> org then
          raise exception 'That load no longer exists';
        end if;

        insert into public.van_returns (
          org_id, load_id, van_id, driver_id, warehouse_id,
          status, returned_at, notes
        ) values (
          org, load_row.id, load_row.van_id, load_row.driver_id,
          load_row.warehouse_id, 'draft', p_occurred_at,
          nullif(p_payload ->> 'notes', '')
        ) returning * into ret;

        for line in select * from jsonb_array_elements(p_payload -> 'lines') loop
          insert into public.van_return_items (
            org_id, return_id, product_id,
            qty_expected, qty_returned_good, qty_damaged, damage_reason
          ) values (
            org, ret.id, (line ->> 'product_id')::uuid,
            (line ->> 'qty_expected')::integer,
            (line ->> 'qty_returned_good')::integer,
            coalesce((line ->> 'qty_damaged')::integer, 0),
            nullif(line ->> 'damage_reason', '')
          );
        end loop;

        update public.van_returns set status = 'submitted' where id = ret.id;

        outcome := jsonb_build_object(
          'return_id', ret.id, 'return_number', ret.return_number);

      -- ------------------------------------------------ reconciliation
      when 'reconciliation' then
        select * into recon from public.van_reconciliations
         where id = (p_payload ->> 'reconciliation_id')::uuid;

        if recon.id is null then
          recon := public.build_reconciliation((p_payload ->> 'load_id')::uuid);
        end if;
        if recon.org_id <> org then
          raise exception 'That reconciliation belongs to another organization';
        end if;
        if recon.status <> 'draft' then
          raise exception 'Reconciliation % has already been submitted', recon.recon_number;
        end if;

        update public.van_reconciliations set
          status        = 'submitted',
          actual_cash   = (p_payload ->> 'actual_cash')::numeric,
          explanation   = nullif(p_payload ->> 'explanation', ''),
          submitted_by  = actor,
          submitted_at  = p_occurred_at
        where id = recon.id
        returning * into recon;

        outcome := jsonb_build_object(
          'reconciliation_id', recon.id, 'recon_number', recon.recon_number,
          'cash_variance', recon.cash_variance);
    end case;

    insert into public.sync_operations (
      id, org_id, profile_id, device_id, operation, payload,
      status, result, occurred_at
    ) values (
      p_id, org, actor, p_device_id, p_operation, p_payload,
      'applied', outcome, p_occurred_at
    );

    return jsonb_build_object(
      'id', p_id, 'status', 'applied', 'result', outcome, 'replayed', false);

  exception when others then
    -- The work is rolled back to the savepoint this block opened, but
    -- the verdict is kept: the driver is told what went wrong, and the
    -- same key is never retried into the same failure. A message about
    -- stock or a retired product is a conflict the driver has to see;
    -- anything else is a plain failure.
    insert into public.sync_operations (
      id, org_id, profile_id, device_id, operation, payload,
      status, error, occurred_at
    ) values (
      p_id, org, actor, p_device_id, p_operation, p_payload,
      case
        when sqlerrm ilike '%on the van%'
          or sqlerrm ilike '%no longer%'
          or sqlerrm ilike '%already been%'
          or sqlerrm ilike '%cannot take further%'
        then 'conflict'::public.sync_status
        else 'failed'::public.sync_status
      end,
      sqlerrm, p_occurred_at
    );

    return jsonb_build_object(
      'id', p_id,
      'status', case
        when sqlerrm ilike '%on the van%'
          or sqlerrm ilike '%no longer%'
          or sqlerrm ilike '%already been%'
          or sqlerrm ilike '%cannot take further%'
        then 'conflict' else 'failed' end,
      'error', sqlerrm,
      'replayed', false);
  end;
end;
$$;

comment on function public.sync_submit is
  'The single entry point for a queued offline mutation. Idempotent on '
  'the client-generated id; re-derives authorization from the calling '
  'session and never from the payload.';

revoke all on function public.sync_submit(uuid, text, public.sync_operation, jsonb, timestamptz) from public, anon;
grant execute on function public.sync_submit(uuid, text, public.sync_operation, jsonb, timestamptz) to authenticated, service_role;

-- ------------------------------------------------------------------
-- What a device needs cached to work offline
-- ------------------------------------------------------------------
create or replace function public.sync_bootstrap()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  org   uuid;
  van   uuid;
  out   jsonb;
begin
  perform public.require_role(
    'admin', 'senior_manager', 'manager', 'accountant', 'sales_rep', 'driver');
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select org_id into org from public.profiles where id = actor;
  van := public.my_van_id();

  -- Deliberately narrow: what a driver needs to sell from the van they
  -- are on, and nothing else. A phone that is lost should not be
  -- carrying the whole customer book or the cost price of every line.
  select jsonb_build_object(
    'cached_at', now(),
    'van', (
      select jsonb_build_object('id', v.id, 'code', v.code, 'registration_no', v.registration_no)
        from public.vans v where v.id = van
    ),
    'load', (
      select jsonb_build_object(
               'id', l.id, 'load_number', l.load_number,
               'status', l.status, 'opening_float', l.opening_float)
        from public.van_loads l
       where l.van_id = van and l.status in ('loaded', 'dispatched')
       order by l.load_date desc limit 1
    ),
    'stock', coalesce((
      select jsonb_agg(jsonb_build_object(
               'product_id', s.product_id, 'sku', s.sku, 'name', s.product_name,
               'qty_on_hand', s.qty_on_hand))
        from public.van_stock_summary s where s.van_id = van
    ), '[]'::jsonb),
    'prices', coalesce((
      select jsonb_agg(jsonb_build_object(
               'product_id', i.product_id, 'unit_price', i.unit_price,
               'tax_rate', p.tax_rate))
        from public.van_load_items i
        join public.products p on p.id = i.product_id
       where i.load_id = (
         select l.id from public.van_loads l
          where l.van_id = van and l.status in ('loaded', 'dispatched')
          order by l.load_date desc limit 1)
    ), '[]'::jsonb),
    'customers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'code', c.code, 'name', c.name, 'phone', c.phone,
               'balance', coalesce(cp.ledger_balance, 0),
               'credit_available', coalesce(cp.credit_available, c.credit_limit)))
        from public.customers c
        left join public.customer_credit_position cp on cp.customer_id = c.id
       where c.org_id = org and c.is_active
    ), '[]'::jsonb)
  ) into out;

  return out;
end;
$$;

comment on function public.sync_bootstrap is
  'The snapshot a device caches to keep working without a connection: '
  'the van, its load, what is on board, and the active customers.';

revoke all on function public.sync_bootstrap() from public, anon;
grant execute on function public.sync_bootstrap() to authenticated, service_role;


-- ====================================================================
-- 0023_cost_is_management_information.sql
-- ====================================================================
-- ===================================================================
-- 0023  Cost price is management information
-- ===================================================================
--
-- A driver could read what the business pays for its goods.
--
--   select cost_price from products;          -- worked
--   select stock_value from van_stock_summary;-- worked
--   select unit_cost from van_load_items;     -- worked
--   select * from purchase_orders;            -- worked
--
-- and the products screen rendered a Cost column to them. Margin is the
-- single most commercially sensitive number a distributor has, and a
-- driver spends the day standing in front of the customers it is being
-- earned from.
--
-- Hiding the column in the interface would have been decoration: every
-- one of those reads is available to anything holding the anon key and
-- a driver's session. So it is closed here.
--
-- WHAT DECIDES ACCESS
--
-- The roles that price goods, buy them, or account for them:
--
--   admin, senior_manager, manager, accountant, warehouse
--
-- Everyone else - driver, sales_rep - sees the selling price and
-- nothing behind it. That is not a comment on trust; it is the
-- ordinary separation between the people who sell and the people who
-- set the terms.
--
-- HOW
--
-- PostgreSQL has no column-level row security, and every signed-in user
-- of this application is the same database role (`authenticated`), so a
-- column grant cannot tell a driver from an administrator. What can is
-- a SECURITY DEFINER function that asks who is calling. The privilege
-- to read the raw column is withdrawn, and the only way to it is
-- through a function that answers NULL to anyone without the role.

-- ------------------------------------------------------------------
-- The one door to a cost figure
-- ------------------------------------------------------------------
create or replace function public.product_cost(p_product uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Definer rights, so this can read a column the caller cannot. That
  -- makes the role check below the whole of the control, which is why
  -- it comes first and returns NULL rather than raising: a masked view
  -- should show a blank cell, not fail the query it sits in.
  if not public.has_role('admin', 'senior_manager', 'manager', 'accountant', 'warehouse') then
    return null;
  end if;

  -- Still scoped to the caller's own organization. Definer rights would
  -- otherwise reach across tenants.
  return (
    select p.cost_price
      from public.products p
     where p.id = p_product
       and p.org_id = public.auth_org_id()
  );
end;
$$;

comment on function public.product_cost is
  'The cost of a product, or NULL to anyone whose role does not include '
  'pricing, purchasing or accounting. The only route to cost for a Data '
  'API caller.';

revoke all on function public.product_cost(uuid) from public, anon;
grant execute on function public.product_cost(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- Withdraw the raw columns
-- ------------------------------------------------------------------
-- Named columns rather than the whole table: a driver still needs the
-- selling price, the unit, the reorder point and everything else on a
-- product to do their job.
-- A column-level REVOKE does not override a table-level GRANT: a role
-- holding `select` on the table reads every column of it regardless.
-- That is what the first attempt at this migration got wrong, and why
-- it was tested rather than believed. The table grant has to go,
-- replaced by one naming every column except the withheld one - built
-- from the catalogue, so a column added later is granted rather than
-- silently dropped.
do $columns$
declare
  target record;
  cols   text;
begin
  for target in
    select * from (values
      ('products',             'cost_price'),
      ('van_load_items',       'unit_cost'),
      ('purchase_order_items', 'unit_cost')
    ) as t(tbl, withheld)
  loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
      into cols
      from information_schema.columns
     where table_schema = 'public'
       and table_name = target.tbl
       and column_name <> target.withheld;

    execute format('revoke select on public.%I from anon, authenticated', target.tbl);
    execute format('grant select (%s) on public.%I to authenticated', cols, target.tbl);
  end loop;
end
$columns$;

-- ------------------------------------------------------------------
-- A product as the application should read it
-- ------------------------------------------------------------------
-- Everything on the product except the raw cost, plus a cost that is
-- masked per caller. security_invoker keeps row level security working
-- as it does on the table itself.
create or replace view public.products_priced
with (security_invoker = on) as
  select
    p.id, p.org_id, p.sku, p.barcode, p.name, p.description,
    p.category_id, p.supplier_id, p.unit_of_measure, p.units_per_case,
    p.list_price, p.tax_rate, p.reorder_point, p.reorder_qty,
    p.is_active, p.created_at, p.updated_at,
    public.product_cost(p.id) as cost_price
  from public.products p;

comment on view public.products_priced is
  'Products with cost masked per caller. Read this rather than the '
  'table wherever a cost figure is displayed.';

grant select on public.products_priced to authenticated, service_role;

-- ------------------------------------------------------------------
-- The reporting views leaked cost as a computed value
-- ------------------------------------------------------------------
-- stock_value is quantity times cost. Publishing it is publishing cost,
-- so it is masked the same way: a driver gets the quantity and a blank
-- value, which is exactly what they need to sell from a van.
-- Column order is preserved exactly: `create or replace view` refuses to
-- rename or reorder, and a drop would take the views built on top of it.
create or replace view public.stock_summary
with (security_invoker = on) as
  select
    p.id                              as product_id,
    p.sku,
    p.name,
    p.reorder_point,
    p.reorder_qty,
    public.product_cost(p.id)::numeric(14,2)  as cost_price,
    p.list_price,
    coalesce(sum(i.qty_on_hand), 0)   as qty_on_hand,
    coalesce(sum(i.qty_reserved), 0)  as qty_reserved,
    coalesce(sum(i.qty_on_hand), 0) - coalesce(sum(i.qty_reserved), 0) as qty_available,
    public.product_cost(p.id) * coalesce(sum(i.qty_on_hand), 0)        as stock_value,
    (coalesce(sum(i.qty_on_hand), 0) - coalesce(sum(i.qty_reserved), 0))
      <= p.reorder_point              as needs_reorder,
    p.org_id,
    p.category_id,
    p.unit_of_measure,
    p.is_active
  from public.products p
  left join public.inventory i on i.product_id = p.id
  group by p.id, p.sku, p.name, p.reorder_point, p.reorder_qty, p.list_price,
           p.org_id, p.category_id, p.unit_of_measure, p.is_active;

create or replace view public.van_stock_summary
with (security_invoker = on) as
  select
    vi.org_id,
    vi.van_id,
    v.code                     as van_code,
    v.registration_no,
    vi.product_id,
    p.sku,
    p.name                     as product_name,
    vi.qty_on_hand,
    public.product_cost(p.id)::numeric(14,2) as cost_price,
    public.product_cost(p.id) * vi.qty_on_hand as stock_value
  from public.van_inventory vi
  join public.vans v on v.id = vi.van_id
  join public.products p on p.id = vi.product_id;

comment on view public.van_stock_summary is
  'What each van is carrying. Quantities to everyone who may see the '
  'van; value only to the roles that may see cost.';

-- ------------------------------------------------------------------
-- Procurement is not a driver's business
-- ------------------------------------------------------------------
-- purchase_orders and purchase_order_items were already role-gated by
-- their own policies. suppliers was not: `suppliers_read` allowed any
-- member of the organization to read who the business buys from and on
-- what terms, which is the same commercial information cost is.
--
-- Policies for one command are OR'd, so adding a stricter one beside
-- the permissive one would have achieved nothing. The permissive one is
-- replaced.
drop policy if exists suppliers_read on public.suppliers;
drop policy if exists suppliers_select on public.suppliers;drop policy if exists suppliers_read on public.suppliers;
create policy suppliers_read on public.suppliers
  for select using (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'accountant', 'warehouse')
  );


comment on policy suppliers_read on public.suppliers is
  'Supplier terms are commercial information, on the same footing as '
  'cost. Sales roles do not read this table.';


-- ====================================================================
-- 0024_batches_and_expiry.sql
-- ====================================================================
-- ===================================================================
-- 0024  Batches and expiry
-- ===================================================================
--
-- The schema had no idea when anything went off. A distributor moving
-- food, drink and toiletries carries stock that expires, and the only
-- record of it was whatever somebody remembered.
--
-- Expiry does not belong to a product. Two deliveries of the same soap
-- expire on different days, so it belongs to the batch that arrived -
-- which is also the only moment anyone knows the date. That is why
-- batches are created at receiving and nowhere else.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--
-- It does not allocate specific batches to individual sales. Quantity
-- is still held by `inventory` and moved by `stock_movements`, exactly
-- as before; batches sit alongside as the expiry record and are drawn
-- down oldest-first when goods leave a warehouse. Rewriting every sale
-- to consume named batches would touch complete_van_sale, the van
-- ledger and reconciliation at once, and the value of that is small
-- next to the risk. What matters commercially - knowing what is about
-- to go off, and not sending expired goods out on a van - is here.
--
-- Not every product expires. Bar soap does; a crate does not. Tracking
-- is per product and off by default, so nothing existing changes
-- behaviour until somebody turns it on.

-- ------------------------------------------------------------------
-- What a product tracks
-- ------------------------------------------------------------------
alter table public.products
  add column if not exists track_batches  boolean not null default false,
  add column if not exists track_expiry   boolean not null default false,
  -- Used to suggest an expiry date at receiving when the delivery note
  -- gives a manufacture date instead. Never used to invent one.
  add column if not exists shelf_life_days integer;

alter table public.products
  drop constraint if exists products_shelf_life_sane;
alter table public.products
  add constraint products_shelf_life_sane
  check (shelf_life_days is null or shelf_life_days between 1 and 3650);

-- Expiry without batches has nowhere to live: the date arrives with a
-- delivery, and a delivery is a batch.
alter table public.products
  drop constraint if exists products_expiry_needs_batches;
alter table public.products
  add constraint products_expiry_needs_batches
  check (not track_expiry or track_batches);

comment on column public.products.track_expiry is
  'Whether this line has a shelf life. Off by default: a crate does not '
  'expire and should not be made to carry a date.';

-- How much notice the business wants. A wholesaler shifting fast lines
-- wants a fortnight; one holding slow stock wants a quarter.
alter table public.organizations
  add column if not exists expiry_warning_days integer not null default 30;

alter table public.organizations
  drop constraint if exists organizations_expiry_warning_sane;
alter table public.organizations
  add constraint organizations_expiry_warning_sane
  check (expiry_warning_days between 1 and 365);

-- ------------------------------------------------------------------
-- The batches themselves
-- ------------------------------------------------------------------
create table if not exists public.product_batches (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  product_id        uuid not null references public.products(id) on delete restrict,
  warehouse_id      uuid not null references public.warehouses(id) on delete restrict,
  batch_number      text not null,
  manufactured_on   date,
  expires_on        date,
  qty_received      integer not null,
  -- Drawn down as goods leave. Never negative: a batch cannot give more
  -- than it held.
  qty_remaining     integer not null,
  supplier_id       uuid references public.suppliers(id) on delete set null,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  received_by       uuid references public.profiles(id) on delete set null,
  received_at       timestamptz not null default now(),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint product_batches_number_not_blank check (length(trim(batch_number)) > 0),
  constraint product_batches_qty_sane check (qty_received > 0),
  constraint product_batches_remaining_sane
    check (qty_remaining >= 0 and qty_remaining <= qty_received),
  -- A date that is already gone on the day it arrives means somebody
  -- typed the year wrong, or the delivery should have been refused.
  constraint product_batches_dates_sane
    check (manufactured_on is null or expires_on is null or expires_on > manufactured_on)
);

comment on table public.product_batches is
  'A delivery of one product, with the expiry it carries. Created at '
  'receiving, which is the only moment the date is known.';

-- One batch number per product per organization. A supplier reusing a
-- number for a different delivery is a mistake worth catching.
create unique index if not exists product_batches_unique
  on public.product_batches (org_id, product_id, batch_number);

create index if not exists product_batches_expiry
  on public.product_batches (org_id, expires_on)
  where qty_remaining > 0;
create index if not exists product_batches_product
  on public.product_batches (product_id, expires_on);
create index if not exists product_batches_warehouse
  on public.product_batches (warehouse_id, expires_on);

alter table public.product_batches enable row level security;

-- Reading a batch is reading stock. Anyone who may see the product may
-- see when it goes off - a driver especially, since they are the one
-- putting it in a customer's hand.
drop policy if exists product_batches_read on public.product_batches;drop policy if exists product_batches_read on public.product_batches;
create policy product_batches_read on public.product_batches
  for select using (
    org_id = public.auth_org_id()
    and public.can_access_product(product_id)
  );


-- Writing one is a warehouse act.
drop policy if exists product_batches_write on public.product_batches;drop policy if exists product_batches_write on public.product_batches;
create policy product_batches_write on public.product_batches
  for all using (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'warehouse')
  ) with check (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'warehouse')
  );


drop trigger if exists product_batches_touch on public.product_batches;drop trigger if exists product_batches_touch on public.product_batches;
create trigger product_batches_touch
  before update on public.product_batches
  for each row execute function public.set_updated_at();


grant select on public.product_batches to authenticated;
grant all on public.product_batches to service_role;

-- ------------------------------------------------------------------
-- Where a batch stands today
-- ------------------------------------------------------------------
create or replace view public.batch_expiry_status
with (security_invoker = on) as
  select
    b.id                  as batch_id,
    b.org_id,
    b.product_id,
    p.sku,
    p.name                as product_name,
    b.warehouse_id,
    w.name                as warehouse_name,
    b.batch_number,
    b.manufactured_on,
    b.expires_on,
    b.qty_received,
    b.qty_remaining,
    b.received_at,
    (b.expires_on - current_date) as days_to_expiry,
    case
      when b.expires_on is null then 'no_expiry'
      when b.expires_on < current_date then 'expired'
      when b.expires_on <= current_date + o.expiry_warning_days then 'expiring'
      else 'good'
    end as status
  from public.product_batches b
  join public.products p on p.id = b.product_id
  join public.warehouses w on w.id = b.warehouse_id
  join public.organizations o on o.id = b.org_id;

comment on view public.batch_expiry_status is
  'Every batch with how long it has left, against the organization''s own '
  'warning period.';

-- ------------------------------------------------------------------
-- Receiving goods, with the batch they came in
-- ------------------------------------------------------------------
--
-- Wraps receive_purchase_line() rather than replacing it: that function
-- owns the stock movement and the order arithmetic, and this adds the
-- expiry record around it. A line for a product that does not track
-- batches is received exactly as before.
create or replace function public.receive_purchase_batch(
  p_item_id       uuid,
  p_quantity      integer,
  p_batch_number  text default null,
  p_expires_on    date default null,
  p_manufactured_on date default null
)
returns public.product_batches
language plpgsql
security definer
set search_path = public
as $$
declare
  item      public.purchase_order_items;
  po        public.purchase_orders;
  prod      public.products;
  batch     public.product_batches;
  v_expires date := p_expires_on;
begin
  perform public.require_role('admin', 'senior_manager', 'manager', 'warehouse');

  select * into item from public.purchase_order_items where id = p_item_id;
  if not found then
    raise exception 'Purchase order line % not found', p_item_id;
  end if;

  select * into po from public.purchase_orders where id = item.po_id;
  select * into prod from public.products where id = item.product_id;

  if prod.track_batches then
    if p_batch_number is null or length(trim(p_batch_number)) = 0 then
      raise exception '% is batch tracked; enter the batch number from the delivery', prod.name;
    end if;

    if prod.track_expiry then
      -- Derived from the manufacture date only when the delivery note
      -- gives one and no expiry. Never invented from thin air.
      if v_expires is null and p_manufactured_on is not null and prod.shelf_life_days is not null then
        v_expires := p_manufactured_on + prod.shelf_life_days;
      end if;

      if v_expires is null then
        raise exception '% carries an expiry date; enter the one on the delivery', prod.name;
      end if;

      if v_expires <= current_date then
        raise exception 'That delivery of % expires on % and is already out of date. Refuse it rather than booking it in.',
          prod.name, v_expires;
      end if;
    end if;
  end if;

  -- The existing function does the stock and the order. Untouched.
  perform public.receive_purchase_line(p_item_id, p_quantity);

  if not prod.track_batches then
    return null;
  end if;

  insert into public.product_batches (
    org_id, product_id, warehouse_id, batch_number,
    manufactured_on, expires_on, qty_received, qty_remaining,
    supplier_id, purchase_order_id, received_by
  ) values (
    po.org_id, item.product_id, po.warehouse_id, trim(p_batch_number),
    p_manufactured_on, v_expires, p_quantity, p_quantity,
    po.supplier_id, po.id, auth.uid()
  )
  -- The same batch delivered again adds to it rather than colliding.
  on conflict (org_id, product_id, batch_number) do update
    set qty_received  = public.product_batches.qty_received + excluded.qty_received,
        qty_remaining = public.product_batches.qty_remaining + excluded.qty_received,
        updated_at    = now()
  returning * into batch;

  return batch;
end;
$$;

comment on function public.receive_purchase_batch is
  'Receive a purchase order line together with the batch and expiry it '
  'arrived with. Refuses a delivery that is already out of date.';

revoke all on function public.receive_purchase_batch(uuid, integer, text, date, date) from public, anon;
grant execute on function public.receive_purchase_batch(uuid, integer, text, date, date)
  to authenticated, service_role;

-- ------------------------------------------------------------------
-- Drawing batches down, oldest expiry first
-- ------------------------------------------------------------------
create or replace function public.consume_batches(
  p_product uuid,
  p_warehouse uuid,
  p_quantity integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining integer := p_quantity;
  batch     record;
  take      integer;
begin
  -- First expire, first out. A batch with no date goes last: something
  -- that never expires should not be used ahead of something that will.
  for batch in
    select id, qty_remaining
      from public.product_batches
     where product_id = p_product
       and warehouse_id = p_warehouse
       and qty_remaining > 0
     order by expires_on asc nulls last, received_at asc
     for update
  loop
    exit when remaining <= 0;
    take := least(batch.qty_remaining, remaining);
    update public.product_batches
       set qty_remaining = qty_remaining - take, updated_at = now()
     where id = batch.id;
    remaining := remaining - take;
  end loop;

  -- A shortfall is not raised. Batches are a record of what arrived,
  -- not the authority on how much there is - `inventory` is, and it has
  -- already been checked by whatever is calling. Refusing here would
  -- block a legitimate issue of stock that predates batch tracking.
end;
$$;

comment on function public.consume_batches is
  'Draw a quantity down across batches, earliest expiry first. Silent on '
  'a shortfall: inventory is the authority on quantity, not this.';

revoke all on function public.consume_batches(uuid, uuid, integer) from public, anon;
grant execute on function public.consume_batches(uuid, uuid, integer) to service_role;

-- ------------------------------------------------------------------
-- Expired goods do not go out on a van
-- ------------------------------------------------------------------
--
-- The one place a hard stop belongs. Everything before this is
-- warehouse housekeeping; this is the moment stock leaves for a
-- customer, and a driver has no way to know a case is out of date.
--
-- Replaces dispatch_van_load with the same body plus the check and the
-- batch draw-down.
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
  expired_line record;
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

  -- Nothing out of date leaves the yard. Checked before any movement is
  -- written, so a refused load moves no stock at all.
  select p.name, b.batch_number, b.expires_on
    into expired_line
    from public.van_load_items i
    join public.products p on p.id = i.product_id
    join public.product_batches b
      on b.product_id = i.product_id
     and b.warehouse_id = load.warehouse_id
     and b.qty_remaining > 0
   where i.load_id = p_load_id
     and p.track_expiry
     and b.expires_on is not null
     and b.expires_on < current_date
   order by b.expires_on
   limit 1;

  if found then
    raise exception
      'Cannot dispatch %: batch % of % expired on %. Remove it from the warehouse before loading.',
      load.load_number, expired_line.batch_number, expired_line.name, expired_line.expires_on;
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

    -- The batches that left, earliest expiry first.
    perform public.consume_batches(item.product_id, load.warehouse_id, item.qty_loaded);
  end loop;

  update public.van_loads
  set status = 'dispatched', dispatched_at = now(), updated_at = now()
  where id = p_load_id
  returning * into load;

  return load;
end;
$$;

-- ------------------------------------------------------------------
-- What the office needs to see at a glance
-- ------------------------------------------------------------------
create or replace view public.expiry_summary
with (security_invoker = on) as
  select
    org_id,
    count(*) filter (where status = 'expired')                        as expired_batches,
    coalesce(sum(qty_remaining) filter (where status = 'expired'), 0) as expired_units,
    count(*) filter (where status = 'expiring')                       as expiring_batches,
    coalesce(sum(qty_remaining) filter (where status = 'expiring'), 0) as expiring_units,
    count(*) filter (where status = 'good')                           as good_batches
  from public.batch_expiry_status
  where qty_remaining > 0
  group by org_id;

comment on view public.expiry_summary is
  'Counts for the dashboard: what has gone off, and what is about to.';


-- ====================================================================
-- 0025_sale_payment_methods.sql
-- ====================================================================
-- ===================================================================
-- 0025  How a sale was paid for
-- ===================================================================
--
-- A van sale recorded how much was paid and never how. `amount_paid`
-- was a single number, so ₵500 taken half in cash and half on mobile
-- money was indistinguishable from ₵500 in notes.
--
-- In Ghana that is not a detail. Mobile money is most of the takings on
-- many rounds, and a driver hands over cash while the momo has already
-- gone to a float. Reconciling them together means a driver is short
-- every evening by exactly the amount they were paid electronically -
-- which is why end of day could only ever check cash.
--
-- So payment becomes a breakdown rather than a figure. One sale, one or
-- more payments, each with its own method and reference.

-- ------------------------------------------------------------------
-- The breakdown
-- ------------------------------------------------------------------
create table if not exists public.van_sale_payments (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  sale_id    uuid not null references public.van_sales(id) on delete cascade,
  method     public.payment_method not null,
  amount     numeric(14,2) not null,
  -- A momo transaction id, a cheque number. What a disputed payment is
  -- matched against later.
  reference  text,
  created_at timestamptz not null default now(),

  constraint van_sale_payments_amount_positive check (amount > 0)
);

comment on table public.van_sale_payments is
  'What a sale was actually paid with. One row per method, so a split '
  'between cash and mobile money is two rows rather than a lost detail.';

create index if not exists van_sale_payments_sale on public.van_sale_payments (sale_id);
create index if not exists van_sale_payments_method
  on public.van_sale_payments (org_id, method, created_at desc);

alter table public.van_sale_payments enable row level security;

-- Whoever may see the sale may see how it was paid for.
drop policy if exists van_sale_payments_read on public.van_sale_payments;drop policy if exists van_sale_payments_read on public.van_sale_payments;
create policy van_sale_payments_read on public.van_sale_payments
  for select using (
    org_id = public.auth_org_id()
    and exists (
      select 1 from public.van_sales s
       where s.id = van_sale_payments.sale_id
    )
  );


-- Written only by record_sale_payments(), which checks the arithmetic.
-- A driver who could insert here directly could claim a sale was paid.
revoke all on public.van_sale_payments from anon, authenticated;
grant select on public.van_sale_payments to authenticated;
grant all on public.van_sale_payments to service_role;

-- ------------------------------------------------------------------
-- Recording payment against a sale
-- ------------------------------------------------------------------
--
-- Takes the whole breakdown at once rather than a row at a time: the
-- rules worth enforcing are about the total, and checking them per row
-- would let a second insert push a sale past its own value.
create or replace function public.record_sale_payments(
  p_sale_id  uuid,
  p_payments jsonb
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  sale    public.van_sales;
  entry   jsonb;
  amount  numeric(14,2);
  method  public.payment_method;
  total   numeric(14,2) := 0;
begin
  perform public.require_role(
    'admin', 'senior_manager', 'manager', 'accountant', 'sales_rep', 'driver');

  select * into sale from public.van_sales where id = p_sale_id for update;
  if not found then
    raise exception 'Sale % not found', p_sale_id;
  end if;

  if sale.status = 'completed' then
    raise exception 'Sale % is already completed', sale.sale_number;
  end if;

  if jsonb_typeof(p_payments) <> 'array' then
    raise exception 'Payments must be a list';
  end if;

  -- Cleared first so a retry replaces the breakdown rather than adding
  -- to it. The sale is still a draft at this point, so nothing has been
  -- reported on it.
  delete from public.van_sale_payments where sale_id = p_sale_id;

  for entry in select * from jsonb_array_elements(p_payments) loop
    amount := (entry ->> 'amount')::numeric;
    method := (entry ->> 'method')::public.payment_method;

    if amount is null or amount <= 0 then
      raise exception 'Every payment needs an amount above zero';
    end if;

    insert into public.van_sale_payments (org_id, sale_id, method, amount, reference)
    values (sale.org_id, p_sale_id, method, amount, nullif(entry ->> 'reference', ''));

    total := total + amount;
  end loop;

  -- Nobody hands over more than the sale is worth. A customer paying
  -- extra is a payment on account, not part of this sale, and merging
  -- the two would misstate both.
  if total > sale.total then
    raise exception 'Payment of % is more than the sale total of %', total, sale.total;
  end if;

  -- A cash sale is one that was paid for. Short payment is what credit
  -- is for, and calling it cash would leave a balance nobody is
  -- chasing.
  if sale.sale_type = 'cash' and total < sale.total then
    raise exception
      'This is a cash sale of % but only % was paid. Take the balance, or record it as a credit sale.',
      sale.total, total;
  end if;

  return total;
end;
$$;

comment on function public.record_sale_payments is
  'Record how a sale was paid, as a breakdown by method. Refuses more '
  'than the sale is worth, and refuses a cash sale that is short.';

revoke all on function public.record_sale_payments(uuid, jsonb) from public, anon;
grant execute on function public.record_sale_payments(uuid, jsonb) to authenticated, service_role;

-- ------------------------------------------------------------------
-- What a round took, by method
-- ------------------------------------------------------------------
create or replace view public.load_takings
with (security_invoker = on) as
  select
    s.org_id,
    s.load_id,
    coalesce(sum(p.amount) filter (where p.method = 'cash'), 0)          as cash_taken,
    coalesce(sum(p.amount) filter (where p.method = 'mobile_money'), 0)  as momo_taken,
    coalesce(sum(p.amount) filter (where p.method not in ('cash', 'mobile_money')), 0)
                                                                        as other_taken,
    coalesce(sum(p.amount), 0)                                          as total_taken
  from public.van_sales s
  left join public.van_sale_payments p on p.sale_id = s.id
  where s.status = 'completed'
  group by s.org_id, s.load_id;

comment on view public.load_takings is
  'What a round actually took, split by method. Cash is what the driver '
  'hands over; mobile money has already gone to the float.';

-- ------------------------------------------------------------------
-- End of day counts them apart
-- ------------------------------------------------------------------
alter table public.van_reconciliations
  add column if not exists momo_sales_total numeric(14,2) not null default 0,
  add column if not exists expected_momo    numeric(14,2) not null default 0,
  add column if not exists actual_momo      numeric(14,2) not null default 0;

-- `add column if not exists` cannot carry a GENERATED clause, and
-- dropping the column first fails the second time round because the
-- variance view has come to depend on it. Guarded instead.
do $momo$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'van_reconciliations'
       and column_name = 'momo_variance'
  ) then
    alter table public.van_reconciliations
      add column momo_variance numeric(14,2)
      generated always as (actual_momo - expected_momo) stored;
  end if;
end
$momo$;

comment on column public.van_reconciliations.expected_momo is
  'What the round took on mobile money. Not handed over in cash, so it '
  'is reconciled against the float rather than against the tin.';

-- Rebuilt so expected cash is cash, not cash plus everything else.
create or replace function public.build_reconciliation(p_load_id uuid)
returns public.van_reconciliations
language plpgsql
security definer
set search_path = public
as $$
declare
  load public.van_loads;
  rec  public.van_reconciliations;
  cash_sales numeric(14,2);
  credit numeric(14,2);
  collected numeric(14,2);
  cash_taken numeric(14,2);
  momo_taken numeric(14,2);
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
  into cash_sales, credit, collected
  from public.van_sales
  where load_id = p_load_id and status = 'completed';

  -- What was actually taken, by method. A sale recorded before this
  -- migration has no breakdown, so it falls back to being treated as
  -- cash - which is what it was assumed to be at the time.
  select
    coalesce(t.cash_taken, 0),
    coalesce(t.momo_taken, 0)
  into cash_taken, momo_taken
  from public.load_takings t
  where t.load_id = p_load_id;

  if cash_taken = 0 and momo_taken = 0 then
    cash_taken := cash_sales + collected;
  end if;

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

  remaining := loaded_value - sold_value;

  insert into public.van_reconciliations (
    org_id, load_id, van_id, driver_id,
    opening_float, cash_sales_total, momo_sales_total, credit_sales_total,
    collections_total, expected_cash, expected_momo,
    expected_stock_value, actual_stock_value,
    damaged_value, missing_value, submitted_by
  )
  values (
    load.org_id, load.id, load.van_id, load.driver_id,
    load.opening_float, cash_sales, momo_taken, credit,
    collected,
    -- The float goes out with the driver and comes back with them.
    -- Mobile money never touches the tin, so it is not expected here.
    load.opening_float + cash_taken,
    momo_taken,
    remaining, remaining - damaged - missing,
    damaged, missing, auth.uid()
  )
  on conflict (load_id) do update
  set cash_sales_total   = excluded.cash_sales_total,
      momo_sales_total   = excluded.momo_sales_total,
      credit_sales_total = excluded.credit_sales_total,
      collections_total  = excluded.collections_total,
      expected_cash      = excluded.expected_cash,
      expected_momo      = excluded.expected_momo,
      expected_stock_value = excluded.expected_stock_value,
      actual_stock_value   = excluded.actual_stock_value,
      damaged_value        = excluded.damaged_value,
      missing_value        = excluded.missing_value,
      updated_at           = now()
  returning * into rec;

  return rec;
end;
$$;

-- The variance view gains the same split.
--
-- Appended rather than inserted: `create or replace view` refuses to
-- rename or reorder a column, and dropping this one would take whatever
-- is built on it.
create or replace view public.reconciliation_variances
with (security_invoker = on) as
  select
    r.org_id,
    r.id,
    r.recon_number,
    r.status,
    v.code                as van_code,
    p.full_name           as driver_name,
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
    r.submitted_at,
    r.expected_momo,
    r.actual_momo,
    r.momo_variance
  from public.van_reconciliations r
  join public.vans v on v.id = r.van_id
  left join public.profiles p on p.id = r.driver_id;


-- ====================================================================
-- 0026_invoices_receipts_waybills.sql
-- ====================================================================
-- ===================================================================
-- 0026  Invoices, receipts and waybills
-- ===================================================================
--
-- `invoices` and `payments` have been in this schema since 0001 and
-- nothing has ever written to them. Meanwhile a credit sale writes a
-- charge to `credit_transactions`, and a collection writes a payment
-- there too.
--
-- So the business has two ideas of what it is owed, and the older one -
-- the one with invoice numbers, due dates and ageing - is empty. The
-- Credit screen reads `invoice_ageing`, which is built on invoices, and
-- has therefore always shown nothing however much was outstanding.
--
-- This consolidates them rather than adding a third. `credit_transactions`
-- stays as the customer's running ledger, because that is what the
-- credit limit is checked against and it works. On top of it:
--
--   a credit sale now raises an invoice, automatically, by trigger. Not
--   from the application, because an invoice that depends on somebody
--   remembering to create one is how a business loses track of what it
--   is owed.
--
--   a collection now settles invoices oldest first and records a
--   payment against each, which is what a receipt is printed from.
--
-- Waybills are new: goods moving without a document is the one part of
-- this that had nothing at all.

-- ------------------------------------------------------------------
-- An invoice knows which sale it came from
-- ------------------------------------------------------------------
alter table public.invoices
  add column if not exists van_sale_id uuid references public.van_sales(id) on delete restrict;

create unique index if not exists invoices_one_per_sale
  on public.invoices (van_sale_id) where van_sale_id is not null;

comment on column public.invoices.van_sale_id is
  'The van sale this invoice was raised for. One invoice per sale, '
  'enforced by index rather than by whoever calls the function.';

-- ------------------------------------------------------------------
-- Raising an invoice for a credit sale
-- ------------------------------------------------------------------
create or replace function public.issue_invoice_for_sale(p_sale_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  sale    public.van_sales;
  cust    public.customers;
  inv     public.invoices;
  inv_id  uuid;
  terms   integer;
begin
  perform public.require_role(
    'admin', 'senior_manager', 'manager', 'accountant', 'sales_rep', 'driver');

  select * into sale from public.van_sales where id = p_sale_id;
  if not found then
    raise exception 'Sale % not found', p_sale_id;
  end if;

  -- Security definer runs past row level security, so the tenant check
  -- the policies would have made has to be made here instead. Reported
  -- as 'not found': whether another organization's sale exists is not
  -- this caller's business either.
  if auth.uid() is not null and sale.org_id is distinct from public.auth_org_id() then
    raise exception 'Sale % not found', p_sale_id using errcode = '42501';
  end if;

  -- Cash sales are settled at the counter and are evidenced by a
  -- receipt. An invoice for one would be a document nobody owes
  -- anything against.
  if sale.sale_type <> 'credit' then
    return null;
  end if;

  select * into inv from public.invoices where van_sale_id = p_sale_id;
  if found then
    return inv;
  end if;

  select * into cust from public.customers where id = sale.customer_id;
  terms := coalesce(cust.payment_terms_days, 0);

  -- Raised for the whole value of the sale, with nothing paid against
  -- it yet, even when the customer put money down at the door.
  --
  -- The deposit is written below as a payment instead. It has to be:
  -- `amount_paid` on an invoice is recalculated from the payments table
  -- every time one lands, so a figure written straight into the column
  -- survives only until the first collection and then silently
  -- disappears - taking the customer's deposit with it.
  insert into public.invoices (
    org_id, van_sale_id, customer_id, status,
    issue_date, due_date,
    subtotal, tax_total, total, created_by
  ) values (
    sale.org_id, sale.id, sale.customer_id, 'issued',
    sale.sold_at::date,
    coalesce(sale.due_date, sale.sold_at::date + terms),
    sale.subtotal, sale.tax_total, sale.total,
    sale.driver_id
  )
  returning * into inv;
  inv_id := inv.id;

  if sale.amount_paid > 0 then
    -- What they put down at the door, by the method they used, so the
    -- receipt says 'mobile money' when that is what it was.
    insert into public.payments (org_id, invoice_id, amount, method, reference, received_by, paid_at)
    select sale.org_id, inv_id, sp.amount, sp.method, sp.reference, sale.driver_id, sale.sold_at
      from public.van_sale_payments sp
     where sp.sale_id = sale.id;

    if not found then
      -- A sale recorded before payment methods existed, or one taken
      -- offline without a breakdown. It was cash at the time.
      insert into public.payments (org_id, invoice_id, amount, method, received_by, paid_at)
      values (sale.org_id, inv_id, sale.amount_paid, 'cash', sale.driver_id, sale.sold_at);
    end if;

    -- Re-read: the payments above have moved amount_paid, balance and
    -- status underneath us.
    select * into inv from public.invoices where id = inv_id;
  end if;

  return inv;
end;
$$;

comment on function public.issue_invoice_for_sale is
  'Raise the invoice for a credit sale. Returns the existing one if '
  'there already is one, so it is safe to call twice.';

revoke all on function public.issue_invoice_for_sale(uuid) from public, anon;
grant execute on function public.issue_invoice_for_sale(uuid) to authenticated, service_role;

-- Completing a credit sale raises its invoice. By trigger, so it cannot
-- be forgotten by a caller and cannot be skipped by the offline path.
create or replace function public.invoice_on_sale_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed'
     and (old.status is distinct from 'completed')
     and new.sale_type = 'credit' then
    perform public.issue_invoice_for_sale(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists van_sales_raise_invoice on public.van_sales;drop trigger if exists van_sales_raise_invoice on public.van_sales;
create trigger van_sales_raise_invoice
  after update on public.van_sales
  for each row execute function public.invoice_on_sale_completed();


-- ------------------------------------------------------------------
-- A collection settles invoices, oldest first
-- ------------------------------------------------------------------
--
-- Replaces record_credit_payment. The ledger entry it always wrote is
-- unchanged - the credit limit is still checked against that - and the
-- money is now also allocated across open invoices so ageing means
-- something and a receipt can be printed.
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
  txn       public.credit_transactions;
  org       uuid;
  remaining numeric(14,2) := p_amount;
  inv       record;
  take      numeric(14,2);
begin
  perform public.require_role('admin', 'senior_manager', 'manager', 'accountant', 'driver');

  if p_amount <= 0 then
    raise exception 'Payment amount must be positive';
  end if;

  select org_id into org from public.customers where id = p_customer_id;
  if org is null then
    raise exception 'Customer % not found', p_customer_id;
  end if;

  if auth.uid() is not null and org is distinct from public.auth_org_id() then
    raise exception 'Customer % not found', p_customer_id using errcode = '42501';
  end if;

  insert into public.credit_transactions
    (org_id, customer_id, type, amount, reference_type, created_by, notes)
  values
    (org, p_customer_id, 'payment', -p_amount, p_method::text, auth.uid(),
     coalesce(p_notes, 'Payment received'))
  returning * into txn;

  -- Oldest due first. A customer paying something off is paying down
  -- what has been owed longest, which is also what the ageing report
  -- assumes.
  for inv in
    select id, balance
      from public.invoices
     where customer_id = p_customer_id
       and status not in ('paid', 'void')
       and balance > 0
     order by due_date asc, issue_date asc
     for update
  loop
    exit when remaining <= 0;
    take := least(inv.balance, remaining);

    insert into public.payments (org_id, invoice_id, amount, method, reference, received_by)
    values (org, inv.id, take, p_method, p_notes, auth.uid());

    remaining := remaining - take;
  end loop;

  -- Anything left over is money on account: it is on the ledger, and
  -- will settle the next invoice raised. It is deliberately not forced
  -- onto an invoice that does not exist yet.
  return txn;
end;
$$;do $enum$
declare
  found text[];
  wanted text[] := array['draft', 'issued', 'delivered', 'cancelled'];
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'waybill_status'
  ) then
    create type public.waybill_status as enum ('draft', 'issued', 'delivered', 'cancelled');
  else
    select array_agg(e.enumlabel order by e.enumsortorder) into found
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'waybill_status';

    -- Already correct: nothing to do, and the script carries on.
    if found is distinct from wanted then
      raise exception
        'public.waybill_status already exists with different values. Found %, expected %. '
        'Reconcile it before running this script; this script will not alter an '
        'enum other code may already depend on.',
        found, wanted;
    end if;
  end if;
end $enum$;


create sequence if not exists public.waybill_seq;

create table if not exists public.waybills (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  waybill_number  text not null default public.next_document_number('WB', 'public.waybill_seq'),
  status          public.waybill_status not null default 'draft',
  -- Where the goods came from, and where they went. A waybill for a van
  -- round names the van; one for a delivery names the customer.
  from_warehouse_id uuid references public.warehouses(id) on delete restrict,
  van_id            uuid references public.vans(id) on delete restrict,
  customer_id       uuid references public.customers(id) on delete restrict,
  destination       text,
  driver_id         uuid references public.profiles(id) on delete set null,
  -- What it evidences: a van load, a sale, a transfer.
  reference_type  text,
  reference_id    uuid,
  issued_on       date not null default current_date,
  delivered_at    timestamptz,
  received_by     text,
  notes           text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint waybills_has_a_destination
    check (van_id is not null or customer_id is not null or destination is not null)
);

comment on table public.waybills is
  'The document that travels with the goods. Evidence of what left, '
  'where it went and who signed for it.';

create unique index if not exists waybills_number_unique on public.waybills (org_id, waybill_number);
create index if not exists waybills_reference on public.waybills (reference_type, reference_id);
create index if not exists waybills_org_date on public.waybills (org_id, issued_on desc);

create table if not exists public.waybill_items (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  waybill_id  uuid not null references public.waybills(id) on delete cascade,
  product_id  uuid not null references public.products(id) on delete restrict,
  quantity    integer not null,
  notes       text,
  created_at  timestamptz not null default now(),

  constraint waybill_items_quantity_positive check (quantity > 0)
);

create index if not exists waybill_items_waybill on public.waybill_items (waybill_id);

alter table public.waybills enable row level security;
alter table public.waybill_items enable row level security;

-- A driver sees the waybills for their own rounds; the office sees all
-- of them.
drop policy if exists waybills_read on public.waybills;drop policy if exists waybills_read on public.waybills;
create policy waybills_read on public.waybills
  for select using (
    org_id = public.auth_org_id()
    and (
      public.has_role('admin', 'senior_manager', 'manager', 'accountant', 'warehouse')
      or driver_id = auth.uid()
      or van_id = public.my_van_id()
    )
  );


drop policy if exists waybills_write on public.waybills;drop policy if exists waybills_write on public.waybills;
create policy waybills_write on public.waybills
  for all using (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'warehouse')
  ) with check (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'warehouse')
  );


drop policy if exists waybill_items_read on public.waybill_items;drop policy if exists waybill_items_read on public.waybill_items;
create policy waybill_items_read on public.waybill_items
  for select using (
    org_id = public.auth_org_id()
    and exists (select 1 from public.waybills w where w.id = waybill_items.waybill_id)
  );


drop policy if exists waybill_items_write on public.waybill_items;drop policy if exists waybill_items_write on public.waybill_items;
create policy waybill_items_write on public.waybill_items
  for all using (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'warehouse')
  ) with check (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'warehouse')
  );


drop trigger if exists waybills_touch on public.waybills;drop trigger if exists waybills_touch on public.waybills;
create trigger waybills_touch
  before update on public.waybills
  for each row execute function public.set_updated_at();


grant select on public.waybills to authenticated;
grant select on public.waybill_items to authenticated;
grant all on public.waybills to service_role;
grant all on public.waybill_items to service_role;

-- ------------------------------------------------------------------
-- A waybill for a dispatched load
-- ------------------------------------------------------------------
create or replace function public.issue_waybill_for_load(p_load_id uuid)
returns public.waybills
language plpgsql
security definer
set search_path = public
as $$
declare
  load public.van_loads;
  wb   public.waybills;
begin
  perform public.require_role('admin', 'senior_manager', 'manager', 'warehouse');

  select * into load from public.van_loads where id = p_load_id;
  if not found then
    raise exception 'Van load % not found', p_load_id;
  end if;

  -- Security definer runs past row level security, so the tenant check
  -- the policies would have made has to be made here instead. Reported
  -- as 'not found': whether another organization's sale exists is not
  -- this caller's business either.
  if auth.uid() is not null and load.org_id is distinct from public.auth_org_id() then
    raise exception 'Van load % not found', p_load_id using errcode = '42501';
  end if;

  select * into wb from public.waybills
   where reference_type = 'van_load' and reference_id = p_load_id;
  if found then
    return wb;
  end if;

  insert into public.waybills (
    org_id, status, from_warehouse_id, van_id, driver_id,
    reference_type, reference_id, issued_on, created_by
  ) values (
    load.org_id, 'issued', load.warehouse_id, load.van_id, load.driver_id,
    'van_load', load.id, load.load_date, auth.uid()
  )
  returning * into wb;

  insert into public.waybill_items (org_id, waybill_id, product_id, quantity)
  select load.org_id, wb.id, i.product_id, i.qty_loaded
    from public.van_load_items i
   where i.load_id = p_load_id;

  return wb;
end;
$$;

comment on function public.issue_waybill_for_load is
  'The document that goes out with a van load. Safe to call twice; it '
  'returns the waybill already issued.';

revoke all on function public.issue_waybill_for_load(uuid) from public, anon;
grant execute on function public.issue_waybill_for_load(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- What the office reads
-- ------------------------------------------------------------------
create or replace view public.invoice_detail
with (security_invoker = on) as
  select
    i.id,
    i.org_id,
    i.invoice_number,
    i.status,
    i.issue_date,
    i.due_date,
    i.subtotal,
    i.tax_total,
    i.total,
    i.amount_paid,
    i.balance,
    c.id           as customer_id,
    c.code         as customer_code,
    c.name         as customer_name,
    c.phone        as customer_phone,
    c.billing_address as customer_address,
    s.sale_number,
    s.sold_at,
    p.full_name    as sold_by,
    (i.due_date < current_date and i.balance > 0) as is_overdue
  from public.invoices i
  join public.customers c on c.id = i.customer_id
  left join public.van_sales s on s.id = i.van_sale_id
  left join public.profiles p on p.id = i.created_by;

comment on view public.invoice_detail is
  'An invoice with everything a printed copy needs. No cost anywhere - '
  'a customer document shows what they were charged.';

create or replace view public.receipt_detail
with (security_invoker = on) as
  select
    pay.id,
    pay.org_id,
    pay.payment_number,
    pay.amount,
    pay.method,
    pay.reference,
    pay.paid_at,
    i.invoice_number,
    i.total          as invoice_total,
    i.balance        as invoice_balance,
    c.id             as customer_id,
    c.code           as customer_code,
    c.name           as customer_name,
    c.phone          as customer_phone,
    r.full_name      as received_by
  from public.payments pay
  join public.invoices i on i.id = pay.invoice_id
  join public.customers c on c.id = i.customer_id
  left join public.profiles r on r.id = pay.received_by;

comment on view public.receipt_detail is
  'A payment with what a receipt needs printed on it.';


-- ====================================================================
-- 0027_warehouse_transfers.sql
-- ====================================================================
-- ===================================================================
-- 0027  Moving stock between warehouses
-- ===================================================================
--
-- `stock_transfers` and `stock_transfer_items` have been in the schema
-- since 0011 and nothing has ever used them. Stock moved between depots
-- by writing an adjustment out of one and an adjustment in to the other.
--
-- That works arithmetically and is wrong in every other way. An
-- adjustment is what you write when stock is found or lost; using it for
-- a transfer means the goods vanish from one warehouse and appear at the
-- other with no document connecting the two, nothing in transit, nobody
-- accountable for the gap, and a stock report that shows two unexplained
-- corrections instead of one movement.
--
-- A transfer here is a lifecycle:
--
--   draft       being written up
--   approved    a manager has agreed the goods should move
--   in_transit  they have left the source warehouse
--   received    they arrived, and how many arrived is recorded
--
-- Approving and dispatching are deliberately separate people's jobs:
-- the warehouse raises and ships, a manager agrees. And what arrives is
-- counted rather than assumed, because the gap between what left and
-- what arrived is the thing this document exists to make visible.

-- ------------------------------------------------------------------
-- The lifecycle
-- ------------------------------------------------------------------
alter table public.stock_transfers
  drop constraint if exists stock_transfers_status_check;

alter table public.stock_transfers
  add constraint stock_transfers_status_check
  check (status in ('draft', 'approved', 'in_transit', 'received', 'cancelled'));

alter table public.stock_transfers
  add column if not exists approved_by   uuid references public.profiles(id) on delete set null,
  add column if not exists approved_at   timestamptz,
  add column if not exists dispatched_by uuid references public.profiles(id) on delete set null,
  add column if not exists dispatched_at timestamptz,
  add column if not exists received_by   uuid references public.profiles(id) on delete set null,
  add column if not exists received_at   timestamptz,
  add column if not exists cancelled_reason text;

comment on column public.stock_transfers.approved_at is
  'When a manager agreed the goods should move. Dispatch is refused '
  'until this is set, which is what stops a warehouse moving stock '
  'between depots on its own say-so.';

-- What arrived, which is not always what left.
alter table public.stock_transfer_items
  add column if not exists qty_received integer,
  add column if not exists notes text;

comment on column public.stock_transfer_items.qty_received is
  'Counted at the destination. Null until the transfer is received. '
  'Less than quantity means it did not all arrive, and the difference '
  'stays visible on the document rather than being quietly absorbed.';

-- What went, batch by batch, so expiry dates survive the journey.
alter table public.stock_transfer_items
  add column if not exists batches_sent jsonb;

create index if not exists stock_transfers_status_idx
  on public.stock_transfers (org_id, status, transfer_date desc);

-- ------------------------------------------------------------------
-- A batch can be in two places
-- ------------------------------------------------------------------
--
-- The uniqueness rule from 0024 was (org, product, batch_number): one
-- batch number per product per business. That reads as sensible until a
-- delivery of 500 is split 300 to Accra and 200 to Kumasi, at which
-- point the same batch genuinely is in two warehouses and the schema
-- cannot say so.
--
-- Widened to include the warehouse. This only ever permits more than
-- before, so nothing that was valid becomes invalid.
drop index if exists public.product_batches_unique;
create unique index if not exists product_batches_unique
  on public.product_batches (org_id, product_id, warehouse_id, batch_number);


-- ------------------------------------------------------------------
-- Receiving a purchase, now that a batch number is per warehouse
-- ------------------------------------------------------------------
--
-- receive_purchase_batch() upserts on (org, product, batch_number).
-- Widening the index above leaves that conflict target naming nothing,
-- and the next delivery of a batch-tracked line would fail outright.
--
-- Reproduced here with the conflict target corrected and nothing else
-- changed.

create or replace function public.receive_purchase_batch(
  p_item_id       uuid,
  p_quantity      integer,
  p_batch_number  text default null,
  p_expires_on    date default null,
  p_manufactured_on date default null
)
returns public.product_batches
language plpgsql
security definer
set search_path = public
as $$
declare
  item      public.purchase_order_items;
  po        public.purchase_orders;
  prod      public.products;
  batch     public.product_batches;
  v_expires date := p_expires_on;
begin
  perform public.require_role('admin', 'senior_manager', 'manager', 'warehouse');

  select * into item from public.purchase_order_items where id = p_item_id;
  if not found then
    raise exception 'Purchase order line % not found', p_item_id;
  end if;

  select * into po from public.purchase_orders where id = item.po_id;
  select * into prod from public.products where id = item.product_id;

  if prod.track_batches then
    if p_batch_number is null or length(trim(p_batch_number)) = 0 then
      raise exception '% is batch tracked; enter the batch number from the delivery', prod.name;
    end if;

    if prod.track_expiry then
      -- Derived from the manufacture date only when the delivery note
      -- gives one and no expiry. Never invented from thin air.
      if v_expires is null and p_manufactured_on is not null and prod.shelf_life_days is not null then
        v_expires := p_manufactured_on + prod.shelf_life_days;
      end if;

      if v_expires is null then
        raise exception '% carries an expiry date; enter the one on the delivery', prod.name;
      end if;

      if v_expires <= current_date then
        raise exception 'That delivery of % expires on % and is already out of date. Refuse it rather than booking it in.',
          prod.name, v_expires;
      end if;
    end if;
  end if;

  -- The existing function does the stock and the order. Untouched.
  perform public.receive_purchase_line(p_item_id, p_quantity);

  if not prod.track_batches then
    return null;
  end if;

  insert into public.product_batches (
    org_id, product_id, warehouse_id, batch_number,
    manufactured_on, expires_on, qty_received, qty_remaining,
    supplier_id, purchase_order_id, received_by
  ) values (
    po.org_id, item.product_id, po.warehouse_id, trim(p_batch_number),
    p_manufactured_on, v_expires, p_quantity, p_quantity,
    po.supplier_id, po.id, auth.uid()
  )
  -- The same batch delivered again adds to it rather than colliding.
  -- Matched per warehouse since 0027: the same batch number can now be
  -- at two depots, and conflicting on (org, product, number) no longer
  -- names an index that exists.
  on conflict (org_id, product_id, warehouse_id, batch_number) do update
    set qty_received  = public.product_batches.qty_received + excluded.qty_received,
        qty_remaining = public.product_batches.qty_remaining + excluded.qty_received,
        updated_at    = now()
  returning * into batch;

  return batch;
end;
$$;

comment on function public.receive_purchase_batch is
  'Receive a purchase order line together with the batch and expiry it '
  'arrived with. Refuses a delivery that is already out of date.';

revoke all on function public.receive_purchase_batch(uuid, integer, text, date, date) from public, anon;
grant execute on function public.receive_purchase_batch(uuid, integer, text, date, date)
  to authenticated, service_role;
-- ------------------------------------------------------------------
-- Taking stock out of batches, and saying which ones
-- ------------------------------------------------------------------
--
-- consume_batches() already draws down first-expire-first-out, but
-- discards what it took. A transfer has to know: the goods arrive at the
-- other end still carrying their expiry dates, and re-deriving them
-- there would be a guess.
create or replace function public.take_batches(
  p_product   uuid,
  p_warehouse uuid,
  p_quantity  integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining integer := p_quantity;
  batch     record;
  take      integer;
  taken     jsonb := '[]'::jsonb;
begin
  for batch in
    select id, batch_number, expires_on, manufactured_on, qty_remaining
      from public.product_batches
     where product_id = p_product
       and warehouse_id = p_warehouse
       and qty_remaining > 0
     order by expires_on asc nulls last, received_at asc
     for update
  loop
    exit when remaining <= 0;
    take := least(batch.qty_remaining, remaining);

    update public.product_batches
       set qty_remaining = qty_remaining - take, updated_at = now()
     where id = batch.id;

    taken := taken || jsonb_build_object(
      'batch_number',    batch.batch_number,
      'expires_on',      batch.expires_on,
      'manufactured_on', batch.manufactured_on,
      'quantity',        take
    );
    remaining := remaining - take;
  end loop;

  -- A product that is not batch tracked leaves nothing behind, and that
  -- is not an error: the quantity still moves through stock_movements.
  return taken;
end;
$$;

comment on function public.take_batches is
  'Draw stock out of batches first-expire-first-out and report which '
  'ones were used, so the goods keep their expiry dates when they land '
  'somewhere else.';

revoke all on function public.take_batches(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.take_batches(uuid, uuid, integer) to service_role;

-- ------------------------------------------------------------------
-- Approving
-- ------------------------------------------------------------------
create or replace function public.approve_stock_transfer(p_transfer_id uuid)
returns public.stock_transfers
language plpgsql
security definer
set search_path = public
as $$
declare
  transfer public.stock_transfers;
begin
  -- Deliberately not 'warehouse'. A depot that can both raise and
  -- approve its own transfers can move stock wherever it likes without
  -- anybody agreeing to it.
  perform public.require_role('admin', 'senior_manager', 'manager');

  select * into transfer from public.stock_transfers where id = p_transfer_id for update;
  if not found then
    raise exception 'Transfer % not found', p_transfer_id;
  end if;

  if auth.uid() is not null and transfer.org_id is distinct from public.auth_org_id() then
    raise exception 'Transfer % not found', p_transfer_id using errcode = '42501';
  end if;

  if transfer.status <> 'draft' then
    raise exception 'Transfer % is % and can no longer be approved',
      transfer.transfer_number, transfer.status;
  end if;

  if not exists (select 1 from public.stock_transfer_items where transfer_id = p_transfer_id) then
    raise exception 'Transfer % has nothing on it', transfer.transfer_number;
  end if;

  update public.stock_transfers
     set status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
   where id = p_transfer_id
  returning * into transfer;

  return transfer;
end;
$$;

revoke all on function public.approve_stock_transfer(uuid) from public, anon;
grant execute on function public.approve_stock_transfer(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- Dispatching
-- ------------------------------------------------------------------
create or replace function public.dispatch_stock_transfer(p_transfer_id uuid)
returns public.stock_transfers
language plpgsql
security definer
set search_path = public
as $$
declare
  transfer  public.stock_transfers;
  item      record;
  available integer;
  expired   record;
  sent      jsonb;
begin
  perform public.require_role('admin', 'senior_manager', 'manager', 'warehouse');

  select * into transfer from public.stock_transfers where id = p_transfer_id for update;
  if not found then
    raise exception 'Transfer % not found', p_transfer_id;
  end if;

  if auth.uid() is not null and transfer.org_id is distinct from public.auth_org_id() then
    raise exception 'Transfer % not found', p_transfer_id using errcode = '42501';
  end if;

  if transfer.status <> 'approved' then
    raise exception
      'Transfer % must be approved before the goods leave (currently %)',
      transfer.transfer_number, transfer.status;
  end if;

  -- Nothing out of date is moved to another depot. Shipping expired
  -- stock across the country only relocates the write-off, and the far
  -- warehouse has no way of knowing. Checked before any movement is
  -- written, so a refused transfer moves nothing at all.
  select p.name, b.batch_number, b.expires_on
    into expired
    from public.stock_transfer_items i
    join public.products p on p.id = i.product_id
    join public.product_batches b
      on b.product_id = i.product_id
     and b.warehouse_id = transfer.from_warehouse_id
     and b.qty_remaining > 0
   where i.transfer_id = p_transfer_id
     and p.track_expiry
     and b.expires_on is not null
     and b.expires_on < current_date
   order by b.expires_on
   limit 1;

  if found then
    raise exception
      'Cannot dispatch %: batch % of % expired on %. Write it off before transferring.',
      transfer.transfer_number, expired.batch_number, expired.name, expired.expires_on;
  end if;

  -- Every line is checked for stock before the first one moves, so a
  -- transfer that cannot be filled does not half-empty the warehouse.
  for item in select * from public.stock_transfer_items where transfer_id = p_transfer_id loop
    select coalesce(qty_available, 0) into available
      from public.inventory
     where product_id = item.product_id and warehouse_id = transfer.from_warehouse_id;

    if coalesce(available, 0) < item.quantity then
      raise exception
        'Not enough stock to transfer: % available at the source, % requested',
        coalesce(available, 0), item.quantity;
    end if;
  end loop;

  for item in select * from public.stock_transfer_items where transfer_id = p_transfer_id loop
    -- Out of the source warehouse. The matching transfer_in is written
    -- at receipt, not here: between the two the goods are in transit
    -- and belong to neither depot, which is the honest position and the
    -- reason a transfer is not two adjustments.
    insert into public.stock_movements
      (org_id, product_id, warehouse_id, type, quantity,
       reference_type, reference_id, created_by)
    values
      (transfer.org_id, item.product_id, transfer.from_warehouse_id, 'transfer_out',
       item.quantity, 'stock_transfer', transfer.id, auth.uid());

    sent := public.take_batches(item.product_id, transfer.from_warehouse_id, item.quantity);

    update public.stock_transfer_items
       set batches_sent = sent
     where id = item.id;
  end loop;

  update public.stock_transfers
     set status = 'in_transit', dispatched_by = auth.uid(),
         dispatched_at = now(), updated_at = now()
   where id = p_transfer_id
  returning * into transfer;

  return transfer;
end;
$$;

revoke all on function public.dispatch_stock_transfer(uuid) from public, anon;
grant execute on function public.dispatch_stock_transfer(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- Receiving
-- ------------------------------------------------------------------
--
-- Takes the counted quantities rather than assuming everything arrived.
-- p_counts is [{item_id, quantity}]; a line not mentioned is taken to
-- have arrived in full.
create or replace function public.receive_stock_transfer(
  p_transfer_id uuid,
  p_counts      jsonb default '[]'::jsonb
)
returns public.stock_transfers
language plpgsql
security definer
set search_path = public
as $$
declare
  transfer public.stock_transfers;
  item     record;
  counted  integer;
  batch    jsonb;
  place    integer;
  left_to_place integer;
begin
  perform public.require_role('admin', 'senior_manager', 'manager', 'warehouse');

  select * into transfer from public.stock_transfers where id = p_transfer_id for update;
  if not found then
    raise exception 'Transfer % not found', p_transfer_id;
  end if;

  if auth.uid() is not null and transfer.org_id is distinct from public.auth_org_id() then
    raise exception 'Transfer % not found', p_transfer_id using errcode = '42501';
  end if;

  if transfer.status <> 'in_transit' then
    raise exception 'Transfer % is % and is not out for delivery',
      transfer.transfer_number, transfer.status;
  end if;

  if jsonb_typeof(p_counts) <> 'array' then
    raise exception 'Counts must be a list';
  end if;

  for item in select * from public.stock_transfer_items where transfer_id = p_transfer_id loop
    select (c ->> 'quantity')::integer into counted
      from jsonb_array_elements(p_counts) as c
     where (c ->> 'item_id')::uuid = item.id
     limit 1;

    counted := coalesce(counted, item.quantity);

    if counted < 0 then
      raise exception 'A received quantity cannot be negative';
    end if;

    -- More cannot arrive than left. If the far warehouse counts more,
    -- something else got mixed into the delivery and belongs on its own
    -- receipt rather than against this transfer.
    if counted > item.quantity then
      raise exception
        'More arrived than was sent: % received against % dispatched. '
        'Record the excess separately.', counted, item.quantity;
    end if;

    update public.stock_transfer_items set qty_received = counted where id = item.id;

    if counted > 0 then
      insert into public.stock_movements
        (org_id, product_id, warehouse_id, type, quantity,
         reference_type, reference_id, created_by)
      values
        (transfer.org_id, item.product_id, transfer.to_warehouse_id, 'transfer_in',
         counted, 'stock_transfer', transfer.id, auth.uid());

      -- The batches land at the far warehouse still carrying their own
      -- expiry dates. Filled oldest first, so a short delivery is short
      -- of the newest stock rather than of whatever the loop reached
      -- last.
      left_to_place := counted;
      for batch in
        select value from jsonb_array_elements(coalesce(item.batches_sent, '[]'::jsonb))
      loop
        exit when left_to_place <= 0;
        place := least((batch ->> 'quantity')::integer, left_to_place);

        insert into public.product_batches (
          org_id, product_id, warehouse_id, batch_number,
          manufactured_on, expires_on, qty_received, qty_remaining, received_by
        ) values (
          transfer.org_id, item.product_id, transfer.to_warehouse_id,
          batch ->> 'batch_number',
          (batch ->> 'manufactured_on')::date,
          (batch ->> 'expires_on')::date,
          place, place, auth.uid()
        )
        on conflict (org_id, product_id, warehouse_id, batch_number) do update
          set qty_received  = public.product_batches.qty_received  + excluded.qty_received,
              qty_remaining = public.product_batches.qty_remaining + excluded.qty_remaining,
              updated_at    = now();

        left_to_place := left_to_place - place;
      end loop;
    end if;
  end loop;

  update public.stock_transfers
     set status = 'received', received_by = auth.uid(),
         received_at = now(), updated_at = now()
   where id = p_transfer_id
  returning * into transfer;

  return transfer;
end;
$$;

comment on function public.receive_stock_transfer is
  'Book in a transfer against what was actually counted. Anything that '
  'did not arrive stays visible as a shortfall on the document.';

revoke all on function public.receive_stock_transfer(uuid, jsonb) from public, anon;
grant execute on function public.receive_stock_transfer(uuid, jsonb) to authenticated, service_role;

-- ------------------------------------------------------------------
-- Cancelling
-- ------------------------------------------------------------------
create or replace function public.cancel_stock_transfer(
  p_transfer_id uuid,
  p_reason      text default null
)
returns public.stock_transfers
language plpgsql
security definer
set search_path = public
as $$
declare
  transfer public.stock_transfers;
begin
  perform public.require_role('admin', 'senior_manager', 'manager', 'warehouse');

  select * into transfer from public.stock_transfers where id = p_transfer_id for update;
  if not found then
    raise exception 'Transfer % not found', p_transfer_id;
  end if;

  if auth.uid() is not null and transfer.org_id is distinct from public.auth_org_id() then
    raise exception 'Transfer % not found', p_transfer_id using errcode = '42501';
  end if;

  -- Once the goods have left, cancelling would strand them: the stock
  -- is out of the source warehouse and nowhere else. Such a transfer is
  -- received - possibly as zero - so the shortfall is recorded rather
  -- than hidden.
  if transfer.status not in ('draft', 'approved') then
    raise exception
      'Transfer % is % and can no longer be cancelled. Receive it against what actually arrived.',
      transfer.transfer_number, transfer.status;
  end if;

  update public.stock_transfers
     set status = 'cancelled', cancelled_reason = nullif(trim(coalesce(p_reason, '')), ''),
         updated_at = now()
   where id = p_transfer_id
  returning * into transfer;

  return transfer;
end;
$$;

revoke all on function public.cancel_stock_transfer(uuid, text) from public, anon;
grant execute on function public.cancel_stock_transfer(uuid, text) to authenticated, service_role;

-- ------------------------------------------------------------------
-- What the office reads
-- ------------------------------------------------------------------
create or replace view public.stock_transfer_summary
with (security_invoker = on) as
  select
    t.id,
    t.org_id,
    t.transfer_number,
    t.status,
    t.transfer_date,
    t.from_warehouse_id,
    src.name  as from_warehouse,
    t.to_warehouse_id,
    dst.name  as to_warehouse,
    t.notes,
    t.approved_at,
    t.dispatched_at,
    t.received_at,
    approver.full_name as approved_by_name,
    receiver.full_name as received_by_name,
    count(i.id)                                   as line_count,
    coalesce(sum(i.quantity), 0)                  as qty_sent,
    coalesce(sum(i.qty_received), 0)              as qty_received,
    -- What left and never arrived. The number the whole document exists
    -- to surface.
    coalesce(sum(i.quantity), 0) - coalesce(sum(coalesce(i.qty_received, i.quantity)), 0)
                                                  as qty_short
  from public.stock_transfers t
  join public.warehouses src on src.id = t.from_warehouse_id
  join public.warehouses dst on dst.id = t.to_warehouse_id
  left join public.stock_transfer_items i on i.transfer_id = t.id
  left join public.profiles approver on approver.id = t.approved_by
  left join public.profiles receiver on receiver.id = t.received_by
  group by t.id, t.org_id, t.transfer_number, t.status, t.transfer_date,
           t.from_warehouse_id, src.name, t.to_warehouse_id, dst.name, t.notes,
           t.approved_at, t.dispatched_at, t.received_at,
           approver.full_name, receiver.full_name;

comment on view public.stock_transfer_summary is
  'Transfers with what left, what arrived and the gap between them.';

-- Goods that have left one warehouse and not yet reached the other.
create or replace view public.stock_in_transit
with (security_invoker = on) as
  select
    t.org_id,
    t.id as transfer_id,
    t.transfer_number,
    t.dispatched_at,
    src.name as from_warehouse,
    dst.name as to_warehouse,
    i.product_id,
    p.sku,
    p.name as product_name,
    i.quantity,
    current_date - t.dispatched_at::date as days_in_transit
  from public.stock_transfers t
  join public.stock_transfer_items i on i.transfer_id = t.id
  join public.products p on p.id = i.product_id
  join public.warehouses src on src.id = t.from_warehouse_id
  join public.warehouses dst on dst.id = t.to_warehouse_id
  where t.status = 'in_transit';

comment on view public.stock_in_transit is
  'Stock that has left one warehouse and not arrived at the other. It '
  'belongs to neither depot, which is why it appears in no stock '
  'summary and needs its own report.';do $enum$
declare
  found text[];
  wanted text[] := array['info', 'warning', 'critical'];
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'notification_severity'
  ) then
    create type public.notification_severity as enum ('info', 'warning', 'critical');
  else
    select array_agg(e.enumlabel order by e.enumsortorder) into found
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'notification_severity';

    -- Already correct: nothing to do, and the script carries on.
    if found is distinct from wanted then
      raise exception
        'public.notification_severity already exists with different values. Found %, expected %. '
        'Reconcile it before running this script; this script will not alter an '
        'enum other code may already depend on.',
        found, wanted;
    end if;
  end if;
end $enum$;


create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,

  -- Addressed to a person, or to whoever holds a role. Most of these are
  -- a job rather than a message: "a transfer needs approving" is for
  -- whoever is managing today, not for one named manager who might be on
  -- leave.
  recipient_id   uuid references public.profiles(id) on delete cascade,
  recipient_role public.user_role,

  kind         text not null,
  severity     public.notification_severity not null default 'info',
  title        text not null,
  body         text,
  -- Where to go to deal with it. A notification that does not lead
  -- anywhere makes the reader hunt for the screen.
  link         text,

  subject_type text,
  subject_id   uuid,

  -- Set for a condition, null for an event. A condition is refreshed in
  -- place; an event is only ever inserted.
  standing     boolean not null default false,
  resolved_at  timestamptz,

  read_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint notifications_has_an_audience
    check (recipient_id is not null or recipient_role is not null),
  constraint notifications_title_not_blank
    check (length(trim(title)) > 0)
);

comment on table public.notifications is
  'What needs somebody. Events are written once and read; conditions are '
  'refreshed while they hold and cleared when they stop.';

-- One standing row per subject per kind, so refreshing updates rather
-- than piles up. Events are excluded: two sales genuinely are two
-- notifications.
create unique index if not exists notifications_standing_unique
  on public.notifications (org_id, kind, coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where standing;

create index if not exists notifications_for_role
  on public.notifications (org_id, recipient_role, created_at desc)
  where resolved_at is null;

create index if not exists notifications_for_person
  on public.notifications (recipient_id, created_at desc)
  where resolved_at is null;

drop trigger if exists notifications_touch on public.notifications;drop trigger if exists notifications_touch on public.notifications;
create trigger notifications_touch
  before update on public.notifications
  for each row execute function public.set_updated_at();


alter table public.notifications enable row level security;

-- You see what is addressed to you, and what is addressed to your job.
drop policy if exists notifications_read on public.notifications;drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications
  for select using (
    org_id = public.auth_org_id()
    and (
      recipient_id = auth.uid()
      or (recipient_role is not null and public.has_role(recipient_role))
    )
  );


-- Marking one read is the only thing a person does to it. The content is
-- written by the database, never by a browser: a notification anybody
-- could insert is a way to tell a manager something that did not happen.
drop policy if exists notifications_mark_read on public.notifications;drop policy if exists notifications_mark_read on public.notifications;
create policy notifications_mark_read on public.notifications
  for update using (
    org_id = public.auth_org_id()
    and (
      recipient_id = auth.uid()
      or (recipient_role is not null and public.has_role(recipient_role))
    )
  ) with check (
    org_id = public.auth_org_id()
  );


revoke all on public.notifications from anon, authenticated;
grant select, update on public.notifications to authenticated;
grant all on public.notifications to service_role;

-- ------------------------------------------------------------------
-- Writing one
-- ------------------------------------------------------------------
create or replace function public.notify(
  p_org       uuid,
  p_role      public.user_role,
  p_kind      text,
  p_title     text,
  p_body      text default null,
  p_link      text default null,
  p_severity  public.notification_severity default 'info',
  p_subject_type text default null,
  p_subject_id   uuid default null,
  p_standing  boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing uuid;
begin
  if p_standing then
    -- A condition that is already flagged is updated, not repeated. The
    -- read mark is cleared only when the wording changes, so somebody
    -- who has seen "3 lines below reorder" is told again when it
    -- becomes 11.
    select id into existing
      from public.notifications
     where org_id = p_org and kind = p_kind and standing
       and coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_subject_id, '00000000-0000-0000-0000-000000000000'::uuid);

    if existing is not null then
      update public.notifications
         set title = p_title,
             body = p_body,
             severity = p_severity,
             link = p_link,
             recipient_role = p_role,
             resolved_at = null,
             read_at = case when title is distinct from p_title
                             or body is distinct from p_body
                            then null else read_at end,
             updated_at = now()
       where id = existing;
      return existing;
    end if;
  end if;

  insert into public.notifications (
    org_id, recipient_role, kind, severity, title, body, link,
    subject_type, subject_id, standing
  ) values (
    p_org, p_role, p_kind, p_severity, p_title, p_body, p_link,
    p_subject_type, p_subject_id, p_standing
  )
  returning id into existing;

  return existing;
end;
$$;

revoke all on function public.notify(uuid, public.user_role, text, text, text, text,
  public.notification_severity, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.notify(uuid, public.user_role, text, text, text, text,
  public.notification_severity, text, uuid, boolean) to service_role;

-- ------------------------------------------------------------------
-- Events
-- ------------------------------------------------------------------

-- A driver has closed their day and somebody has to check the money.
create or replace function public.notify_reconciliation_submitted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who text;
  variance numeric(14,2);
begin
  if new.status <> 'submitted' or old.status is not distinct from 'submitted' then
    return new;
  end if;

  select full_name into who from public.profiles where id = new.driver_id;
  variance := coalesce(new.cash_variance, 0);

  perform public.notify(
    new.org_id, 'manager', 'reconciliation.submitted',
    coalesce(who, 'A driver') || ' has closed their day',
    case
      when variance = 0 then 'Cash counted to the penny.'
      when variance < 0 then 'Short by ' || to_char(abs(variance), 'FM999,999,990.00') || ' cedi.'
      else 'Over by ' || to_char(variance, 'FM999,999,990.00') || ' cedi.'
    end,
    '/reconciliation',
    case when abs(variance) > 0 then 'warning' else 'info' end::public.notification_severity,
    'reconciliation', new.id
  );

  return new;
end;
$$;

drop trigger if exists reconciliations_notify on public.van_reconciliations;drop trigger if exists reconciliations_notify on public.van_reconciliations;
create trigger reconciliations_notify
  after insert or update on public.van_reconciliations
  for each row execute function public.notify_reconciliation_submitted();


-- Goods have come back off a van and need approving before they count.
create or replace function public.notify_return_submitted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who text;
begin
  if new.status <> 'submitted' or old.status is not distinct from 'submitted' then
    return new;
  end if;

  select p.full_name into who
    from public.van_loads l join public.profiles p on p.id = l.driver_id
   where l.id = new.load_id;

  perform public.notify(
    new.org_id, 'manager', 'return.submitted',
    'Goods returned from ' || coalesce(who, 'a round'),
    'Approve the return so the stock goes back on the warehouse.',
    '/returns', 'info', 'van_return', new.id
  );

  return new;
end;
$$;

drop trigger if exists van_returns_notify on public.van_returns;drop trigger if exists van_returns_notify on public.van_returns;
create trigger van_returns_notify
  after insert or update on public.van_returns
  for each row execute function public.notify_return_submitted();


-- A transfer is waiting on a manager, which is the whole reason the
-- approval step exists.
create or replace function public.notify_transfer_raised()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  src text;
  dst text;
begin
  if new.status <> 'draft' then
    return new;
  end if;

  select name into src from public.warehouses where id = new.from_warehouse_id;
  select name into dst from public.warehouses where id = new.to_warehouse_id;

  perform public.notify(
    new.org_id, 'manager', 'transfer.awaiting_approval',
    'Transfer ' || new.transfer_number || ' needs approval',
    coalesce(src, 'a warehouse') || ' to ' || coalesce(dst, 'another warehouse')
      || '. Nothing moves until it is approved.',
    '/transfers/' || new.id, 'info', 'stock_transfer', new.id
  );

  return new;
end;
$$;

drop trigger if exists stock_transfers_notify on public.stock_transfers;drop trigger if exists stock_transfers_notify on public.stock_transfers;
create trigger stock_transfers_notify
  after insert on public.stock_transfers
  for each row execute function public.notify_transfer_raised();


-- A transfer arrived with less on it than left. Somebody has to find out
-- where the rest went, and the moment it is booked in is when anyone
-- still remembers the delivery.
create or replace function public.notify_transfer_short()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  short integer;
begin
  if new.status <> 'received' or old.status is not distinct from 'received' then
    return new;
  end if;

  select coalesce(sum(quantity - coalesce(qty_received, quantity)), 0) into short
    from public.stock_transfer_items where transfer_id = new.id;

  if short <= 0 then
    return new;
  end if;

  perform public.notify(
    new.org_id, 'manager', 'transfer.short',
    'Transfer ' || new.transfer_number || ' arrived short',
    short || ' units left but were not counted in at the far end.',
    '/transfers/' || new.id, 'critical', 'stock_transfer', new.id
  );

  return new;
end;
$$;

drop trigger if exists stock_transfers_notify_short on public.stock_transfers;drop trigger if exists stock_transfers_notify_short on public.stock_transfers;
create trigger stock_transfers_notify_short
  after update on public.stock_transfers
  for each row execute function public.notify_transfer_short();


-- ------------------------------------------------------------------
-- Conditions
-- ------------------------------------------------------------------
--
-- Recomputed rather than accumulated. Called on the dashboard, which is
-- where somebody is about to read the result anyway, so no scheduler is
-- required for any of this to work.
create or replace function public.refresh_standing_alerts(p_org uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  org      uuid := coalesce(p_org, public.auth_org_id());
  low         integer;
  expiring    integer;
  expired     integer;
  overdue_n   integer;
  overdue_sum numeric(14,2);
  over_limit  integer;
  stale       integer;
  raised      integer := 0;
begin
  if org is null then
    return 0;
  end if;

  -- ---- stock below its reorder point ------------------------------
  select count(*) into low
    from public.stock_summary
   where org_id = org and is_active and needs_reorder and reorder_point > 0;

  if low > 0 then
    perform public.notify(
      org, 'warehouse', 'stock.low',
      low || ' product' || case when low = 1 then '' else 's' end || ' below reorder point',
      'Reordering now avoids selling from an empty warehouse next week.',
      '/inventory?stock=low_stock', 'warning', 'inventory', null, true);
    raised := raised + 1;
  else
    update public.notifications set resolved_at = now()
     where org_id = org and kind = 'stock.low' and standing and resolved_at is null;
  end if;

  -- ---- stock that is going off ------------------------------------
  -- Guarded: a database that has not had 0024 has no batches, and a
  -- missing table should degrade this function rather than break the
  -- dashboard that calls it.
  if to_regclass('public.batch_expiry_status') is not null then
    execute $q$
      select
        count(*) filter (where status = 'expiring'),
        count(*) filter (where status = 'expired')
      from public.batch_expiry_status
      where org_id = $1 and qty_remaining > 0
    $q$ into expiring, expired using org;

    if coalesce(expired, 0) > 0 then
      perform public.notify(
        org, 'warehouse', 'stock.expired',
        expired || ' batch' || case when expired = 1 then '' else 'es' end || ' already out of date',
        'Nothing expired may be loaded onto a van or transferred. Write it off.',
        '/inventory/expiry', 'critical', 'inventory', null, true);
      raised := raised + 1;
    else
      update public.notifications set resolved_at = now()
       where org_id = org and kind = 'stock.expired' and standing and resolved_at is null;
    end if;

    if coalesce(expiring, 0) > 0 then
      perform public.notify(
        org, 'warehouse', 'stock.expiring',
        expiring || ' batch' || case when expiring = 1 then '' else 'es' end || ' expiring soon',
        'Sell these first, or they become a write-off.',
        '/inventory/expiry', 'warning', 'inventory', null, true);
      raised := raised + 1;
    else
      update public.notifications set resolved_at = now()
       where org_id = org and kind = 'stock.expiring' and standing and resolved_at is null;
    end if;
  end if;

  -- ---- money that is late -----------------------------------------
  select count(*), coalesce(sum(balance), 0) into overdue_n, overdue_sum
    from public.invoices
   where org_id = org and status <> 'void' and balance > 0 and due_date < current_date;

  if overdue_n > 0 then
    perform public.notify(
      org, 'accountant', 'invoices.overdue',
      overdue_n || ' invoice' || case when overdue_n = 1 then '' else 's' end || ' past due',
      to_char(overdue_sum, 'FM999,999,990.00') || ' cedi outstanding beyond terms.',
      '/invoices?status=overdue', 'warning', 'invoices', null, true);
    raised := raised + 1;
  else
    update public.notifications set resolved_at = now()
     where org_id = org and kind = 'invoices.overdue' and standing and resolved_at is null;
  end if;

  -- ---- customers beyond what they are allowed ----------------------
  select count(*) into over_limit
    from public.customer_credit_position
   where org_id = org and credit_limit > 0 and ledger_balance > credit_limit;

  if over_limit > 0 then
    perform public.notify(
      org, 'manager', 'credit.over_limit',
      over_limit || ' customer' || case when over_limit = 1 then ' is' else 's are' end
        || ' over their credit limit',
      'Further credit sales to them will be refused at the point of sale.',
      '/customers?credit=over_limit', 'warning', 'customers', null, true);
    raised := raised + 1;
  else
    update public.notifications set resolved_at = now()
     where org_id = org and kind = 'credit.over_limit' and standing and resolved_at is null;
  end if;

  -- ---- goods that have been on the road too long -------------------
  if to_regclass('public.stock_in_transit') is not null then
    execute $q$
      select count(distinct transfer_id) from public.stock_in_transit
       where org_id = $1 and days_in_transit > 2
    $q$ into stale using org;

    if coalesce(stale, 0) > 0 then
      perform public.notify(
        org, 'warehouse', 'transfer.stale',
        stale || ' transfer' || case when stale = 1 then '' else 's' end
          || ' still in transit',
        'Stock that left more than two days ago and has not been booked in anywhere.',
        '/transfers?status=in_transit', 'warning', 'inventory', null, true);
      raised := raised + 1;
    else
      update public.notifications set resolved_at = now()
       where org_id = org and kind = 'transfer.stale' and standing and resolved_at is null;
    end if;
  end if;

  return raised;
end;
$$;

comment on function public.refresh_standing_alerts is
  'Recompute the conditions worth telling somebody about. Safe to call '
  'as often as a screen loads: a condition that still holds is updated '
  'in place, and one that has ended is cleared.';

revoke all on function public.refresh_standing_alerts(uuid) from public, anon;
grant execute on function public.refresh_standing_alerts(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- Reading them
-- ------------------------------------------------------------------
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  touched integer;
begin
  if auth.uid() is null then
    return 0;
  end if;

  update public.notifications
     set read_at = now(), updated_at = now()
   where org_id = public.auth_org_id()
     and read_at is null
     and resolved_at is null
     and (recipient_id = auth.uid()
          or (recipient_role is not null and public.has_role(recipient_role)))
     and (p_ids is null or id = any(p_ids));

  get diagnostics touched = row_count;
  return touched;
end;
$$;

comment on function public.mark_notifications_read is
  'Mark the caller''s own notifications read. Passing no ids marks '
  'everything they can currently see.';

revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated, service_role;


-- ====================================================================
-- 0029_supplier_documents.sql
-- ====================================================================
-- ===================================================================
-- 0029  Supplier documents
-- ===================================================================
--
-- A delivery arrives with paperwork - an invoice, a waybill, a
-- certificate of analysis - and until now that paperwork went into a
-- drawer. When a supplier disputes what was delivered six weeks later,
-- the drawer is the only evidence, and the drawer is in one building.
--
-- Files go into a PRIVATE Supabase Storage bucket. Private is the whole
-- point: a public bucket hands every supplier invoice the business has
-- ever received to anybody who can guess a URL, and those documents
-- carry purchase prices. Access is by short-lived signed URL, minted
-- server side for somebody who has already been authorised.
--
-- The row in this table is the record; the file is an attachment to it.
-- That way a document is still accounted for if the object is ever
-- missing, rather than silently disappearing from the history.

-- ------------------------------------------------------------------
-- The bucket
-- ------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'supplier-documents', 'supplier-documents', false,
  -- 20 MB. A scanned invoice is under two; anything at twenty is a
  -- photograph nobody compressed, and beyond that it is not paperwork.
  20971520,
  array[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;do $enum$
declare
  found text[];
  wanted text[] := array['invoice', 'delivery_note', 'waybill', 'credit_note', 'certificate', 'contract', 'other'];
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'supplier_document_kind'
  ) then
    create type public.supplier_document_kind as enum ('invoice', 'delivery_note', 'waybill', 'credit_note', 'certificate', 'contract', 'other');
  else
    select array_agg(e.enumlabel order by e.enumsortorder) into found
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'supplier_document_kind';

    -- Already correct: nothing to do, and the script carries on.
    if found is distinct from wanted then
      raise exception
        'public.supplier_document_kind already exists with different values. Found %, expected %. '
        'Reconcile it before running this script; this script will not alter an '
        'enum other code may already depend on.',
        found, wanted;
    end if;
  end if;
end $enum$;


create table if not exists public.supplier_documents (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  supplier_id   uuid not null references public.suppliers(id) on delete restrict,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,

  kind          public.supplier_document_kind not null default 'other',
  title         text not null,
  reference     text,
  document_date date,
  -- What the supplier is charging, when the document says. Kept beside
  -- the file so a total can be reconciled without opening it.
  amount        numeric(14,2),

  -- Where the file is, inside the private bucket. The path is
  -- {org_id}/{supplier_id}/{uuid}, so an object cannot be reached from
  -- one organization's folder by guessing another's.
  storage_path  text not null,
  file_name     text not null,
  mime_type     text not null,
  size_bytes    bigint not null,

  notes         text,
  uploaded_by   uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint supplier_documents_title_not_blank check (length(trim(title)) > 0),
  constraint supplier_documents_size_sane check (size_bytes > 0 and size_bytes <= 20971520),
  -- Belt and braces with the bucket's own list: a row is refused even if
  -- somebody reconfigures the bucket later.
  constraint supplier_documents_type_allowed check (
    mime_type in (
      'application/pdf',
      'image/jpeg', 'image/png', 'image/webp', 'image/heic',
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    )
  ),
  -- One row per stored object. A second row pointing at the same file
  -- would make deleting either of them destroy the other's evidence.
  constraint supplier_documents_path_unique unique (storage_path)
);

comment on table public.supplier_documents is
  'Paperwork that arrived with a delivery. The row is the record; the '
  'file in the private bucket is an attachment to it.';

create index if not exists supplier_documents_supplier
  on public.supplier_documents (org_id, supplier_id, document_date desc);
create index if not exists supplier_documents_order
  on public.supplier_documents (purchase_order_id)
  where purchase_order_id is not null;

drop trigger if exists supplier_documents_touch on public.supplier_documents;drop trigger if exists supplier_documents_touch on public.supplier_documents;
create trigger supplier_documents_touch
  before update on public.supplier_documents
  for each row execute function public.set_updated_at();


alter table public.supplier_documents enable row level security;

-- Supplier paperwork carries purchase prices, which 0023 established is
-- management information. The same roles, for the same reason.
drop policy if exists supplier_documents_read on public.supplier_documents;drop policy if exists supplier_documents_read on public.supplier_documents;
create policy supplier_documents_read on public.supplier_documents
  for select using (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'accountant', 'warehouse')
  );


drop policy if exists supplier_documents_write on public.supplier_documents;drop policy if exists supplier_documents_write on public.supplier_documents;
create policy supplier_documents_write on public.supplier_documents
  for all using (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'accountant', 'warehouse')
  ) with check (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'accountant', 'warehouse')
  );


revoke all on public.supplier_documents from anon, authenticated;
grant select, insert, update, delete on public.supplier_documents to authenticated;
grant all on public.supplier_documents to service_role;

-- ------------------------------------------------------------------
-- The objects themselves
-- ------------------------------------------------------------------
--
-- Row level security on the bucket's objects, not only on the rows that
-- describe them. Storage is reachable directly with an access token, so
-- a policy only on supplier_documents would leave the files themselves
-- open to any signed-in driver.
--
-- The first path segment is the organization. A caller may only touch
-- objects under their own.
drop policy if exists supplier_documents_objects_read on storage.objects;drop policy if exists supplier_documents_objects_read on storage.objects;
create policy supplier_documents_objects_read on storage.objects
  for select to authenticated using (
    bucket_id = 'supplier-documents'
    and (storage.foldername(name))[1] = public.auth_org_id()::text
    and public.has_role('admin', 'senior_manager', 'manager', 'accountant', 'warehouse')
  );


drop policy if exists supplier_documents_objects_write on storage.objects;drop policy if exists supplier_documents_objects_write on storage.objects;
create policy supplier_documents_objects_write on storage.objects
  for insert to authenticated with check (
    bucket_id = 'supplier-documents'
    and (storage.foldername(name))[1] = public.auth_org_id()::text
    and public.has_role('admin', 'senior_manager', 'manager', 'accountant', 'warehouse')
  );


-- Deleting evidence is a narrower job than filing it. A storeman
-- uploads; removing a document that a dispute may later turn on is for
-- somebody accountable for that decision.
drop policy if exists supplier_documents_objects_delete on storage.objects;drop policy if exists supplier_documents_objects_delete on storage.objects;
create policy supplier_documents_objects_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'supplier-documents'
    and (storage.foldername(name))[1] = public.auth_org_id()::text
    and public.has_role('admin', 'senior_manager', 'manager')
  );


-- ------------------------------------------------------------------
-- What the office reads
-- ------------------------------------------------------------------
create or replace view public.supplier_document_detail
with (security_invoker = on) as
  select
    d.id,
    d.org_id,
    d.supplier_id,
    s.code  as supplier_code,
    s.name  as supplier_name,
    d.purchase_order_id,
    po.po_number,
    d.kind,
    d.title,
    d.reference,
    d.document_date,
    d.amount,
    d.storage_path,
    d.file_name,
    d.mime_type,
    d.size_bytes,
    d.notes,
    p.full_name as uploaded_by_name,
    d.created_at
  from public.supplier_documents d
  join public.suppliers s on s.id = d.supplier_id
  left join public.purchase_orders po on po.id = d.purchase_order_id
  left join public.profiles p on p.id = d.uploaded_by;

comment on view public.supplier_document_detail is
  'Supplier paperwork with the supplier and order it belongs to.';


-- ====================================================================
-- 0030_supplier_portal.sql
-- ====================================================================
-- ===================================================================
-- 0030  Letting a supplier see their own orders
-- ===================================================================
--
-- Suppliers ring up to ask what was ordered, what has been received and
-- what is still outstanding. Every one of those calls is a person in the
-- office reading a screen aloud.
--
-- The obvious answer - give the supplier a login - is the wrong one.
-- Accounts need provisioning, resetting and deprovisioning, and a
-- supplier's staff turn over without anybody telling us. So: a link,
-- which is a capability rather than an identity.
--
-- A link is a credential, and this one is treated like one:
--
--   it is stored as a digest, never in full. A leaked database backup
--   does not hand over working links, exactly as it does not hand over
--   PINs.
--   it expires. A link with no end date is a permanent grant to whoever
--   the supplier last forwarded it to.
--   it can be revoked without waiting for expiry.
--   guessing at it is rate limited, and every attempt is recorded.
--   it is scoped to one supplier, so it discloses nothing about any
--   other supplier and nothing about customers at all.
--
-- Nothing here is granted to anon. The portal route resolves the link
-- server side and then reads on the supplier's behalf, so the database's
-- position that anonymous callers get nothing is unchanged.

create table if not exists public.supplier_portal_tokens (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  supplier_id  uuid not null references public.suppliers(id) on delete cascade,

  -- The digest only. There is deliberately no way to recover the link
  -- from this table; if it is lost, a new one is issued.
  token_hash   text not null unique,
  -- Enough to tell two links apart in a list without holding the link.
  token_hint   text not null,
  label        text,

  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  revoked_by   uuid references public.profiles(id) on delete set null,

  last_used_at timestamptz,
  use_count    integer not null default 0,

  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),

  constraint supplier_portal_tokens_expiry_ahead check (expires_at > created_at)
);

comment on table public.supplier_portal_tokens is
  'Links handed to suppliers. Held as a digest, so this table cannot be '
  'read to obtain a working link.';

create index if not exists supplier_portal_tokens_supplier
  on public.supplier_portal_tokens (org_id, supplier_id, created_at desc);

alter table public.supplier_portal_tokens enable row level security;

-- The office can see which links exist, when they expire and whether
-- they have been used. Never the link itself, which is not here to see.
drop policy if exists supplier_portal_tokens_read on public.supplier_portal_tokens;drop policy if exists supplier_portal_tokens_read on public.supplier_portal_tokens;
create policy supplier_portal_tokens_read on public.supplier_portal_tokens
  for select using (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager')
  );


-- Issuing and revoking go through their own functions, which is where
-- the digest is computed and the expiry enforced. A row written by hand
-- could carry no expiry at all.
revoke all on public.supplier_portal_tokens from anon, authenticated;
grant select on public.supplier_portal_tokens to authenticated;
grant all on public.supplier_portal_tokens to service_role;

-- ------------------------------------------------------------------
-- Attempts
-- ------------------------------------------------------------------
create table if not exists public.supplier_portal_attempts (
  id           uuid primary key default gen_random_uuid(),
  request_ip   inet,
  user_agent   text,
  succeeded    boolean not null default false,
  -- Only on success. A failed attempt matched nothing by definition, and
  -- recording a guess against a supplier would be recording a guess.
  token_id     uuid references public.supplier_portal_tokens(id) on delete set null,
  attempted_at timestamptz not null default now()
);

comment on table public.supplier_portal_attempts is
  'Portal link attempts, for rate limiting. Holds no link and no digest.';

create index if not exists supplier_portal_attempts_by_ip
  on public.supplier_portal_attempts (request_ip, attempted_at desc)
  where request_ip is not null;

alter table public.supplier_portal_attempts enable row level security;
revoke all on public.supplier_portal_attempts from anon, authenticated;
grant all on public.supplier_portal_attempts to service_role;
-- No policy, so nothing but the service role reads it. Deliberate: this
-- is server-side machinery, and 0015 grants new tables to authenticated
-- by default.

-- ------------------------------------------------------------------
-- Issuing one
-- ------------------------------------------------------------------
--
-- Takes the digest rather than the link. The link is generated by the
-- application, shown once, and never travels to the database in full -
-- so it cannot appear in a query log, a statement sample, or a plan.
create or replace function public.issue_supplier_token(
  p_supplier_id uuid,
  p_token_hash  text,
  p_token_hint  text,
  p_days        integer default 30,
  p_label       text default null
)
returns public.supplier_portal_tokens
language plpgsql
security definer
set search_path = public
as $$
declare
  supplier public.suppliers;
  issued   public.supplier_portal_tokens;
begin
  perform public.require_role('admin', 'senior_manager', 'manager');

  select * into supplier from public.suppliers where id = p_supplier_id;
  if not found then
    raise exception 'Supplier % not found', p_supplier_id;
  end if;

  if auth.uid() is not null and supplier.org_id is distinct from public.auth_org_id() then
    raise exception 'Supplier % not found', p_supplier_id using errcode = '42501';
  end if;

  if p_token_hash is null or length(p_token_hash) < 32 then
    raise exception 'A portal link must be issued with a full digest';
  end if;

  -- A link that never expires is a permanent grant to whoever the
  -- supplier last forwarded it to.
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'A portal link lasts between 1 and 365 days';
  end if;

  insert into public.supplier_portal_tokens (
    org_id, supplier_id, token_hash, token_hint, label, expires_at, created_by
  ) values (
    supplier.org_id, p_supplier_id, p_token_hash, p_token_hint, nullif(trim(p_label), ''),
    now() + make_interval(days => p_days), auth.uid()
  )
  returning * into issued;

  return issued;
end;
$$;

revoke all on function public.issue_supplier_token(uuid, text, text, integer, text)
  from public, anon;
grant execute on function public.issue_supplier_token(uuid, text, text, integer, text)
  to authenticated, service_role;

create or replace function public.revoke_supplier_token(p_token_id uuid)
returns public.supplier_portal_tokens
language plpgsql
security definer
set search_path = public
as $$
declare
  token public.supplier_portal_tokens;
begin
  perform public.require_role('admin', 'senior_manager', 'manager');

  select * into token from public.supplier_portal_tokens where id = p_token_id;
  if not found then
    raise exception 'Portal link % not found', p_token_id;
  end if;

  if auth.uid() is not null and token.org_id is distinct from public.auth_org_id() then
    raise exception 'Portal link % not found', p_token_id using errcode = '42501';
  end if;

  update public.supplier_portal_tokens
     set revoked_at = coalesce(revoked_at, now()), revoked_by = auth.uid()
   where id = p_token_id
  returning * into token;

  return token;
end;
$$;

revoke all on function public.revoke_supplier_token(uuid) from public, anon;
grant execute on function public.revoke_supplier_token(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- Redeeming one
-- ------------------------------------------------------------------
--
-- Returns the supplier a link is for, or null. Null covers every kind of
-- failure - unknown, expired, revoked, rate limited - because telling
-- the holder of a bad link which of those it was tells them how to make
-- a better guess.
create or replace function public.resolve_supplier_token(
  p_token_hash text,
  p_ip         inet default null,
  p_user_agent text default null
)
returns table (supplier_id uuid, org_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  token   public.supplier_portal_tokens;
  recent  integer;
begin
  -- Guessing is cheap without this: the digest space is large, but an
  -- unthrottled endpoint is still an endpoint somebody will point a
  -- script at, and every attempt would otherwise cost nothing.
  if p_ip is not null then
    select count(*) into recent
      from public.supplier_portal_attempts
     where request_ip = p_ip
       and not succeeded
       and attempted_at > now() - interval '15 minutes';

    if recent >= 10 then
      insert into public.supplier_portal_attempts (request_ip, user_agent, succeeded)
      values (p_ip, p_user_agent, false);
      return;
    end if;
  end if;

  select * into token
    from public.supplier_portal_tokens t
   where t.token_hash = p_token_hash
     and t.revoked_at is null
     and t.expires_at > now();

  if not found then
    insert into public.supplier_portal_attempts (request_ip, user_agent, succeeded)
    values (p_ip, p_user_agent, false);
    return;
  end if;

  update public.supplier_portal_tokens
     set last_used_at = now(), use_count = use_count + 1
   where id = token.id;

  insert into public.supplier_portal_attempts (request_ip, user_agent, succeeded, token_id)
  values (p_ip, p_user_agent, true, token.id);

  return query select token.supplier_id, token.org_id, token.expires_at;
end;
$$;

comment on function public.resolve_supplier_token is
  'Exchange a link digest for the supplier it belongs to. Returns '
  'nothing for a link that is unknown, expired, revoked or rate '
  'limited - the holder is not told which.';

-- Only the server may redeem. The portal route resolves the link with
-- the service role and then reads on the supplier''s behalf, so nothing
-- here is exposed to a browser.
revoke all on function public.resolve_supplier_token(text, inet, text)
  from public, anon, authenticated;
grant execute on function public.resolve_supplier_token(text, inet, text) to service_role;

-- ------------------------------------------------------------------
-- What a supplier may see
-- ------------------------------------------------------------------
--
-- Their own orders and nothing else. No customer, no selling price, no
-- other supplier's line. These are read by the server with the service
-- role and always filtered to the resolved supplier, so the filter is
-- applied twice: here by construction, and again by the caller.
create or replace function public.supplier_portal_orders(
  p_supplier_id uuid,
  p_org_id      uuid
)
returns table (
  id uuid,
  po_number text,
  status public.po_status,
  order_date date,
  expected_date date,
  total numeric,
  lines bigint,
  qty_ordered bigint,
  qty_received bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    po.id,
    po.po_number,
    po.status,
    po.order_date,
    po.expected_date,
    po.total,
    count(i.id)                        as lines,
    coalesce(sum(i.quantity), 0)       as qty_ordered,
    coalesce(sum(i.qty_received), 0)   as qty_received
  from public.purchase_orders po
  left join public.purchase_order_items i on i.po_id = po.id
  where po.supplier_id = p_supplier_id
    and po.org_id = p_org_id
    and po.status <> 'draft'
  group by po.id, po.po_number, po.status, po.order_date, po.expected_date, po.total
  order by po.order_date desc
  limit 100;
$$;

comment on function public.supplier_portal_orders is
  'A supplier''s own orders. Drafts are excluded: an order the business '
  'has not sent is not something the supplier should learn about.';

revoke all on function public.supplier_portal_orders(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.supplier_portal_orders(uuid, uuid) to service_role;

create or replace function public.supplier_portal_order_lines(
  p_order_id    uuid,
  p_supplier_id uuid,
  p_org_id      uuid
)
returns table (
  product_name text,
  sku text,
  quantity integer,
  qty_received integer,
  unit_cost numeric,
  line_total numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.name,
    p.sku,
    i.quantity,
    i.qty_received,
    i.unit_cost,
    i.line_total
  from public.purchase_order_items i
  join public.purchase_orders po on po.id = i.po_id
  join public.products p on p.id = i.product_id
  where i.po_id = p_order_id
    and po.supplier_id = p_supplier_id
    and po.org_id = p_org_id
    and po.status <> 'draft';
$$;

comment on function public.supplier_portal_order_lines is
  'The lines of one of the supplier''s own orders. unit_cost here is '
  'what this supplier is charging us, which is their own price and not '
  'a disclosure.';

revoke all on function public.supplier_portal_order_lines(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.supplier_portal_order_lines(uuid, uuid, uuid) to service_role;

-- ------------------------------------------------------------------
-- Housekeeping
-- ------------------------------------------------------------------
create or replace function public.purge_supplier_portal_attempts(
  older_than interval default '30 days'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.supplier_portal_attempts
   where attempted_at < now() - older_than;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.purge_supplier_portal_attempts(interval)
  from public, anon, authenticated;
grant execute on function public.purge_supplier_portal_attempts(interval) to service_role;do $enum$
declare
  found text[];
  wanted text[] := array['pending', 'received', 'reviewing', 'approved', 'rejected'];
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'document_review_status'
  ) then
    create type public.document_review_status as enum ('pending', 'received', 'reviewing', 'approved', 'rejected');
  else
    select array_agg(e.enumlabel order by e.enumsortorder) into found
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'document_review_status';

    -- Already correct: nothing to do, and the script carries on.
    if found is distinct from wanted then
      raise exception
        'public.document_review_status already exists with different values. Found %, expected %. '
        'Reconcile it before running this script; this script will not alter an '
        'enum other code may already depend on.',
        found, wanted;
    end if;
  end if;
end $enum$;


alter table public.supplier_documents
  add column if not exists status public.document_review_status not null default 'approved',
  -- What the supplier typed, kept apart from what we recorded. If their
  -- number disagrees with ours, both are on the record rather than one
  -- having quietly overwritten the other.
  add column if not exists submitted_company text,
  add column if not exists submitted_by_name text,
  add column if not exists submitted_at timestamptz,
  add column if not exists submitted_via_token uuid,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text;

comment on column public.supplier_documents.status is
  'Where the document is up to. Defaults to approved because a document '
  'filed by our own staff has already been seen by somebody here; only '
  'a supplier submission starts at received.';

comment on column public.supplier_documents.submitted_company is
  'The name the supplier typed, which is not always the name we hold '
  'them under. Kept as evidence rather than corrected.';

create index if not exists supplier_documents_awaiting
  on public.supplier_documents (org_id, status, submitted_at desc)
  where status in ('received', 'reviewing');

-- ------------------------------------------------------------------
-- A supplier submitting one
-- ------------------------------------------------------------------
--
-- Runs for somebody holding a link, not a session, so it takes the
-- supplier and organization the link already resolved to rather than
-- reading them from anything the browser sent. The caller is the server;
-- nothing here is reachable from a page.
create or replace function public.submit_supplier_document(
  p_supplier_id  uuid,
  p_org_id       uuid,
  p_token_id     uuid,
  p_company      text,
  p_contact      text,
  p_reference    text,
  p_document_date date,
  p_amount       numeric,
  p_notes        text,
  p_storage_path text,
  p_file_name    text,
  p_mime_type    text,
  p_size_bytes   bigint
)
returns public.supplier_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  supplier public.suppliers;
  token    public.supplier_portal_tokens;
  document public.supplier_documents;
begin
  -- The link is checked again here rather than trusted from the caller.
  -- A revoked link must stop working everywhere at once, including for a
  -- request already in flight.
  select * into token
    from public.supplier_portal_tokens
   where id = p_token_id
     and supplier_id = p_supplier_id
     and org_id = p_org_id
     and revoked_at is null
     and expires_at > now();

  if not found then
    raise exception 'That link is no longer valid' using errcode = '42501';
  end if;

  select * into supplier from public.suppliers where id = p_supplier_id;
  if not found or supplier.org_id <> p_org_id then
    raise exception 'That link is no longer valid' using errcode = '42501';
  end if;

  if p_reference is null or length(trim(p_reference)) = 0 then
    raise exception 'An invoice number is required';
  end if;

  if p_amount is not null and p_amount < 0 then
    raise exception 'An invoice cannot be for a negative amount';
  end if;

  insert into public.supplier_documents (
    org_id, supplier_id, kind, title, reference, document_date, amount,
    storage_path, file_name, mime_type, size_bytes, notes,
    status, submitted_company, submitted_by_name, submitted_at, submitted_via_token
  ) values (
    p_org_id, p_supplier_id, 'invoice',
    'Invoice ' || trim(p_reference),
    trim(p_reference), p_document_date, p_amount,
    p_storage_path, p_file_name, p_mime_type, p_size_bytes,
    nullif(trim(coalesce(p_notes, '')), ''),
    'received',
    nullif(trim(coalesce(p_company, '')), ''),
    nullif(trim(coalesce(p_contact, '')), ''),
    now(), p_token_id
  )
  returning * into document;

  -- Somebody has to know it arrived. Without this it sits in a list
  -- nobody opens until the supplier rings to ask why they have not been
  -- paid.
  perform public.notify(
    p_org_id, 'accountant', 'supplier.invoice_received',
    supplier.name || ' has sent an invoice',
    'Invoice ' || trim(p_reference)
      || case when p_amount is not null
              then ' for ' || to_char(p_amount, 'FM999,999,990.00') || ' cedi'
              else '' end
      || '. It needs checking before it is approved for payment.',
    '/suppliers/' || p_supplier_id, 'info', 'supplier_document', document.id
  );

  return document;
end;
$$;

comment on function public.submit_supplier_document is
  'A supplier filing their own invoice through a portal link. The link '
  'is re-checked here, so revoking it stops a submission already in '
  'flight.';

revoke all on function public.submit_supplier_document(
  uuid, uuid, uuid, text, text, text, date, numeric, text, text, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.submit_supplier_document(
  uuid, uuid, uuid, text, text, text, date, numeric, text, text, text, text, bigint)
  to service_role;

-- What a supplier can see of what they have already sent.
create or replace function public.supplier_portal_documents(
  p_supplier_id uuid,
  p_org_id      uuid
)
returns table (
  id uuid,
  reference text,
  document_date date,
  amount numeric,
  status public.document_review_status,
  submitted_at timestamptz,
  file_name text,
  review_note text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    d.id, d.reference, d.document_date, d.amount, d.status,
    d.submitted_at, d.file_name,
    -- A rejection reason is the one part of our review the supplier
    -- needs, because it tells them what to send instead. Internal notes
    -- on an approved document are not their business.
    case when d.status = 'rejected' then d.review_note else null end
  from public.supplier_documents d
  where d.supplier_id = p_supplier_id
    and d.org_id = p_org_id
    and d.submitted_at is not null
  order by d.submitted_at desc
  limit 50;
$$;

revoke all on function public.supplier_portal_documents(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.supplier_portal_documents(uuid, uuid) to service_role;

-- ------------------------------------------------------------------
-- Reviewing one
-- ------------------------------------------------------------------
create or replace function public.review_supplier_document(
  p_document_id uuid,
  p_status      public.document_review_status,
  p_note        text default null
)
returns public.supplier_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  document public.supplier_documents;
begin
  -- Approving an invoice is agreeing to pay it.
  perform public.require_role('admin', 'senior_manager', 'manager', 'accountant');

  select * into document from public.supplier_documents where id = p_document_id;
  if not found then
    raise exception 'Document % not found', p_document_id;
  end if;

  if auth.uid() is not null and document.org_id is distinct from public.auth_org_id() then
    raise exception 'Document % not found', p_document_id using errcode = '42501';
  end if;

  if p_status not in ('reviewing', 'approved', 'rejected') then
    raise exception 'A review sets a document to reviewing, approved or rejected';
  end if;

  -- Sending an invoice back without saying why guarantees the supplier
  -- sends the same thing again.
  if p_status = 'rejected' and (p_note is null or length(trim(p_note)) = 0) then
    raise exception 'Say why it is being rejected, so the supplier knows what to send instead';
  end if;

  update public.supplier_documents
     set status = p_status,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_note = nullif(trim(coalesce(p_note, '')), ''),
         updated_at = now()
   where id = p_document_id
  returning * into document;

  return document;
end;
$$;

revoke all on function public.review_supplier_document(
  uuid, public.document_review_status, text) from public, anon;
grant execute on function public.review_supplier_document(
  uuid, public.document_review_status, text) to authenticated, service_role;

-- ------------------------------------------------------------------
-- What we owe suppliers
-- ------------------------------------------------------------------
alter table public.purchase_orders
  add column if not exists supplier_invoice_number text,
  add column if not exists supplier_invoice_date date;

comment on column public.purchase_orders.supplier_invoice_number is
  'The supplier''s own reference for this order. What they quote when '
  'they ring about payment.';

create or replace view public.supplier_payables
with (security_invoker = on) as
  select
    s.org_id,
    s.id                as supplier_id,
    s.code              as supplier_code,
    s.name              as supplier_name,
    s.payment_terms_days,
    count(po.id) filter (
      where po.status in ('submitted', 'partially_received', 'received')
    )                   as open_orders,
    coalesce(sum(po.total) filter (
      where po.status in ('partially_received', 'received')
    ), 0)::numeric(14,2) as received_value,
    coalesce(sum(po.total) filter (where po.status = 'submitted'), 0)::numeric(14,2)
                        as on_order_value,
    -- What they have actually billed us, from the invoices they sent
    -- through the portal or that we filed by hand.
    coalesce((
      select sum(d.amount) from public.supplier_documents d
       where d.supplier_id = s.id and d.kind = 'invoice'
         and d.status in ('received', 'reviewing', 'approved')
    ), 0)::numeric(14,2) as invoiced_value,
    (select count(*) from public.supplier_documents d
      where d.supplier_id = s.id and d.status in ('received', 'reviewing'))
                        as invoices_awaiting_review
  from public.suppliers s
  left join public.purchase_orders po on po.supplier_id = s.id
  group by s.org_id, s.id, s.code, s.name, s.payment_terms_days;

comment on view public.supplier_payables is
  'What each supplier has delivered, what they have billed, and how much '
  'of their paperwork is still waiting on somebody here.';

-- ------------------------------------------------------------------
-- Invoices can carry a discount
-- ------------------------------------------------------------------
--
-- A wholesaler settling a round often knocks something off. Recording
-- that as a reduced line price loses the fact a discount was given,
-- which is exactly the thing a manager wants to look at later.
alter table public.invoices
  add column if not exists discount numeric(14,2) not null default 0
    check (discount >= 0);

comment on column public.invoices.discount is
  'Taken off the total. Held separately so it can be reported on, rather '
  'than buried in a reduced line price.';

-- `total` already exists as a stored column, so the discount is applied
-- when the invoice is raised rather than by redefining it - dropping a
-- column the ageing view depends on would take the view with it.

-- ------------------------------------------------------------------
-- Waybills record what did not arrive
-- ------------------------------------------------------------------
alter table public.waybill_items
  add column if not exists qty_received integer,
  add column if not exists qty_damaged integer not null default 0,
  add column if not exists qty_short integer not null default 0;

alter table public.waybill_items
  drop constraint if exists waybill_items_damage_sane;
alter table public.waybill_items
  add constraint waybill_items_damage_sane
  check (qty_damaged >= 0 and qty_short >= 0 and qty_damaged + qty_short <= quantity);

comment on column public.waybill_items.qty_short is
  'What was on the waybill and not in the vehicle. The number the '
  'document exists to make somebody account for.';

-- Signing for a delivery, line by line.
create or replace function public.receive_waybill(
  p_waybill_id  uuid,
  p_received_by text,
  p_lines       jsonb default '[]'::jsonb
)
returns public.waybills
language plpgsql
security definer
set search_path = public
as $$
declare
  waybill public.waybills;
  item    record;
  damaged integer;
  short   integer;
begin
  perform public.require_role('admin', 'senior_manager', 'manager', 'warehouse');

  select * into waybill from public.waybills where id = p_waybill_id for update;
  if not found then
    raise exception 'Waybill % not found', p_waybill_id;
  end if;

  if auth.uid() is not null and waybill.org_id is distinct from public.auth_org_id() then
    raise exception 'Waybill % not found', p_waybill_id using errcode = '42501';
  end if;

  if waybill.status <> 'issued' then
    raise exception 'Waybill % is % and is not out for delivery',
      waybill.waybill_number, waybill.status;
  end if;

  if p_received_by is null or length(trim(p_received_by)) = 0 then
    raise exception 'Record who signed for the goods';
  end if;

  for item in select * from public.waybill_items where waybill_id = p_waybill_id loop
    select
      coalesce((l ->> 'damaged')::integer, 0),
      coalesce((l ->> 'short')::integer, 0)
      into damaged, short
      from jsonb_array_elements(p_lines) as l
     where (l ->> 'item_id')::uuid = item.id
     limit 1;

    damaged := coalesce(damaged, 0);
    short   := coalesce(short, 0);

    if damaged + short > item.quantity then
      raise exception
        'More was reported damaged or missing than was on the waybill: % against %',
        damaged + short, item.quantity;
    end if;

    update public.waybill_items
       set qty_damaged = damaged,
           qty_short = short,
           qty_received = item.quantity - damaged - short
     where id = item.id;
  end loop;

  update public.waybills
     set status = 'delivered', delivered_at = now(), received_by = trim(p_received_by),
         updated_at = now()
   where id = p_waybill_id
  returning * into waybill;

  return waybill;
end;
$$;

comment on function public.receive_waybill is
  'Sign a waybill in, recording what was damaged and what never turned '
  'up. Stock is not moved here: a waybill evidences a movement that a '
  'van load or a transfer already made.';

revoke all on function public.receive_waybill(uuid, text, jsonb) from public, anon;
grant execute on function public.receive_waybill(uuid, text, jsonb) to authenticated, service_role;do $enum$
declare
  found text[];
  wanted text[] := array['damaged', 'expired', 'wrong_item', 'customer_return', 'unsold', 'other'];
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'return_reason'
  ) then
    create type public.return_reason as enum ('damaged', 'expired', 'wrong_item', 'customer_return', 'unsold', 'other');
  else
    select array_agg(e.enumlabel order by e.enumsortorder) into found
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'return_reason';

    -- Already correct: nothing to do, and the script carries on.
    if found is distinct from wanted then
      raise exception
        'public.return_reason already exists with different values. Found %, expected %. '
        'Reconcile it before running this script; this script will not alter an '
        'enum other code may already depend on.',
        found, wanted;
    end if;
  end if;
end $enum$;


alter table public.van_return_items
  add column if not exists reason public.return_reason;

comment on column public.van_return_items.reason is
  'Why it came back. An enum rather than free text, because "damaged in '
  'the van" and "damaged on delivery" typed forty different ways cannot '
  'be counted.';

-- The existing free-text column stays: it is where the detail goes once
-- the reason above says which kind of detail it is.
comment on column public.van_return_items.damage_reason is
  'The detail behind the reason. What was wrong, not which category it '
  'falls into.';

-- ------------------------------------------------------------------
-- Returns that are not a van coming back
-- ------------------------------------------------------------------
--
-- Two other kinds of return exist and had nowhere to go: a customer
-- bringing goods back after a sale, and us sending goods back to a
-- supplier. Both move stock, and both were being recorded as
-- adjustments - which loses who returned what, and why.
create table if not exists public.stock_returns (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  return_number text not null default public.next_document_number('RTN', 'public.van_return_seq'),

  -- One of these, never both. A customer return comes in; a supplier
  -- return goes out.
  customer_id   uuid references public.customers(id) on delete restrict,
  supplier_id   uuid references public.suppliers(id) on delete restrict,
  warehouse_id  uuid not null references public.warehouses(id) on delete restrict,

  reason        public.return_reason not null,
  notes         text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),

  constraint stock_returns_one_party check (
    (customer_id is not null) <> (supplier_id is not null)
  )
);

comment on table public.stock_returns is
  'Goods coming back from a customer, or going back to a supplier. A van '
  'coming in at the end of a round is a van_return and stays there.';

create index if not exists stock_returns_org
  on public.stock_returns (org_id, created_at desc);

create table if not exists public.stock_return_items (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  return_id  uuid not null references public.stock_returns(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity   integer not null check (quantity > 0),
  notes      text,

  unique (return_id, product_id)
);

alter table public.stock_returns enable row level security;
alter table public.stock_return_items enable row level security;

drop policy if exists stock_returns_read on public.stock_returns;drop policy if exists stock_returns_read on public.stock_returns;
create policy stock_returns_read on public.stock_returns
  for select using (org_id = public.auth_org_id());


drop policy if exists stock_returns_write on public.stock_returns;drop policy if exists stock_returns_write on public.stock_returns;
create policy stock_returns_write on public.stock_returns
  for all using (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'warehouse')
  ) with check (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'warehouse')
  );


drop policy if exists stock_return_items_read on public.stock_return_items;drop policy if exists stock_return_items_read on public.stock_return_items;
create policy stock_return_items_read on public.stock_return_items
  for select using (
    org_id = public.auth_org_id()
    and exists (select 1 from public.stock_returns r where r.id = stock_return_items.return_id)
  );


drop policy if exists stock_return_items_write on public.stock_return_items;drop policy if exists stock_return_items_write on public.stock_return_items;
create policy stock_return_items_write on public.stock_return_items
  for all using (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'warehouse')
  ) with check (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'warehouse')
  );


grant select on public.stock_returns to authenticated;
grant select on public.stock_return_items to authenticated;
grant all on public.stock_returns to service_role;
grant all on public.stock_return_items to service_role;

-- Recording one, and moving the stock with it.
create or replace function public.record_stock_return(
  p_warehouse_id uuid,
  p_reason       public.return_reason,
  p_lines        jsonb,
  p_customer_id  uuid default null,
  p_supplier_id  uuid default null,
  p_notes        text default null
)
returns public.stock_returns
language plpgsql
security definer
set search_path = public
as $$
declare
  org       uuid;
  entry     public.stock_returns;
  line      jsonb;
  quantity  integer;
  product   uuid;
  available integer;
begin
  perform public.require_role('admin', 'senior_manager', 'manager', 'warehouse');

  if (p_customer_id is null) = (p_supplier_id is null) then
    raise exception 'A return is either from a customer or to a supplier, not both';
  end if;

  select org_id into org from public.warehouses where id = p_warehouse_id;
  if org is null then
    raise exception 'Warehouse % not found', p_warehouse_id;
  end if;

  if auth.uid() is not null and org is distinct from public.auth_org_id() then
    raise exception 'Warehouse % not found', p_warehouse_id using errcode = '42501';
  end if;

  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A return needs at least one line';
  end if;

  insert into public.stock_returns
    (org_id, customer_id, supplier_id, warehouse_id, reason, notes, created_by)
  values
    (org, p_customer_id, p_supplier_id, p_warehouse_id, p_reason,
     nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
  returning * into entry;

  for line in select * from jsonb_array_elements(p_lines) loop
    product  := (line ->> 'product_id')::uuid;
    quantity := (line ->> 'quantity')::integer;

    if product is null or quantity is null or quantity <= 0 then
      raise exception 'Every line needs a product and a quantity above zero';
    end if;

    insert into public.stock_return_items (org_id, return_id, product_id, quantity, notes)
    values (org, entry.id, product, quantity, nullif(trim(line ->> 'notes'), ''));

    if p_customer_id is not null then
      -- Goods coming back in. Damaged or expired stock is booked in and
      -- then written off separately, so the return and the write-off are
      -- two facts rather than one entry that hides the first.
      insert into public.stock_movements
        (org_id, product_id, warehouse_id, type, quantity,
         reference_type, reference_id, reason, created_by)
      values
        (org, product, p_warehouse_id, 'customer_return', quantity,
         'stock_return', entry.id, p_reason::text, auth.uid());
    else
      -- Going back to the supplier, so it has to be there to send.
      select coalesce(qty_available, 0) into available
        from public.inventory
       where product_id = product and warehouse_id = p_warehouse_id;

      if coalesce(available, 0) < quantity then
        raise exception
          'Cannot return % of that line to the supplier: only % on hand',
          quantity, coalesce(available, 0);
      end if;

      insert into public.stock_movements
        (org_id, product_id, warehouse_id, type, quantity,
         reference_type, reference_id, reason, created_by)
      values
        (org, product, p_warehouse_id, 'supplier_return', quantity,
         'stock_return', entry.id, p_reason::text, auth.uid());
    end if;
  end loop;

  return entry;
end;
$$;

comment on function public.record_stock_return is
  'A customer bringing goods back, or goods going back to a supplier. '
  'Moves the stock through the ledger rather than adjusting a quantity.';

revoke all on function public.record_stock_return(
  uuid, public.return_reason, jsonb, uuid, uuid, text) from public, anon;
grant execute on function public.record_stock_return(
  uuid, public.return_reason, jsonb, uuid, uuid, text) to authenticated, service_role;

create or replace view public.stock_return_summary
with (security_invoker = on) as
  select
    r.id,
    r.org_id,
    r.return_number,
    r.reason,
    r.created_at,
    r.notes,
    case when r.customer_id is not null then 'customer' else 'supplier' end as direction,
    coalesce(c.name, s.name)  as party_name,
    coalesce(c.code, s.code)  as party_code,
    w.name                    as warehouse_name,
    p.full_name               as recorded_by,
    count(i.id)               as line_count,
    coalesce(sum(i.quantity), 0) as total_quantity
  from public.stock_returns r
  join public.warehouses w on w.id = r.warehouse_id
  left join public.customers c on c.id = r.customer_id
  left join public.suppliers s on s.id = r.supplier_id
  left join public.profiles p on p.id = r.created_by
  left join public.stock_return_items i on i.return_id = r.id
  group by r.id, r.org_id, r.return_number, r.reason, r.created_at, r.notes,
           r.customer_id, c.name, c.code, s.name, s.code, w.name, p.full_name;

-- ------------------------------------------------------------------
-- Two more things the office should be told
-- ------------------------------------------------------------------

-- A delivery has been booked in against an order.
create or replace function public.notify_purchase_received()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  supplier text;
begin
  if new.status not in ('received', 'partially_received')
     or old.status is not distinct from new.status then
    return new;
  end if;

  select name into supplier from public.suppliers where id = new.supplier_id;

  perform public.notify(
    new.org_id, 'accountant', 'purchase.received',
    coalesce(supplier, 'A supplier') || ' delivery booked in',
    new.po_number || ' is now '
      || case when new.status = 'received' then 'fully received'
              else 'part received' end
      || '. Their invoice can be matched against it.',
    '/purchasing', 'info', 'purchase_order', new.id
  );

  return new;
end;
$$;

drop trigger if exists purchase_orders_notify_received on public.purchase_orders;drop trigger if exists purchase_orders_notify_received on public.purchase_orders;
create trigger purchase_orders_notify_received
  after update on public.purchase_orders
  for each row execute function public.notify_purchase_received();


-- An offline operation came back from a device and could not be applied.
-- Guarded: sync_operations arrived in 0022, and a database that skipped
-- it should not fail this migration.
do $sync$
begin
  if to_regclass('public.sync_operations') is null then
    return;
  end if;

  execute $fn$
    create or replace function public.notify_sync_failed()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
      who text;
    begin
      if new.status <> 'failed' or old.status is not distinct from 'failed' then
        return new;
      end if;

      select full_name into who from public.profiles where id = new.profile_id;

      -- A driver whose sale did not apply believes it did. Somebody in
      -- the office has to find out before the customer is asked to pay
      -- twice, or never asked at all.
      perform public.notify(
        new.org_id, 'manager', 'sync.failed',
        'An offline operation from ' || coalesce(who, 'a driver') || ' failed',
        coalesce(new.error, 'It could not be applied.')
          || ' The device believes it was recorded.',
        '/driver/queue', 'critical', 'sync_operation', new.id
      );

      return new;
    end;
    $body$;
  $fn$;

  execute 'drop trigger if exists sync_operations_notify_failed on public.sync_operations';
  execute $trg$
    create trigger sync_operations_notify_failed
      after insert or update on public.sync_operations
      for each row execute function public.notify_sync_failed()
  $trg$;
end
$sync$;

-- ------------------------------------------------------------------
-- Redeeming a link now says which link it was
-- ------------------------------------------------------------------
--
-- submit_supplier_document() re-checks the link at the moment of
-- submission, which means it needs the link's id - and the version in
-- 0030 returned only the supplier and the organization. Replaced here
-- rather than edited there, so a database already at 0030 gets the
-- change by running this script.
--
-- The token id is not a secret: it identifies a row, not a credential,
-- and the digest is what actually opens anything.
drop function if exists public.resolve_supplier_token(text, inet, text);

create or replace function public.resolve_supplier_token(
  p_token_hash text,
  p_ip         inet default null,
  p_user_agent text default null
)
returns table (supplier_id uuid, org_id uuid, token_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  token   public.supplier_portal_tokens;
  recent  integer;
begin
  if p_ip is not null then
    select count(*) into recent
      from public.supplier_portal_attempts
     where request_ip = p_ip
       and not succeeded
       and attempted_at > now() - interval '15 minutes';

    if recent >= 10 then
      insert into public.supplier_portal_attempts (request_ip, user_agent, succeeded)
      values (p_ip, p_user_agent, false);
      return;
    end if;
  end if;

  select * into token
    from public.supplier_portal_tokens t
   where t.token_hash = p_token_hash
     and t.revoked_at is null
     and t.expires_at > now();

  if not found then
    insert into public.supplier_portal_attempts (request_ip, user_agent, succeeded)
    values (p_ip, p_user_agent, false);
    return;
  end if;

  update public.supplier_portal_tokens
     set last_used_at = now(), use_count = use_count + 1
   where id = token.id;

  insert into public.supplier_portal_attempts (request_ip, user_agent, succeeded, token_id)
  values (p_ip, p_user_agent, true, token.id);

  return query select token.supplier_id, token.org_id, token.id, token.expires_at;
end;
$$;

comment on function public.resolve_supplier_token is
  'Exchange a link digest for the supplier it belongs to. Returns '
  'nothing for a link that is unknown, expired, revoked or rate '
  'limited - the holder is not told which.';

revoke all on function public.resolve_supplier_token(text, inet, text)
  from public, anon, authenticated;
grant execute on function public.resolve_supplier_token(text, inet, text) to service_role;


-- ------------------------------------------------------------------
-- The office view carries the review state
-- ------------------------------------------------------------------
--
-- Appended rather than reordered: `create or replace view` refuses to
-- rename or reorder an existing column, so the new ones go on the end.
create or replace view public.supplier_document_detail
with (security_invoker = on) as
  select
    d.id,
    d.org_id,
    d.supplier_id,
    s.code  as supplier_code,
    s.name  as supplier_name,
    d.purchase_order_id,
    po.po_number,
    d.kind,
    d.title,
    d.reference,
    d.document_date,
    d.amount,
    d.storage_path,
    d.file_name,
    d.mime_type,
    d.size_bytes,
    d.notes,
    p.full_name as uploaded_by_name,
    d.created_at,
    d.status,
    d.submitted_company,
    d.submitted_by_name,
    d.submitted_at,
    r.full_name as reviewed_by_name,
    d.reviewed_at,
    d.review_note
  from public.supplier_documents d
  join public.suppliers s on s.id = d.supplier_id
  left join public.purchase_orders po on po.id = d.purchase_order_id
  left join public.profiles p on p.id = d.uploaded_by
  left join public.profiles r on r.id = d.reviewed_by;do $enum$
declare
  found text[];
  wanted text[] := array['driver', 'salesperson'];
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'crew_role'
  ) then
    create type public.crew_role as enum ('driver', 'salesperson');
  else
    select array_agg(e.enumlabel order by e.enumsortorder) into found
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'crew_role';

    -- Already correct: nothing to do, and the script carries on.
    if found is distinct from wanted then
      raise exception
        'public.crew_role already exists with different values. Found %, expected %. '
        'Reconcile it before running this script; this script will not alter an '
        'enum other code may already depend on.',
        found, wanted;
    end if;
  end if;
end $enum$;


-- The `salesperson` role itself is added by migration 0032, on its own,
-- because PostgreSQL will not let a new enum label be used in the
-- transaction that created it - and the policies below use it.

-- ------------------------------------------------------------------
-- van_assignments becomes a crew list
-- ------------------------------------------------------------------
-- Guarded: a rename is not idempotent, and this script has to survive
-- being run twice - which is exactly what somebody does when they are
-- not sure whether it took the first time.
do $rename_member$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'van_assignments'
       and column_name = 'driver_id'
  ) then
    alter table public.van_assignments rename column driver_id to member_id;
  end if;
end
$rename_member$;

alter table public.van_assignments
  add column if not exists crew_role public.crew_role;

-- Everything already there was a driver assignment, because that is the
-- only thing the table could hold.
update public.van_assignments set crew_role = 'driver' where crew_role is null;

alter table public.van_assignments
  alter column crew_role set not null,
  alter column crew_role set default 'salesperson';

comment on column public.van_assignments.member_id is
  'The crew member. Was driver_id, when a van could only have a driver.';
comment on column public.van_assignments.crew_role is
  'What they do on this van. Defaults to salesperson: a van takes one '
  'driver and any number of people selling from it, so the common case '
  'is the one that needs no thought.';

-- One driver per van, rather than one crew member per van.
drop index if exists public.van_assignments_one_active_van;
create unique index if not exists van_assignments_one_active_driver_per_van
  on public.van_assignments (van_id)
  where unassigned_at is null and crew_role = 'driver';

-- A person is on one van at a time, whichever job they do. Somebody
-- selling from two vans at once is a mistake, not a configuration.
drop index if exists public.van_assignments_one_active_driver;
create unique index if not exists van_assignments_one_active_van_per_member
  on public.van_assignments (member_id) where unassigned_at is null;

drop index if exists public.van_assignments_driver_idx;
create index if not exists van_assignments_member_idx
  on public.van_assignments (member_id);
create index if not exists van_assignments_van_crew_idx
  on public.van_assignments (van_id, crew_role) where unassigned_at is null;

-- ------------------------------------------------------------------
-- Who may be crewed
-- ------------------------------------------------------------------
create or replace function public.check_crew_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  member public.profiles;
  van    public.vans;
begin
  select * into member from public.profiles where id = new.member_id;
  if not found then
    raise exception 'That person does not exist';
  end if;

  if not member.is_active then
    raise exception 'Cannot crew %: their account is not active', member.full_name;
  end if;

  select * into van from public.vans where id = new.van_id;
  if van.org_id is distinct from member.org_id then
    raise exception 'That person belongs to a different organization';
  end if;

  -- The job on the van has to match what the person is employed to do.
  -- A driver crewed as a salesperson would be handed the till.
  if new.crew_role = 'driver' and member.role not in ('driver', 'admin', 'senior_manager', 'manager') then
    raise exception 'Only a driver can be crewed to drive. % is a %', member.full_name, member.role;
  end if;

  if new.crew_role = 'salesperson'
     and member.role not in ('salesperson', 'sales_rep', 'admin', 'senior_manager', 'manager') then
    raise exception 'Only a salesperson can be crewed to sell. % is a %', member.full_name, member.role;
  end if;

  return new;
end;
$$;

drop trigger if exists van_assignments_check_member on public.van_assignments;drop trigger if exists van_assignments_check_member on public.van_assignments;
create trigger van_assignments_check_member
  before insert or update on public.van_assignments
  for each row execute function public.check_crew_member();


-- ------------------------------------------------------------------
-- The van a person is on, whatever they do on it
-- ------------------------------------------------------------------
create or replace function public.my_van_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select van_id from public.van_assignments
  where member_id = auth.uid() and unassigned_at is null
  limit 1
$$;

comment on function public.my_van_id is
  'The van the caller is crewed on. Any crew member, not only the '
  'driver: a salesperson needs the van stock to sell from it.';

-- Whether the caller is on this van's crew. The predicate every field
-- policy is written against, so "may this person touch this van" is
-- decided in one place rather than twenty.
create or replace function public.is_van_crew(p_van_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.van_assignments
     where van_id = p_van_id
       and member_id = auth.uid()
       and unassigned_at is null
  )
$$;

revoke all on function public.is_van_crew(uuid) from public, anon;
grant execute on function public.is_van_crew(uuid) to authenticated, service_role;

-- Crewed specifically to sell.
--
-- Being aboard is not the same as being allowed to take money. The
-- fill-in trigger below stamps a sale with whoever recorded it, so a
-- policy that only asked "are you the salesperson on this row" would be
-- satisfied by anybody who inserted one - including the driver. This is
-- the predicate that actually gates selling.
create or replace function public.is_van_salesperson(p_van_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.van_assignments
     where van_id = p_van_id
       and member_id = auth.uid()
       and crew_role = 'salesperson'
       and unassigned_at is null
  )
$$;

revoke all on function public.is_van_salesperson(uuid) from public, anon;
grant execute on function public.is_van_salesperson(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- Who is on a van right now
-- ------------------------------------------------------------------
create or replace view public.van_crew
with (security_invoker = on) as
  select
    a.org_id,
    a.van_id,
    v.code        as van_code,
    v.registration_no,
    a.member_id,
    p.full_name   as member_name,
    p.phone       as member_phone,
    a.crew_role,
    a.assigned_at,
    a.assigned_by
  from public.van_assignments a
  join public.vans v on v.id = a.van_id
  join public.profiles p on p.id = a.member_id
  where a.unassigned_at is null;

comment on view public.van_crew is
  'The crew currently on each van. One driver, and whoever is selling.';

-- ------------------------------------------------------------------
-- A sale records who sold it and who drove
-- ------------------------------------------------------------------
alter table public.van_sales
  add column if not exists salesperson_id uuid references public.profiles(id) on delete restrict;

-- Every sale so far was made by the person driving, because the schema
-- had nobody else to attribute it to. That is what happened, so it is
-- what gets recorded.
update public.van_sales set salesperson_id = driver_id where salesperson_id is null;

alter table public.van_sales
  alter column salesperson_id set not null;

create index if not exists van_sales_salesperson_idx
  on public.van_sales (salesperson_id, sold_at desc);

comment on column public.van_sales.salesperson_id is
  'Who made the sale. Distinct from driver_id, which is who drove the '
  'van: they are different jobs and usually different people.';
comment on column public.van_sales.driver_id is
  'Who drove the van this was sold from. Not who sold it.';

-- The same on a return, so a shortage is attributable.
alter table public.van_returns
  add column if not exists salesperson_id uuid references public.profiles(id) on delete set null;

-- ------------------------------------------------------------------
-- Filling in the crew a caller did not have to think about
-- ------------------------------------------------------------------
create or replace function public.fill_sale_crew()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  load public.van_loads;
begin
  -- The salesperson is whoever is recording the sale, unless the office
  -- is entering it on their behalf and has said who for.
  if new.salesperson_id is null then
    new.salesperson_id := auth.uid();
  end if;

  -- The driver comes from the load. Asking a salesperson who drove them
  -- today would be a question with one possible answer.
  if new.driver_id is null then
    select * into load from public.van_loads where id = new.load_id;
    new.driver_id := load.driver_id;
  end if;

  return new;
end;
$$;

drop trigger if exists van_sales_fill_crew on public.van_sales;drop trigger if exists van_sales_fill_crew on public.van_sales;
create trigger van_sales_fill_crew
  before insert on public.van_sales
  for each row execute function public.fill_sale_crew();


-- driver_id can now be derived, so it no longer has to be supplied.
alter table public.van_sales alter column driver_id drop not null;

-- ------------------------------------------------------------------
-- The crew that went out with a load
-- ------------------------------------------------------------------
--
-- Snapshotted at dispatch rather than read live, because a waybill has
-- to say who took the goods out on the day - not who is on the van
-- three weeks later when somebody prints it again.
create table if not exists public.van_load_crew (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  load_id    uuid not null references public.van_loads(id) on delete cascade,
  member_id  uuid not null references public.profiles(id) on delete restrict,
  crew_role  public.crew_role not null,
  created_at timestamptz not null default now(),

  unique (load_id, member_id)
);

create index if not exists van_load_crew_load_idx on public.van_load_crew (load_id);

comment on table public.van_load_crew is
  'Who went out with this load. A snapshot, so the waybill still names '
  'the right people after the crew changes.';

alter table public.van_load_crew enable row level security;

drop policy if exists van_load_crew_read on public.van_load_crew;drop policy if exists van_load_crew_read on public.van_load_crew;
create policy van_load_crew_read on public.van_load_crew
  for select using (
    org_id = public.auth_org_id()
    and (
      public.has_role('admin', 'senior_manager', 'manager', 'accountant', 'warehouse')
      or member_id = auth.uid()
      or exists (select 1 from public.van_loads l
                  where l.id = van_load_crew.load_id and public.is_van_crew(l.van_id))
    )
  );


drop policy if exists van_load_crew_write on public.van_load_crew;drop policy if exists van_load_crew_write on public.van_load_crew;
create policy van_load_crew_write on public.van_load_crew
  for all using (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'warehouse')
  ) with check (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'warehouse')
  );


grant select on public.van_load_crew to authenticated;
grant all on public.van_load_crew to service_role;

-- Dispatch records the crew as it stands at that moment.
create or replace function public.snapshot_load_crew()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'dispatched' and old.status is distinct from 'dispatched' then
    insert into public.van_load_crew (org_id, load_id, member_id, crew_role)
    select new.org_id, new.id, a.member_id, a.crew_role
      from public.van_assignments a
     where a.van_id = new.van_id and a.unassigned_at is null
    on conflict (load_id, member_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists van_loads_snapshot_crew on public.van_loads;drop trigger if exists van_loads_snapshot_crew on public.van_loads;
create trigger van_loads_snapshot_crew
  after update on public.van_loads
  for each row execute function public.snapshot_load_crew();


-- ------------------------------------------------------------------
-- A van does not go out without a crew
-- ------------------------------------------------------------------
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
  expired_line record;
  sellers integer;
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

  if load.driver_confirmed_at is null then
    raise exception 'Load % has not been confirmed by the driver', load.load_number;
  end if;

  if not exists (select 1 from public.van_load_items where load_id = p_load_id) then
    raise exception 'Load % has no items', load.load_number;
  end if;

  -- A van with nobody to sell from it is a delivery, not a round. Goods
  -- would leave the warehouse with no way to record what happened to
  -- them, which is how stock goes missing without anybody being wrong.
  select count(*) into sellers
    from public.van_assignments
   where van_id = load.van_id and unassigned_at is null and crew_role = 'salesperson';

  if sellers = 0 then
    raise exception
      'No salesperson is crewed on this van. Assign one before dispatching %.',
      load.load_number;
  end if;

  -- Nothing out of date leaves the yard. Checked before any movement is
  -- written, so a refused load moves no stock at all.
  select p.name, b.batch_number, b.expires_on
    into expired_line
    from public.van_load_items i
    join public.products p on p.id = i.product_id
    join public.product_batches b
      on b.product_id = i.product_id
     and b.warehouse_id = load.warehouse_id
     and b.qty_remaining > 0
   where i.load_id = p_load_id
     and p.track_expiry
     and b.expires_on is not null
     and b.expires_on < current_date
   order by b.expires_on
   limit 1;

  if found then
    raise exception
      'Cannot dispatch %: batch % of % expired on %. Remove it from the warehouse before loading.',
      load.load_number, expired_line.batch_number, expired_line.name, expired_line.expires_on;
  end if;

  for item in select * from public.van_load_items where load_id = p_load_id loop
    select coalesce(qty_available, 0) into available
    from public.inventory
    where product_id = item.product_id and warehouse_id = load.warehouse_id;

    if coalesce(available, 0) < item.qty_loaded then
      raise exception 'Insufficient stock for product %: % available, % requested',
        item.product_id, coalesce(available, 0), item.qty_loaded;
    end if;

    insert into public.stock_movements
      (org_id, product_id, warehouse_id, type, quantity, unit_cost,
       reference_type, reference_id, created_by)
    values
      (load.org_id, item.product_id, load.warehouse_id, 'transfer_out',
       item.qty_loaded, item.unit_cost, 'van_load', load.id, auth.uid());

    insert into public.stock_movements
      (org_id, product_id, van_id, type, quantity, unit_cost,
       reference_type, reference_id, created_by)
    values
      (load.org_id, item.product_id, load.van_id, 'transfer_in',
       item.qty_loaded, item.unit_cost, 'van_load', load.id, auth.uid());

    perform public.consume_batches(item.product_id, load.warehouse_id, item.qty_loaded);
  end loop;

  update public.van_loads
     set status = 'dispatched', dispatched_at = now(), updated_at = now()
   where id = p_load_id
  returning * into load;

  return load;
end;
$$;

-- ------------------------------------------------------------------
-- Completing a sale is the salesperson's job
-- ------------------------------------------------------------------
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
  limit_amount numeric(14,2);
  terms integer;
  owing numeric(14,2);
begin
  select * into sale from public.van_sales where id = p_sale_id for update;
  if not found then
    raise exception 'Sale % not found', p_sale_id;
  end if;

  -- The person who made the sale, or the office. Note this is the
  -- salesperson now, not the driver: the driver has no business
  -- completing somebody else's sale.
  if sale.salesperson_id <> auth.uid()
     and auth.uid() is not null
     and not public.has_role('admin', 'senior_manager', 'manager') then
    raise exception 'Only the salesperson who made this sale or a manager may complete it'
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

-- ------------------------------------------------------------------
-- Field policies follow the crew, not the driver
-- ------------------------------------------------------------------
--
-- The policies from 0013 are dropped rather than added to. Row level
-- security policies are permissive and OR together, so leaving
-- `van_sales_driver_insert` in place beside a new rule would mean the
-- old one still let a driver open a sale - the new rule could only ever
-- widen access, never narrow it.
--
-- That is the trap this migration walked into first time round, and it
-- is worth stating plainly: to take something away you have to remove
-- the policy that grants it.

-- ---- sales -------------------------------------------------------
drop policy if exists van_sales_read on public.van_sales;
drop policy if exists van_sales_select on public.van_sales;
drop policy if exists van_sales_driver_insert on public.van_sales;
drop policy if exists van_sales_insert on public.van_sales;
drop policy if exists van_sales_driver_update on public.van_sales;
drop policy if exists van_sales_update on public.van_sales;drop policy if exists van_sales_select on public.van_sales;
create policy van_sales_select on public.van_sales
  for select using (
    org_id = public.auth_org_id()
    and (public.has_role('admin', 'senior_manager', 'manager', 'accountant', 'warehouse', 'sales_rep')
         or salesperson_id = auth.uid()
         or driver_id = auth.uid()
         or public.is_van_crew(van_id))
  );
drop policy if exists van_sales_insert on public.van_sales;
create policy van_sales_insert on public.van_sales
  for insert with check (
    org_id = public.auth_org_id()
    -- Crewed to sell, not merely aboard. A driver is on the van too,
    -- and the trigger that fills in salesperson_id would otherwise let
    -- them stamp a sale with their own name and satisfy the check below.
    and public.is_van_salesperson(van_id)
    -- And recorded by whoever made it. Recording one in somebody else's
    -- name is how a shortage gets moved onto a colleague.
    and salesperson_id = auth.uid()
  );
drop policy if exists van_sales_update on public.van_sales;
create policy van_sales_update on public.van_sales
  for update using (
    org_id = public.auth_org_id()
    and (public.has_role('admin', 'senior_manager', 'manager')
         or (salesperson_id = auth.uid() and status = 'draft'))
  );


-- ---- sale lines --------------------------------------------------
drop policy if exists van_sale_items_read on public.van_sale_items;
drop policy if exists van_sale_items_select on public.van_sale_items;
drop policy if exists van_sale_items_write on public.van_sale_items;drop policy if exists van_sale_items_select on public.van_sale_items;
create policy van_sale_items_select on public.van_sale_items
  for select using (
    org_id = public.auth_org_id()
    and exists (select 1 from public.van_sales s where s.id = van_sale_items.sale_id)
  );
drop policy if exists van_sale_items_write on public.van_sale_items;
create policy van_sale_items_write on public.van_sale_items
  for all using (
    org_id = public.auth_org_id()
    and exists (select 1 from public.van_sales s
                 where s.id = van_sale_items.sale_id
                   and (public.has_role('admin', 'senior_manager', 'manager')
                        or (s.salesperson_id = auth.uid() and s.status = 'draft')))
  ) with check (
    org_id = public.auth_org_id()
    and exists (select 1 from public.van_sales s
                 where s.id = van_sale_items.sale_id
                   and (public.has_role('admin', 'senior_manager', 'manager')
                        or (s.salesperson_id = auth.uid() and s.status = 'draft')))
  );


-- ---- returns -----------------------------------------------------
--
-- Either crew member may bring goods back: the driver has the vehicle
-- and the salesperson knows what went out.
drop policy if exists van_returns_read on public.van_returns;
drop policy if exists van_returns_select on public.van_returns;
drop policy if exists van_returns_driver on public.van_returns;
drop policy if exists van_returns_driver_update on public.van_returns;drop policy if exists van_returns_select on public.van_returns;
create policy van_returns_select on public.van_returns
  for select using (
    org_id = public.auth_org_id()
    and (public.has_role('admin', 'senior_manager', 'manager', 'accountant', 'warehouse')
         or driver_id = auth.uid()
         or salesperson_id = auth.uid()
         or public.is_van_crew(van_id))
  );
drop policy if exists van_returns_crew_insert on public.van_returns;
create policy van_returns_crew_insert on public.van_returns
  for insert with check (
    org_id = public.auth_org_id()
    and public.is_van_crew(van_id)
  );
drop policy if exists van_returns_crew_update on public.van_returns;
create policy van_returns_crew_update on public.van_returns
  for update using (
    org_id = public.auth_org_id()
    and public.is_van_crew(van_id)
    -- Once submitted it is the warehouse's to approve, not the crew's
    -- to keep editing.
    and status = 'draft'
  );


drop policy if exists van_return_items_read on public.van_return_items;
drop policy if exists van_return_items_write on public.van_return_items;drop policy if exists van_return_items_read on public.van_return_items;
create policy van_return_items_read on public.van_return_items
  for select using (
    org_id = public.auth_org_id()
    and exists (select 1 from public.van_returns r where r.id = van_return_items.return_id)
  );
drop policy if exists van_return_items_write on public.van_return_items;
create policy van_return_items_write on public.van_return_items
  for all using (
    org_id = public.auth_org_id()
    and exists (select 1 from public.van_returns r
                 where r.id = van_return_items.return_id
                   and (public.has_role('admin', 'senior_manager', 'manager', 'warehouse')
                        or (public.is_van_crew(r.van_id) and r.status = 'draft')))
  ) with check (
    org_id = public.auth_org_id()
    and exists (select 1 from public.van_returns r
                 where r.id = van_return_items.return_id
                   and (public.has_role('admin', 'senior_manager', 'manager', 'warehouse')
                        or (public.is_van_crew(r.van_id) and r.status = 'draft')))
  );


-- ---- end of day --------------------------------------------------
drop policy if exists van_reconciliations_read on public.van_reconciliations;
drop policy if exists van_reconciliations_select on public.van_reconciliations;
drop policy if exists van_reconciliations_driver on public.van_reconciliations;drop policy if exists van_reconciliations_select on public.van_reconciliations;
create policy van_reconciliations_select on public.van_reconciliations
  for select using (
    org_id = public.auth_org_id()
    and (public.has_role('admin', 'senior_manager', 'manager', 'accountant')
         or driver_id = auth.uid()
         or public.is_van_crew(van_id))
  );
drop policy if exists van_reconciliations_crew_update on public.van_reconciliations;
-- Submitting is the crew's; approving is emphatically not, and the
-- table's own constraint refuses an approver who is the driver.
create policy van_reconciliations_crew_update on public.van_reconciliations
  for update using (
    org_id = public.auth_org_id()
    and public.is_van_crew(van_id)
    and status in ('draft', 'submitted')
  );


-- ---- loads -------------------------------------------------------
drop policy if exists van_loads_read on public.van_loads;
drop policy if exists van_loads_driver_confirm on public.van_loads;drop policy if exists van_loads_read on public.van_loads;
create policy van_loads_read on public.van_loads
  for select using (
    org_id = public.auth_org_id()
    and (public.has_role('admin', 'senior_manager', 'manager', 'accountant', 'warehouse')
         or driver_id = auth.uid()
         or public.is_van_crew(van_id))
  );
drop policy if exists van_loads_driver_confirm on public.van_loads;
-- The driver signs for the goods. Not the salesperson: the vehicle and
-- what is on it are the driver's responsibility.
create policy van_loads_driver_confirm on public.van_loads
  for update using (
    org_id = public.auth_org_id()
    and driver_id = auth.uid()
    and status in ('draft', 'loaded')
  );


-- ---- customers ---------------------------------------------------
--
-- A salesperson meets new customers at the roadside and has to be able
-- to record one before selling to them. A driver does not: they are not
-- the one opening an account.
drop policy if exists customers_write on public.customers;drop policy if exists customers_write on public.customers;
create policy customers_write on public.customers
  for all using (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'sales_rep', 'salesperson')
  ) with check (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'sales_rep', 'salesperson')
  );


-- ------------------------------------------------------------------
-- What a round took, by whom
-- ------------------------------------------------------------------
create or replace view public.salesperson_performance
with (security_invoker = on) as
  select
    s.org_id,
    s.salesperson_id,
    p.full_name as salesperson_name,
    count(*)                                                      as sale_count,
    coalesce(sum(s.total), 0)                                     as revenue,
    coalesce(sum(s.total) filter (where s.sale_type = 'cash'), 0)  as cash_sales,
    coalesce(sum(s.total) filter (where s.sale_type = 'credit'), 0) as credit_sales,
    coalesce(sum(s.balance), 0)                                   as outstanding,
    max(s.sold_at)                                                as last_sale_at
  from public.van_sales s
  join public.profiles p on p.id = s.salesperson_id
  where s.status = 'completed'
  group by s.org_id, s.salesperson_id, p.full_name;

comment on view public.salesperson_performance is
  'What each salesperson has sold. Attributed to whoever made the sale, '
  'not to whoever was driving.';


-- ====================================================================
-- 0034_mobile_money_provider.sql
-- ====================================================================
-- ===================================================================
-- 0033  Which network the mobile money came from
-- ===================================================================
--
-- A mobile money payment records a reference and nothing else. In Ghana
-- that reference is only meaningful alongside the network that issued
-- it: MTN, Telecel and AirtelTigo each number their transactions
-- independently, so "0071234567" identifies a payment only once you know
-- whose system it came out of.
--
-- Without the network, reconciling a day's takings against a merchant
-- statement means guessing which statement to look in. With it, the
-- match is exact.
--
-- The list is a table rather than an enum. Networks merge and rebrand -
-- Vodafone Ghana became Telecel in 2023 - and a business should be able
-- to add one without a migration.

create table if not exists public.momo_providers (
  code       text primary key,
  name       text not null,
  is_active  boolean not null default true,
  sort_order integer not null default 100,

  constraint momo_providers_code_lower check (code = lower(code)),
  constraint momo_providers_name_not_blank check (length(trim(name)) > 0)
);

comment on table public.momo_providers is
  'Mobile money networks. A table rather than an enum because networks '
  'rebrand and a business should not need a migration to follow them.';

insert into public.momo_providers (code, name, sort_order) values
  ('mtn',        'MTN Mobile Money', 10),
  ('telecel',    'Telecel Cash',     20),
  ('airteltigo', 'AirtelTigo Money', 30),
  ('other',      'Other',            90)
on conflict (code) do nothing;

alter table public.momo_providers enable row level security;

-- A reference list, readable by anybody signed in. Nothing about it is
-- specific to one organization.
drop policy if exists momo_providers_read on public.momo_providers;drop policy if exists momo_providers_read on public.momo_providers;
create policy momo_providers_read on public.momo_providers
  for select using (auth.uid() is not null);


revoke all on public.momo_providers from anon, authenticated;
grant select on public.momo_providers to authenticated;
grant all on public.momo_providers to service_role;

-- ------------------------------------------------------------------
-- Carried on the payment itself
-- ------------------------------------------------------------------
alter table public.van_sale_payments
  add column if not exists provider text references public.momo_providers(code);

alter table public.payments
  add column if not exists provider text references public.momo_providers(code);

comment on column public.van_sale_payments.provider is
  'The mobile money network, where the method is mobile_money. A '
  'reference without the network it was issued by cannot be matched '
  'against a statement.';

-- A network on a cash payment is meaningless, and its absence on mobile
-- money is a reconciliation that cannot be done. Both are refused.
alter table public.van_sale_payments
  drop constraint if exists van_sale_payments_provider_matches_method;
alter table public.van_sale_payments
  add constraint van_sale_payments_provider_matches_method
  check (provider is null or method = 'mobile_money');

alter table public.payments
  drop constraint if exists payments_provider_matches_method;
alter table public.payments
  add constraint payments_provider_matches_method
  check (provider is null or method = 'mobile_money');

create index if not exists van_sale_payments_provider_idx
  on public.van_sale_payments (org_id, provider, created_at desc)
  where provider is not null;

-- ------------------------------------------------------------------
-- Recording it
-- ------------------------------------------------------------------
create or replace function public.record_sale_payments(
  p_sale_id  uuid,
  p_payments jsonb
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  sale     public.van_sales;
  entry    jsonb;
  amount   numeric(14,2);
  method   public.payment_method;
  provider text;
  total    numeric(14,2) := 0;
begin
  perform public.require_role(
    'admin', 'senior_manager', 'manager', 'accountant', 'sales_rep', 'salesperson', 'driver');

  select * into sale from public.van_sales where id = p_sale_id for update;
  if not found then
    raise exception 'Sale % not found', p_sale_id;
  end if;

  if sale.status = 'completed' then
    raise exception 'Sale % is already completed', sale.sale_number;
  end if;

  if jsonb_typeof(p_payments) <> 'array' then
    raise exception 'Payments must be a list';
  end if;

  -- Cleared first so a retry replaces the breakdown rather than adding
  -- to it. The sale is still a draft, so nothing has been reported on it.
  delete from public.van_sale_payments where sale_id = p_sale_id;

  for entry in select * from jsonb_array_elements(p_payments) loop
    amount   := (entry ->> 'amount')::numeric;
    method   := (entry ->> 'method')::public.payment_method;
    provider := nullif(entry ->> 'provider', '');

    if amount is null or amount <= 0 then
      raise exception 'Every payment needs an amount above zero';
    end if;

    if provider is not null
       and not exists (select 1 from public.momo_providers
                        where code = provider and is_active) then
      raise exception 'Unknown mobile money network: %', provider;
    end if;

    insert into public.van_sale_payments
      (org_id, sale_id, method, amount, reference, provider)
    values
      (sale.org_id, p_sale_id, method, amount,
       nullif(entry ->> 'reference', ''),
       case when method = 'mobile_money' then provider end);

    total := total + amount;
  end loop;

  -- Nobody hands over more than the sale is worth. A customer paying
  -- extra is a payment on account, not part of this sale.
  if total > sale.total then
    raise exception 'Payment of % is more than the sale total of %', total, sale.total;
  end if;

  -- A cash sale is one that was paid for. Short payment is what credit
  -- is for, and calling it cash leaves a balance nobody is chasing.
  if sale.sale_type = 'cash' and total < sale.total then
    raise exception
      'This is a cash sale of % but only % was paid. Take the balance, or record it as a credit sale.',
      sale.total, total;
  end if;

  return total;
end;
$$;

revoke all on function public.record_sale_payments(uuid, jsonb) from public, anon;
grant execute on function public.record_sale_payments(uuid, jsonb) to authenticated, service_role;

-- ------------------------------------------------------------------
-- Reconciling mobile money
-- ------------------------------------------------------------------
create or replace view public.momo_reconciliation
with (security_invoker = on) as
  select
    p.org_id,
    p.created_at::date            as taken_on,
    coalesce(p.provider, 'other') as provider,
    coalesce(m.name, 'Unknown')   as provider_name,
    s.van_id,
    v.code                        as van_code,
    s.salesperson_id,
    sp.full_name                  as salesperson_name,
    count(*)                      as payment_count,
    sum(p.amount)                 as total_amount,
    -- A payment nobody can match to a statement. Not an error on its
    -- own, but it is the pile somebody has to work through.
    count(*) filter (where p.reference is null or trim(p.reference) = '') as unreferenced_count,
    sum(p.amount) filter (where p.reference is null or trim(p.reference) = '')
                                  as unreferenced_amount
  from public.van_sale_payments p
  join public.van_sales s on s.id = p.sale_id
  left join public.momo_providers m on m.code = p.provider
  left join public.vans v on v.id = s.van_id
  left join public.profiles sp on sp.id = s.salesperson_id
  where p.method = 'mobile_money'
    and s.status = 'completed'
  group by p.org_id, p.created_at::date, p.provider, m.name,
           s.van_id, v.code, s.salesperson_id, sp.full_name;

comment on view public.momo_reconciliation is
  'Mobile money taken, by day, network, van and salesperson - the four '
  'ways somebody asks about it. Unreferenced payments are counted apart '
  'because those are the ones that cannot be matched to a statement.';


-- ====================================================================
-- 0035_ledger_tenant_purge.sql
-- ====================================================================
-- ===================================================================
-- 0035  A tenant can actually be removed
-- ===================================================================
--
-- `stock_movements` refuses every UPDATE and every DELETE, from anybody,
-- with no exception. That is right for a ledger: stock is derived from
-- it, and a correction is a reversing entry rather than a rewrite.
--
-- It also means a tenant cannot be removed. The demonstration cleanup
-- deletes an organization's rows table by table, reaches the ledger, and
-- is refused - so the movements stay, the organization cannot be deleted
-- because they still reference it, and the cleanup leaves the database
-- half-emptied.
--
-- That was found by testing the cleanup rather than by reading it. The
-- script logged the refusal and carried on, so the failure was visible
-- only in the rows left behind.
--
-- Migration 0021 met exactly this problem with `audit_log` and settled
-- it: refuse every rewrite, permit a delete from a trusted server-side
-- role, because removing a tenant and honouring a retention policy both
-- need one. This applies the same rule to the ledger, for the same
-- reason and with the same limits.
--
-- What does not change:
--   * Every UPDATE is still refused, from everybody, always. Stock is
--     never rewritten.
--   * `authenticated` has no DELETE privilege on this table to begin
--     with, so nothing changes for a signed-in user.
--   * Only a trusted context - the service role, or a direct database
--     connection such as the SQL editor - can delete, and such a caller
--     could already read and write every row in every table.

create or replace function public.block_movement_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and public.is_trusted_context() then
    -- Removing a tenant. Never reachable from the Data API by a
    -- signed-in user, and never reachable at all for an UPDATE.
    return old;
  end if;

  raise exception 'stock_movements is append-only; post a reversing movement instead'
    using errcode = '42501';
end;
$$;

comment on function public.block_movement_mutation is
  'Refuses every UPDATE, and every DELETE except from a trusted '
  'server-side role. Stock is never rewritten; a tenant can be removed '
  'wholesale.';

-- The same for van inventory movements, which share the ledger, and for
-- product batches, which are drawn down rather than edited.
--
-- Batches have no such trigger today, so nothing to relax there. This
-- comment is here so the next person looking for one knows why.

-- ------------------------------------------------------------------
-- Proving the ledger is still closed to ordinary callers
-- ------------------------------------------------------------------
--
-- Left as a comment rather than a check: `authenticated` holds no
-- DELETE on this table, and 0015 revoked it explicitly. The grant is
-- verified by VERIFY_DATABASE.sql and by tests/db/test_stock.js.


-- ====================================================================
-- 0036_salesperson_reaches_everything.sql
-- ====================================================================
-- ===================================================================
-- 0036  The salesperson role reaches what it needs to
-- ===================================================================
--
-- Adding a role to the enum does not add it to the role lists already
-- written into functions. Five of them still name 'driver' and
-- 'sales_rep' and do not know the salesperson exists, so the person who
-- actually sells was refused by the very functions selling depends on.
--
-- Found by walking a whole round rather than by testing one rule at a
-- time: every unit-level test passed, because each used the old roles.
-- The break only appeared when a salesperson tried to complete a credit
-- sale and the invoice trigger refused them.
--
-- What was broken:
--
--   issue_invoice_for_sale   a credit sale by a salesperson failed at
--                            the invoice trigger. Credit selling did
--                            not work at all.
--   sync_submit              an offline sale could not be uploaded.
--   sync_bootstrap           the device could not fetch its snapshot,
--                            so offline selling never started.
--   record_credit_payment    a salesperson could not take a collection.
--   can_access_product       a salesperson was not scoped to their van
--                            and saw the whole catalogue instead.
--
-- The last one is the reason this is worth stating carefully. It is not
-- a cost leak - cost is withheld by column grants regardless - but a
-- salesperson could see products that were never on their van, and would
-- have been offered lines they could not sell.

-- ------------------------------------------------------------------
-- What a person may see in the catalogue
-- ------------------------------------------------------------------
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
      select 1 from public.manager_category_scopes s
      join public.products p on p.category_id = s.category_id
      where p.id = target and s.profile_id = auth.uid()
    )
    -- Anyone crewed on a van sees what is on that van, whichever job
    -- they do. A salesperson needs it to sell; a driver needs it to
    -- know what they are carrying.
    when public.has_role('driver', 'salesperson') then exists (
      select 1 from public.van_inventory vi
      where vi.product_id = target and vi.van_id = public.my_van_id()
    )
    when public.auth_role() is null then false
    else true
  end
$$;

comment on function public.can_access_product is
  'Whether this caller may see this product. Van crew are scoped to '
  'what is on their van - an empty van is not an empty catalogue, and '
  'the screens say so.';

-- ------------------------------------------------------------------
-- Raising the invoice for a credit sale
-- ------------------------------------------------------------------
--
-- Reproduced from 0026 with 'salesperson' added and nothing else
-- changed. This is the one that broke credit selling outright.
create or replace function public.issue_invoice_for_sale(p_sale_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  sale    public.van_sales;
  cust    public.customers;
  inv     public.invoices;
  inv_id  uuid;
  terms   integer;
begin
  perform public.require_role(
    'admin', 'senior_manager', 'manager', 'accountant',
    'sales_rep', 'salesperson', 'driver');

  select * into sale from public.van_sales where id = p_sale_id;
  if not found then
    raise exception 'Sale % not found', p_sale_id;
  end if;

  if auth.uid() is not null and sale.org_id is distinct from public.auth_org_id() then
    raise exception 'Sale % not found', p_sale_id using errcode = '42501';
  end if;

  if sale.sale_type <> 'credit' then
    return null;
  end if;

  select * into inv from public.invoices where van_sale_id = p_sale_id;
  if found then
    return inv;
  end if;

  select * into cust from public.customers where id = sale.customer_id;
  terms := coalesce(cust.payment_terms_days, 0);

  -- Raised for the whole value, with the deposit written as a payment
  -- below rather than into amount_paid: that column is recalculated
  -- from the payments table, so a figure put straight into it survives
  -- only until the first collection.
  insert into public.invoices (
    org_id, van_sale_id, customer_id, status,
    issue_date, due_date,
    subtotal, tax_total, total, created_by
  ) values (
    sale.org_id, sale.id, sale.customer_id, 'issued',
    sale.sold_at::date,
    coalesce(sale.due_date, sale.sold_at::date + terms),
    sale.subtotal, sale.tax_total, sale.total,
    -- Whoever sold it. Before the crew model this was the driver,
    -- because there was nobody else to name.
    coalesce(sale.salesperson_id, sale.driver_id)
  )
  returning * into inv;
  inv_id := inv.id;

  if sale.amount_paid > 0 then
    insert into public.payments (org_id, invoice_id, amount, method, reference, received_by, paid_at)
    select sale.org_id, inv_id, sp.amount, sp.method, sp.reference,
           coalesce(sale.salesperson_id, sale.driver_id), sale.sold_at
      from public.van_sale_payments sp
     where sp.sale_id = sale.id;

    if not found then
      insert into public.payments (org_id, invoice_id, amount, method, received_by, paid_at)
      values (sale.org_id, inv_id, sale.amount_paid, 'cash',
              coalesce(sale.salesperson_id, sale.driver_id), sale.sold_at);
    end if;

    select * into inv from public.invoices where id = inv_id;
  end if;

  return inv;
end;
$$;

revoke all on function public.issue_invoice_for_sale(uuid) from public, anon;
grant execute on function public.issue_invoice_for_sale(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- Taking a collection
-- ------------------------------------------------------------------
--
-- Only the role list changes. The allocation logic is untouched.
do $collections$
declare
  body text;
begin
  select pg_get_functiondef(p.oid) into body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_credit_payment'
   limit 1;

  if body is null then
    raise exception 'record_credit_payment is missing; run UPGRADE_0026 first';
  end if;

  -- Idempotent: if the role is already there this rewrites the function
  -- with an identical body.
  body := replace(
    body,
    $old$'admin', 'senior_manager', 'manager', 'accountant', 'driver'$old$,
    $new$'admin', 'senior_manager', 'manager', 'accountant', 'salesperson', 'driver'$new$);

  execute body;
end
$collections$;

-- ------------------------------------------------------------------
-- Offline sync
-- ------------------------------------------------------------------
--
-- Both of these are long functions whose logic is settled. Only the
-- role list is wrong, so it is rewritten in place rather than the whole
-- body being reproduced here - a copy would be one more place for the
-- two to drift apart.
do $sync$
declare
  target text;
  body   text;
begin
  foreach target in array array['sync_submit', 'sync_bootstrap']
  loop
    select pg_get_functiondef(p.oid) into body
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = target
     limit 1;

    if body is null then
      raise notice '% is not on this database; skipping', target;
      continue;
    end if;

    body := replace(
      body,
      $old$'admin', 'senior_manager', 'manager', 'accountant', 'sales_rep', 'driver'$old$,
      $new$'admin', 'senior_manager', 'manager', 'accountant', 'sales_rep', 'salesperson', 'driver'$new$);

    execute body;
  end loop;
end
$sync$;

-- ------------------------------------------------------------------
-- Nothing else should still be unaware of the role
-- ------------------------------------------------------------------
--
-- Fails the migration rather than leaving another one to be found in
-- the field. If this raises, the named function has a role list that
-- mentions the field roles and not the salesperson.
do $audit$
declare
  offender text;
begin
  select string_agg(p.proname, ', ') into offender
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
     and p.proname not in ('has_role', 'require_role')
     and pg_get_function_identity_arguments(p.oid) not like '%aggregate%'
     -- The whole call has to be captured, not its alternation groups:
     -- regexp_matches returns capture groups when there are any, so a
     -- pattern that groups only the function name would never see the
     -- role list it is meant to be checking.
     and exists (
       select 1 from regexp_matches(
         pg_get_functiondef(p.oid),
         '((?:require_role|has_role)\([^)]*''(?:driver|sales_rep)''[^)]*\))', 'g') as m(x)
       where m.x[1] not like '%salesperson%'
     );

  if offender is not null then
    raise exception
      'These functions still do not know about the salesperson role: %. '
      'Add it, or this role will be refused somewhere in the field.', offender;
  end if;
end
$audit$;


-- ====================================================================
-- 0037_product_images.sql
-- ====================================================================
-- ===================================================================
-- 0037  A picture of what is being sold
-- ===================================================================
--
-- A salesperson standing outside a shop scrolls a list of names. Half
-- the catalogue is "500ml", "1L", "Crate of 24" of things that look
-- alike in text and nothing alike on a shelf, and the wrong line picked
-- in a hurry is a delivery argument later.
--
-- So products get a photograph.
--
-- THE BUCKET IS PUBLIC, and that is deliberate rather than careless.
-- Supplier documents are private because they carry purchase prices; a
-- product photograph is the thing the customer is holding. Two reasons
-- it has to be public rather than served through signed URLs:
--
--   A signed URL expires. The driver's phone caches the round before it
--   leaves the yard and may not see a network again for hours, so an
--   expiring image link means a blank catalogue in the field - exactly
--   where the picture is worth having.
--
--   The service worker caches by URL. A signed URL is different every
--   time it is minted, so nothing would ever hit the cache.
--
-- Nothing confidential goes in here. Writing is still restricted to the
-- roles that may edit products; only reading is open.

-- ------------------------------------------------------------------
-- The bucket
-- ------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images', 'product-images', true,
  -- 5 MB. A product photograph is a few hundred kilobytes; anything at
  -- five megabytes is an unresized camera original, and it has to travel
  -- down a phone connection in a van.
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ------------------------------------------------------------------
-- Where the picture lives
-- ------------------------------------------------------------------
alter table public.products
  add column if not exists image_path text;

comment on column public.products.image_path is
  'Path in the public product-images bucket. Public on purpose: a phone '
  'offline in a van cannot fetch a signed URL, and a photograph of '
  'something on a shelf is not confidential.';

-- ------------------------------------------------------------------
-- Who may change one
-- ------------------------------------------------------------------
--
-- Reading is open, because the bucket is public and the pictures are of
-- things customers are handed. Writing and removing belong to whoever
-- may edit the product itself.

drop policy if exists product_images_read on storage.objects;drop policy if exists product_images_read on storage.objects;
create policy product_images_read on storage.objects
  for select using (bucket_id = 'product-images');


drop policy if exists product_images_write on storage.objects;drop policy if exists product_images_write on storage.objects;
create policy product_images_write on storage.objects
  for insert with check (
    bucket_id = 'product-images'
    and public.has_role('admin', 'senior_manager', 'manager')
  );


drop policy if exists product_images_update on storage.objects;drop policy if exists product_images_update on storage.objects;
create policy product_images_update on storage.objects
  for update using (
    bucket_id = 'product-images'
    and public.has_role('admin', 'senior_manager', 'manager')
  );


drop policy if exists product_images_delete on storage.objects;drop policy if exists product_images_delete on storage.objects;
create policy product_images_delete on storage.objects
  for delete using (
    bucket_id = 'product-images'
    and public.has_role('admin', 'senior_manager', 'manager')
  );


-- ------------------------------------------------------------------
-- The picture travels with the round
-- ------------------------------------------------------------------
--
-- sync_bootstrap builds the snapshot a phone caches before it leaves.
-- The image path has to be in it, or the field catalogue is text again
-- the moment the signal goes.
--
-- Rewritten in place rather than reproduced: the function is long, its
-- logic is settled, and a copy here would be one more place for the two
-- to drift apart.
do $bootstrap$
declare
  body text;
begin
  select pg_get_functiondef(p.oid) into body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'sync_bootstrap'
   limit 1;

  if body is null then
    raise notice 'sync_bootstrap is not on this database; skipping';
    return;
  end if;

  -- The snapshot's price block already joins products, so the picture
  -- rides along with the figure the till needs anyway.
  --
  -- Idempotent: if the column is already selected this does nothing.
  if position('image_path' in body) = 0 then
    body := replace(
      body,
      $anchor$'tax_rate', p.tax_rate$anchor$,
      $with$'tax_rate', p.tax_rate, 'image_path', p.image_path$with$);

    if position('image_path' in body) = 0 then
      raise exception
        'sync_bootstrap does not look the way this migration expects, so the '
        'product image would silently not reach the field. Update 0037.';
    end if;

    execute body;
  end if;
end
$bootstrap$;