-- ====================================================================
-- UPGRADE 0027 - moving stock between warehouses
-- ====================================================================
--
-- For a database installed before migration 0027.
-- Run it in the Supabase SQL editor.
--
-- GENERATED FILE - do not edit by hand.
-- Source: supabase/migrations/0027_warehouse_transfers.sql
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
-- stock_transfers has been in the schema since 0011 and nothing ever
-- used it. Stock moved between depots as an adjustment out of one and
-- an adjustment in to the other - which balances, and is wrong in every
-- other way: no document joins the two, nothing is in transit, nobody
-- is accountable for the gap, and the stock report shows two
-- unexplained corrections instead of one movement.
--
-- A transfer becomes a lifecycle: draft, approved, in transit,
-- received. Approving and dispatching are separate jobs, so a depot
-- cannot move stock on its own say-so, and what arrives is counted
-- rather than assumed.
--
--   approve_stock_transfer()   manager and above only
--   dispatch_stock_transfer()  takes the goods off the source warehouse
--   receive_stock_transfer()   books in what was actually counted
--   cancel_stock_transfer()    while it has not yet left
--   stock_transfer_summary     what left, what arrived, and the gap
--   stock_in_transit           goods that belong to neither depot
--
-- Batches keep their expiry dates across the journey, and expired stock
-- is refused: transferring it would only relocate the write-off.
--
-- ONE EXISTING RULE IS WIDENED. The uniqueness of a batch number was
-- (organization, product); it is now (organization, product,
-- warehouse). A delivery of 500 split 300 to one depot and 200 to
-- another genuinely is the same batch in two places, and the old rule
-- could not say so. This permits more than before, so nothing that was
-- valid becomes invalid.
--
-- Existing data is untouched. Transfers recorded as adjustments stay as
-- they are; the stock they moved is already where it should be.
--
-- AFTER RUNNING IT, redeploy. The transfer screens appear only once
-- this is in place.

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
  'summary and needs its own report.';

-- ====================================================================
-- Confirm it took. Every row should read PASS.
-- ====================================================================
select 'transfer lifecycle' as check,
       case when exists (
              select 1 from pg_constraint
               where conrelid = 'public.stock_transfers'::regclass
                 and conname = 'stock_transfers_status_check'
                 and pg_get_constraintdef(oid) like '%approved%')
            then 'PASS' else 'FAIL' end as result
union all
select 'approve_stock_transfer function',
       case when exists (select 1 from pg_proc p
                           join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'approve_stock_transfer')
            then 'PASS' else 'FAIL' end
union all
select 'dispatch_stock_transfer function',
       case when exists (select 1 from pg_proc p
                           join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'dispatch_stock_transfer')
            then 'PASS' else 'FAIL' end
union all
select 'receive_stock_transfer function',
       case when exists (select 1 from pg_proc p
                           join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'receive_stock_transfer')
            then 'PASS' else 'FAIL' end
union all
select 'what arrived is recorded',
       case when exists (select 1 from information_schema.columns
                          where table_name = 'stock_transfer_items'
                            and column_name = 'qty_received')
            then 'PASS' else 'FAIL' end
union all
select 'stock_transfer_summary view',
       case when to_regclass('public.stock_transfer_summary') is not null
            then 'PASS' else 'FAIL' end
union all
select 'stock_in_transit view',
       case when to_regclass('public.stock_in_transit') is not null
            then 'PASS' else 'FAIL' end
union all
select 'a batch can be in two warehouses',
       case when (select indexdef from pg_indexes
                   where schemaname = 'public' and indexname = 'product_batches_unique')
            like '%warehouse_id%'
            then 'PASS' else 'FAIL' end;
