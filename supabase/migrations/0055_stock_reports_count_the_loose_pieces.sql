-- ===================================================================
-- 0055  Stock reports count the loose pieces
-- ===================================================================
--
-- stock_summary is what the inventory screens, the category totals and
-- the reorder flags all read. It sums qty_on_hand and stops there, so
-- every loose piece in the business is worth nothing and is on no
-- report: the value of the stock is understated by exactly the singles
-- on the shelf, and a product whose cartons have all been opened reads
-- as out of stock while a hundred pieces sit in front of it.
--
-- The two quantities stay apart, as everywhere else. qty_pieces is its
-- own column and is never added to qty_on_hand. Only stock_value adds
-- them, because money is the one place they genuinely combine - a piece
-- is worth its share of what the carton cost, and cost carries no
-- margin to distort.
--
-- needs_reorder now asks whether anything is available in either form.
-- A shelf with no full cartons and ninety loose pieces is not out of
-- stock, and ordering more because it looked that way is how a
-- warehouse ends up double-stocked.
--
-- New columns go on the end: CREATE OR REPLACE VIEW may add but not
-- reorder, and dropping this would cascade into everything that reads
-- it.
create or replace view public.stock_summary as
  select
    p.id as product_id,
    p.sku,
    p.name,
    p.reorder_point,
    p.reorder_qty,
    public.product_cost(p.id)::numeric(14,2) as cost_price,
    p.list_price,
    coalesce(sum(i.qty_on_hand), 0::bigint) as qty_on_hand,
    coalesce(sum(i.qty_reserved), 0::bigint) as qty_reserved,
    coalesce(sum(i.qty_on_hand), 0::bigint) - coalesce(sum(i.qty_reserved), 0::bigint)
      as qty_available,
    public.product_cost(p.id) * coalesce(sum(i.qty_on_hand), 0::bigint)::numeric
      + case
          when coalesce(p.units_per_case, 1) > 1
          then public.product_cost(p.id)
               * coalesce(sum(i.qty_pieces), 0::bigint)::numeric
               / p.units_per_case
          else 0
        end as stock_value,
    -- Out of stock means nothing left in either form.
    (coalesce(sum(i.qty_on_hand), 0::bigint) - coalesce(sum(i.qty_reserved), 0::bigint))
      <= p.reorder_point
      and coalesce(sum(i.qty_pieces), 0::bigint) = 0
      as needs_reorder,
    p.org_id,
    p.category_id,
    p.unit_of_measure,
    p.is_active,
    coalesce(sum(i.qty_pieces), 0::bigint) as qty_pieces,
    p.units_per_case
  from public.products p
    left join public.inventory i on i.product_id = p.id
  group by p.id, p.sku, p.name, p.reorder_point, p.reorder_qty, p.list_price,
           p.org_id, p.category_id, p.unit_of_measure, p.is_active, p.units_per_case;

comment on view public.stock_summary is
  'One row per product: what is on hand in full units and loose pieces, '
  'what it is worth, and whether it needs reordering. The two quantities '
  'are never added together - only their value is, because a piece is '
  'worth its share of what the carton cost.';
