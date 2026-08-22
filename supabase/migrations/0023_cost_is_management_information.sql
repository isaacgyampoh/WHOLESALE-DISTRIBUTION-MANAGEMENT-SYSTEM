-- ===================================================================
-- 0023  Cost price is management information
-- ===================================================================
--
-- A driver could read what the business pays for its goods.
--
--   select cost_price from products;          -- worked
--   select stock_value from van_stock_summary;-- worked
--   select unit_cost from van_load_items;     -- worked
--   select * from purchase_orders;            -- worked
--
-- and the products screen rendered a Cost column to them. Margin is the
-- single most commercially sensitive number a distributor has, and a
-- driver spends the day standing in front of the customers it is being
-- earned from.
--
-- Hiding the column in the interface would have been decoration: every
-- one of those reads is available to anything holding the anon key and
-- a driver's session. So it is closed here.
--
-- WHAT DECIDES ACCESS
--
-- The roles that price goods, buy them, or account for them:
--
--   admin, senior_manager, manager, accountant, warehouse
--
-- Everyone else - driver, sales_rep - sees the selling price and
-- nothing behind it. That is not a comment on trust; it is the
-- ordinary separation between the people who sell and the people who
-- set the terms.
--
-- HOW
--
-- PostgreSQL has no column-level row security, and every signed-in user
-- of this application is the same database role (`authenticated`), so a
-- column grant cannot tell a driver from an administrator. What can is
-- a SECURITY DEFINER function that asks who is calling. The privilege
-- to read the raw column is withdrawn, and the only way to it is
-- through a function that answers NULL to anyone without the role.

-- ------------------------------------------------------------------
-- The one door to a cost figure
-- ------------------------------------------------------------------
create or replace function public.product_cost(p_product uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Definer rights, so this can read a column the caller cannot. That
  -- makes the role check below the whole of the control, which is why
  -- it comes first and returns NULL rather than raising: a masked view
  -- should show a blank cell, not fail the query it sits in.
  if not public.has_role('admin', 'senior_manager', 'manager', 'accountant', 'warehouse') then
    return null;
  end if;

  -- Still scoped to the caller's own organization. Definer rights would
  -- otherwise reach across tenants.
  return (
    select p.cost_price
      from public.products p
     where p.id = p_product
       and p.org_id = public.auth_org_id()
  );
end;
$$;

comment on function public.product_cost is
  'The cost of a product, or NULL to anyone whose role does not include '
  'pricing, purchasing or accounting. The only route to cost for a Data '
  'API caller.';

revoke all on function public.product_cost(uuid) from public, anon;
grant execute on function public.product_cost(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- Withdraw the raw columns
-- ------------------------------------------------------------------
-- Named columns rather than the whole table: a driver still needs the
-- selling price, the unit, the reorder point and everything else on a
-- product to do their job.
-- A column-level REVOKE does not override a table-level GRANT: a role
-- holding `select` on the table reads every column of it regardless.
-- That is what the first attempt at this migration got wrong, and why
-- it was tested rather than believed. The table grant has to go,
-- replaced by one naming every column except the withheld one - built
-- from the catalogue, so a column added later is granted rather than
-- silently dropped.
do $columns$
declare
  target record;
  cols   text;
begin
  for target in
    select * from (values
      ('products',             'cost_price'),
      ('van_load_items',       'unit_cost'),
      ('purchase_order_items', 'unit_cost')
    ) as t(tbl, withheld)
  loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
      into cols
      from information_schema.columns
     where table_schema = 'public'
       and table_name = target.tbl
       and column_name <> target.withheld;

    execute format('revoke select on public.%I from anon, authenticated', target.tbl);
    execute format('grant select (%s) on public.%I to authenticated', cols, target.tbl);
  end loop;
end
$columns$;

-- ------------------------------------------------------------------
-- A product as the application should read it
-- ------------------------------------------------------------------
-- Everything on the product except the raw cost, plus a cost that is
-- masked per caller. security_invoker keeps row level security working
-- as it does on the table itself.
create or replace view public.products_priced
with (security_invoker = on) as
  select
    p.id, p.org_id, p.sku, p.barcode, p.name, p.description,
    p.category_id, p.supplier_id, p.unit_of_measure, p.units_per_case,
    p.list_price, p.tax_rate, p.reorder_point, p.reorder_qty,
    p.is_active, p.created_at, p.updated_at,
    public.product_cost(p.id) as cost_price
  from public.products p;

comment on view public.products_priced is
  'Products with cost masked per caller. Read this rather than the '
  'table wherever a cost figure is displayed.';

grant select on public.products_priced to authenticated, service_role;

-- ------------------------------------------------------------------
-- The reporting views leaked cost as a computed value
-- ------------------------------------------------------------------
-- stock_value is quantity times cost. Publishing it is publishing cost,
-- so it is masked the same way: a driver gets the quantity and a blank
-- value, which is exactly what they need to sell from a van.
-- Column order is preserved exactly: `create or replace view` refuses to
-- rename or reorder, and a drop would take the views built on top of it.
create or replace view public.stock_summary
with (security_invoker = on) as
  select
    p.id                              as product_id,
    p.sku,
    p.name,
    p.reorder_point,
    p.reorder_qty,
    public.product_cost(p.id)::numeric(14,2)  as cost_price,
    p.list_price,
    coalesce(sum(i.qty_on_hand), 0)   as qty_on_hand,
    coalesce(sum(i.qty_reserved), 0)  as qty_reserved,
    coalesce(sum(i.qty_on_hand), 0) - coalesce(sum(i.qty_reserved), 0) as qty_available,
    public.product_cost(p.id) * coalesce(sum(i.qty_on_hand), 0)        as stock_value,
    (coalesce(sum(i.qty_on_hand), 0) - coalesce(sum(i.qty_reserved), 0))
      <= p.reorder_point              as needs_reorder,
    p.org_id,
    p.category_id,
    p.unit_of_measure,
    p.is_active
  from public.products p
  left join public.inventory i on i.product_id = p.id
  group by p.id, p.sku, p.name, p.reorder_point, p.reorder_qty, p.list_price,
           p.org_id, p.category_id, p.unit_of_measure, p.is_active;

create or replace view public.van_stock_summary
with (security_invoker = on) as
  select
    vi.org_id,
    vi.van_id,
    v.code                     as van_code,
    v.registration_no,
    vi.product_id,
    p.sku,
    p.name                     as product_name,
    vi.qty_on_hand,
    public.product_cost(p.id)::numeric(14,2) as cost_price,
    public.product_cost(p.id) * vi.qty_on_hand as stock_value
  from public.van_inventory vi
  join public.vans v on v.id = vi.van_id
  join public.products p on p.id = vi.product_id;

comment on view public.van_stock_summary is
  'What each van is carrying. Quantities to everyone who may see the '
  'van; value only to the roles that may see cost.';

-- ------------------------------------------------------------------
-- Procurement is not a driver's business
-- ------------------------------------------------------------------
-- purchase_orders and purchase_order_items were already role-gated by
-- their own policies. suppliers was not: `suppliers_read` allowed any
-- member of the organization to read who the business buys from and on
-- what terms, which is the same commercial information cost is.
--
-- Policies for one command are OR'd, so adding a stricter one beside
-- the permissive one would have achieved nothing. The permissive one is
-- replaced.
drop policy if exists suppliers_read on public.suppliers;
drop policy if exists suppliers_select on public.suppliers;
create policy suppliers_read on public.suppliers
  for select using (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'accountant', 'warehouse')
  );

comment on policy suppliers_read on public.suppliers is
  'Supplier terms are commercial information, on the same footing as '
  'cost. Sales roles do not read this table.';
