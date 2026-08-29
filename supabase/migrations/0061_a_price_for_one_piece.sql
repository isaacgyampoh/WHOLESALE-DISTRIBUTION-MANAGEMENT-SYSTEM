-- ===================================================================
-- 0061  A price for one piece
-- ===================================================================
--
-- piece_price has existed since 0051 and there has been no way to see or
-- set it. The till falls back to list_price over the pack size when it
-- is null, which was always meant to be a starting point somebody
-- corrects - and a starting point nobody can reach is just a wrong
-- price with extra steps.
--
-- Wholesale is the business of the carton being cheaper per piece than
-- the singles. Left derived, every single sold is sold at the carton
-- rate, and the margin on loose sales - which is the reason a
-- distributor breaks cartons at all - is given away on every one.
--
-- Added to the end of products_priced, which is the masked view every
-- screen reads products through. Nothing about the masking changes:
-- cost still comes from product_cost() and is still null for anyone not
-- entitled to it. A selling price is not cost and was never masked.
-- security_invoker restated deliberately.
--
-- CREATE OR REPLACE VIEW does not preserve reloptions: replacing a view
-- without naming it again silently turns the setting off, the view
-- starts running with its owner's privileges, and every row level
-- security policy behind it stops applying. For a view over stock that
-- means one organization reading another's shelves - and nothing fails,
-- which is why the test suite is the only thing that catches it.
create or replace view public.products_priced
with (security_invoker = on) as
  select
    id,
    org_id,
    sku,
    barcode,
    name,
    description,
    category_id,
    supplier_id,
    unit_of_measure,
    units_per_case,
    list_price,
    tax_rate,
    reorder_point,
    reorder_qty,
    is_active,
    created_at,
    updated_at,
    public.product_cost(id) as cost_price,
    track_batches,
    track_expiry,
    shelf_life_days,
    image_path,
    piece_price
  from public.products p;
