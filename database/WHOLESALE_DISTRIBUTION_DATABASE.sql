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
  wanted text[] := array['admin', 'manager', 'sales_rep', 'warehouse', 'accountant', 'driver', 'senior_manager'];
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'user_role'
  ) then
    create type public.user_role as enum ('admin', 'manager', 'sales_rep', 'warehouse', 'accountant', 'driver', 'senior_manager');
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