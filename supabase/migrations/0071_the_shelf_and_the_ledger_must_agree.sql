-- ===================================================================
-- 0071  The shelf and the ledger must agree
-- ===================================================================
--
-- inventory is not a second record of stock. It is the running total of
-- stock_movements, folded in by a trigger, and the two are supposed to
-- be the same fact seen twice. If they ever disagree, one of them is
-- lying and there is no way to tell which from the inside.
--
-- They do disagree, on one product. AHOUFE holds thirty-nine units
-- across the warehouses that no movement accounts for: no receipt, no
-- opening stock, no adjustment, nothing in the audit log. The stock is
-- on the screen and the ledger cannot say how it got there.
--
-- WHY THIS IS A VIEW AND NOT A REPAIR
--
-- Nothing here corrects it, because nothing here knows which side is
-- right. Writing a movement to explain the thirty-nine would invent a
-- delivery that may never have happened; deleting the stock would write
-- off units that may be sitting on the shelf. Both are guesses dressed
-- as bookkeeping, and the business already owns the instrument for
-- settling it: somebody counts the shelf, and the count writes the
-- difference as a stocktake with a reason and a name against it.
--
-- What was missing is that nobody could see there was anything to
-- settle. This drift was found by hand, comparing two sums that nothing
-- in the application had ever compared. A system that keeps a ledger
-- should be the thing that notices its ledger has stopped adding up.
--
-- The same shape as unsellable_pieces in 0063: a view that names a
-- condition nobody can see, so the office finds out before a customer
-- or a stocktake does.
--
-- Read through products_priced rather than products. Cost is masked
-- there per caller, and a security_invoker view may only name columns
-- its caller may read - the lesson of 0038 and 0046, which each took a
-- screen down by naming one column too many.
create or replace view public.stock_ledger_variances
with (security_invoker = on) as
  with ledger as (
    select
      m.product_id,
      m.warehouse_id,
      sum(public.movement_direction(m.type) * m.quantity)::bigint          as units,
      sum(public.movement_direction(m.type) * coalesce(m.pieces, 0))::bigint as pieces
    from public.stock_movements m
    where m.warehouse_id is not null
    group by m.product_id, m.warehouse_id
  ),
  -- Both sides, not just the ledger's. A product holding stock that has
  -- no movements at all never appears in the ledger, so a comparison
  -- driven from the ledger alone cannot see it - which is exactly the
  -- blind spot that let this one sit unnoticed.
  pairs as (
    select product_id, warehouse_id from public.inventory
    union
    select product_id, warehouse_id from ledger
  )
  select
    p.org_id,
    x.product_id,
    x.warehouse_id,
    p.sku,
    p.name,
    w.name                                       as warehouse_name,
    coalesce(i.qty_on_hand, 0)                   as inventory_units,
    coalesce(l.units, 0)                         as ledger_units,
    coalesce(i.qty_on_hand, 0) - coalesce(l.units, 0)   as unexplained_units,
    coalesce(i.qty_pieces, 0)                    as inventory_pieces,
    coalesce(l.pieces, 0)                        as ledger_pieces,
    coalesce(i.qty_pieces, 0) - coalesce(l.pieces, 0)   as unexplained_pieces
  from pairs x
    join public.products_priced p on p.id = x.product_id
    join public.warehouses w on w.id = x.warehouse_id
    left join public.inventory i
      on i.product_id = x.product_id and i.warehouse_id = x.warehouse_id
    left join ledger l
      on l.product_id = x.product_id and l.warehouse_id = x.warehouse_id
  where coalesce(i.qty_on_hand, 0) <> coalesce(l.units, 0)
     or coalesce(i.qty_pieces, 0)  <> coalesce(l.pieces, 0);

comment on view public.stock_ledger_variances is
  'Where the stock on hand and the sum of its movements disagree. '
  'inventory is the running total of stock_movements, so a row here '
  'means one of the two is wrong and the ledger cannot say which. '
  'Settled by counting the shelf, which writes the difference as a '
  'stocktake - never by a correction invented here.';

grant select on public.stock_ledger_variances to authenticated;
