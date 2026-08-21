-- =====================================================================
-- 0001_foundation.sql
-- Enums, profile/role model, and shared helper functions.
-- Run these migrations in filename order in the Supabase SQL editor.
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ---------------------------------------------------------------- enums
create type public.user_role as enum (
  'admin', 'manager', 'sales_rep', 'warehouse', 'accountant'
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
  'transfer_in', 'transfer_out', 'customer_return', 'supplier_return'
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
