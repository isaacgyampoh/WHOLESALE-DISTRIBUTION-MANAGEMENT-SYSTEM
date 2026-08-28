-- ===================================================================
-- 0052  The till can see the loose pieces
-- ===================================================================
--
-- van_stock_summary is what the salesperson's till reads, and it is
-- cached on the phone so a round can be sold with no signal at all. It
-- reports qty_on_hand and nothing else, so loose pieces loaded onto the
-- van in 0051 are invisible at the point of sale: the stock is on board,
-- the ledger knows it, and the only screen that could sell it cannot see
-- it.
--
-- units_per_case comes along because the till has to know whether a
-- product can be split before it offers a second figure - and it has to
-- know it offline, where there is nothing to ask.
--
-- stock_value counts the pieces at their share of cost, the same way
-- van_load_value does. Cost has no margin in it, so a piece really is a
-- twelfth of a carton here; piece_price exists separately because
-- selling is a different question.
-- The new columns go on the end, deliberately. CREATE OR REPLACE VIEW
-- may add columns but may not reorder or rename them, and dropping this
-- view to get a tidier column order would cascade into everything that
-- reads it - for a column order nobody sees.
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
    -- Null for anybody not allowed to know it. product_cost is definer
    -- rights and role-masked; this view runs as its caller and may not
    -- name cost_price directly. Same rule as 0038 and 0046.
    public.product_cost(p.id)::numeric(14,2) as cost_price,
    public.product_cost(p.id) * vi.qty_on_hand::numeric
      + case
          when coalesce(p.units_per_case, 1) > 1
          then public.product_cost(p.id) * vi.qty_pieces::numeric / p.units_per_case
          else 0
        end as stock_value,
    vi.qty_pieces,
    p.units_per_case,
    p.unit_of_measure
  from public.van_inventory vi
    join public.vans v on v.id = vi.van_id
    join public.products p on p.id = vi.product_id;

comment on view public.van_stock_summary is
  'What a van is carrying, in full units and loose pieces. The two are '
  'never added together: ten cartons and five pieces is not seventy-five '
  'of anything. Read by the salesperson till, which caches it for '
  'selling with no signal.';

grant select on public.van_stock_summary to authenticated;
