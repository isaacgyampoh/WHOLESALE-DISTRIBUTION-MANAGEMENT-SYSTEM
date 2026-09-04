-- ===================================================================
-- 0063  Stock that cannot be sold
-- ===================================================================
--
-- Since 0062 a loose piece with no price of its own is refused rather
-- than sold at a guessed rate. That is right, and it has a consequence
-- nobody can currently see: a product can be holding singles that no
-- salesperson is able to sell, and the first anyone hears of it is a
-- refusal at a customer's counter.
--
-- It is already happening. One product holds twelve loose pieces with
-- no piece price - twelve pieces of real stock that cannot leave the
-- building, and nothing anywhere says so.
--
-- This is the same shape of fault as staff who are active but have no
-- PIN: a setting that makes an ordinary operation fail, invisible until
-- somebody tries it. That one has an alert on the dashboard, and so
-- should this.
--
-- Read through products_priced rather than products. Cost is masked
-- there per caller, and a security_invoker view may only name columns
-- its caller may read - the lesson of 0038 and 0046, which each took a
-- screen down by naming one column too many.
create or replace view public.unsellable_pieces
with (security_invoker = on) as
  select
    p.org_id,
    p.id as product_id,
    p.sku,
    p.name,
    p.unit_of_measure,
    p.units_per_case,
    coalesce(w.pieces, 0) + coalesce(v.pieces, 0) as loose_pieces
  from public.products_priced p
    left join (
      select product_id, sum(qty_pieces) as pieces
        from public.inventory group by product_id
    ) w on w.product_id = p.id
    left join (
      select product_id, sum(qty_pieces) as pieces
        from public.van_inventory group by product_id
    ) v on v.product_id = p.id
  where p.is_active
    -- A product sold by the piece has no separate loose half; its
    -- selling price is already the piece price.
    and p.unit_of_measure <> 'piece'
    and p.piece_price is null
    and coalesce(w.pieces, 0) + coalesce(v.pieces, 0) > 0;

comment on view public.unsellable_pieces is
  'Products holding loose pieces that nobody has priced, so the pieces '
  'cannot be sold. Stock sitting in the building that no salesperson '
  'can move, listed so the office finds out before a customer does.';

grant select on public.unsellable_pieces to authenticated;
