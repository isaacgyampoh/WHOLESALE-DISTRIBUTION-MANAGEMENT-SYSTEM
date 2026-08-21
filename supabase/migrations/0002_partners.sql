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
