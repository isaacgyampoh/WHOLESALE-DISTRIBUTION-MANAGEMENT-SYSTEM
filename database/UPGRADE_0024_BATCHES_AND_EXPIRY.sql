-- ====================================================================
-- UPGRADE 0024 - batches and expiry
-- ====================================================================
--
-- For a database installed before migration 0024.
-- Run it in the Supabase SQL editor.
--
-- GENERATED FILE - do not edit by hand.
-- Source: supabase/migrations/0024_batches_and_expiry.sql
-- Regenerate: node database/build.mjs
--
-- Safe to run twice. Every object is created behind an existence check,
-- so a second run reports success and changes nothing. An enum that
-- already exists is compared against what this script expects and the
-- script stops with both lists if they differ, rather than altering a
-- type other code may already depend on.
--
-- WHAT IT ADDS
--
-- The schema had no idea when anything went off. A distributor moving
-- food, drink and toiletries carries stock that expires, and the only
-- record of it was whatever somebody remembered.
--
--   product_batches          a delivery of one product, with the expiry
--                            it carries. Created at receiving, which is
--                            the only moment the date is known.
--   receive_purchase_batch() receiving, with the batch and expiry off
--                            the delivery note. Refuses a delivery that
--                            is already out of date.
--   batch_expiry_status      every batch with how long it has left.
--   expiry_summary           counts for the dashboard.
--   consume_batches()        draws stock down earliest expiry first.
--
-- and it replaces dispatch_van_load() so that no van leaves the yard
-- carrying stock that has expired.
--
-- NOTHING CHANGES BEHAVIOUR UNTIL YOU TURN IT ON. Tracking is per
-- product and off by default: a crate does not expire and is not made
-- to carry a date. Set it on the product screen.
--
-- AFTER RUNNING IT, redeploy the application, then run npm run demo:seed
-- again if you want the demonstration's expiry examples.

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
-- Confirm it took. Every row should read PASS.
-- ====================================================================
select 'product_batches table' as check,
       case when to_regclass('public.product_batches') is not null
            then 'PASS' else 'FAIL' end as result
union all
select 'products carry tracking flags',
       case when (select count(*) from information_schema.columns
                   where table_name = 'products'
                     and column_name in ('track_batches','track_expiry','shelf_life_days')) = 3
            then 'PASS' else 'FAIL' end
union all
select 'tracking is off by default',
       case when (select column_default from information_schema.columns
                   where table_name = 'products' and column_name = 'track_expiry') like 'false%'
            then 'PASS' else 'FAIL' end
union all
select 'expiry needs a batch to live on',
       case when exists (select 1 from pg_constraint
                          where conname = 'products_expiry_needs_batches')
            then 'PASS' else 'FAIL' end
union all
select 'batch_expiry_status view',
       case when to_regclass('public.batch_expiry_status') is not null
            then 'PASS' else 'FAIL' end
union all
select 'expiry_summary view',
       case when to_regclass('public.expiry_summary') is not null
            then 'PASS' else 'FAIL' end
union all
select 'receive_purchase_batch function',
       case when exists (select 1 from pg_proc p
                           join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'receive_purchase_batch')
            then 'PASS' else 'FAIL' end
union all
select 'dispatch refuses expired stock',
       case when (select pg_get_functiondef(p.oid) from pg_proc p
                    join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'dispatch_van_load')
                 like '%expired on%'
            then 'PASS' else 'FAIL' end
union all
select 'row level security on batches',
       case when (select relrowsecurity from pg_class
                   where oid = 'public.product_batches'::regclass)
            then 'PASS' else 'FAIL' end
union all
select 'the warning period is configurable',
       case when exists (select 1 from information_schema.columns
                          where table_name = 'organizations'
                            and column_name = 'expiry_warning_days')
            then 'PASS' else 'FAIL' end;
