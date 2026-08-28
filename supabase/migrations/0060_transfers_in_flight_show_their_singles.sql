-- ===================================================================
-- 0060  Transfers in flight show their singles
-- ===================================================================
--
-- The two views over warehouse transfers. stock_transfer_items carries
-- pieces from 0057 and both of these still report full units, so a
-- transfer of loose singles between depots is in the ledger and on no
-- screen: the transfers list shows nothing sent, and the in-transit
-- report cannot see the stock it exists to chase.
--
-- New columns on the end, as always: CREATE OR REPLACE VIEW may add but
-- not reorder, and dropping either would cascade into what reads it.

create or replace view public.stock_in_transit as
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
    current_date - t.dispatched_at::date as days_in_transit,
    coalesce(i.pieces, 0) as pieces,
    p.unit_of_measure
  from public.stock_transfers t
    join public.stock_transfer_items i on i.transfer_id = t.id
    join public.products p on p.id = i.product_id
    join public.warehouses src on src.id = t.from_warehouse_id
    join public.warehouses dst on dst.id = t.to_warehouse_id
  where t.status = 'in_transit'::text;

comment on view public.stock_in_transit is
  'What has left one warehouse and not yet arrived at another, in full '
  'units and loose pieces. The two are never added together.';

create or replace view public.stock_transfer_summary as
  select
    t.id,
    t.org_id,
    t.transfer_number,
    t.status,
    t.transfer_date,
    t.from_warehouse_id,
    src.name as from_warehouse,
    t.to_warehouse_id,
    dst.name as to_warehouse,
    t.notes,
    t.approved_at,
    t.dispatched_at,
    t.received_at,
    approver.full_name as approved_by_name,
    receiver.full_name as received_by_name,
    count(i.id) as line_count,
    coalesce(sum(i.quantity), 0::bigint) as qty_sent,
    coalesce(sum(i.qty_received), 0::bigint) as qty_received,
    coalesce(sum(i.quantity), 0::bigint)
      - coalesce(sum(coalesce(i.qty_received, i.quantity)), 0::bigint) as qty_short,
    -- The same three figures for the loose half, kept apart from them.
    -- A transfer short of three singles and no cartons has to read as
    -- short of something.
    coalesce(sum(i.pieces), 0::bigint) as pieces_sent,
    coalesce(sum(i.qty_received_pieces), 0::bigint) as pieces_received,
    coalesce(sum(i.pieces), 0::bigint)
      - coalesce(sum(coalesce(i.qty_received_pieces, i.pieces)), 0::bigint) as pieces_short
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
