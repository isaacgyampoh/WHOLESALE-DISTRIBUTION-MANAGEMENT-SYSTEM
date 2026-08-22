





-- =====================================================================
-- 0020_category_status.sql
--
-- Lets a category be retired without being destroyed.
--
-- Categories are referenced by products, and products by stock
-- movements, sales and van loads. Deleting one would either fail on a
-- foreign key or, worse, orphan history. Retiring it keeps every past
-- record readable while removing the category from future use.
--
-- Products already work this way (products.is_active). This brings
-- categories into line.
--
-- Nothing else changes: the manager category scopes from 0011, the
-- can_access_category() helper and every policy that depends on them
-- are untouched.
-- =====================================================================

alter table public.categories
  add column is_active boolean not null default true;

comment on column public.categories.is_active is
  'A retired category keeps its products and their history but is not '
  'offered when creating or reassigning a product.';

-- Category lists are almost always filtered by status within one
-- organization.
create index categories_org_active_idx
  on public.categories (org_id, is_active);

-- The reporting view gains the two columns the product screens filter
-- on, so a product list does not have to join twice to show stock.
-- Appended at the end: CREATE OR REPLACE VIEW cannot reorder columns.
create or replace view public.stock_summary
with (security_invoker = on) as
  select
    p.id            as product_id,
    p.sku,
    p.name,
    p.reorder_point,
    p.reorder_qty,
    p.cost_price,
    p.list_price,
    coalesce(sum(inv.qty_on_hand), 0)   as qty_on_hand,
    coalesce(sum(inv.qty_reserved), 0)  as qty_reserved,
    coalesce(sum(inv.qty_available), 0) as qty_available,
    coalesce(sum(inv.qty_on_hand), 0) * p.cost_price as stock_value,
    coalesce(sum(inv.qty_available), 0) <= p.reorder_point as needs_reorder,
    p.org_id,
    p.category_id,
    p.unit_of_measure,
    p.is_active
  from public.products p
  left join public.inventory inv on inv.product_id = p.id
  where p.is_active
  group by p.id, p.sku, p.name, p.reorder_point, p.reorder_qty,
           p.cost_price, p.list_price, p.org_id, p.category_id,
           p.unit_of_measure, p.is_active;

-- ------------------------------------------------- stock stays derived
-- The whole inventory design rests on quantities coming from the ledger,
-- yet inventory was directly writable by an administrator, a manager or
-- a warehouse controller. The application never does it, but a principle
-- the database does not enforce is a principle that will eventually be
-- broken.
--
-- Quantities are now written only by the triggers and functions that
-- post movements, which run as their owner and are unaffected by this.
-- bin_location stays editable: it describes where stock sits, not how
-- much there is.
revoke insert, update, delete on public.inventory from authenticated;
grant select on public.inventory to authenticated;
grant update (bin_location) on public.inventory to authenticated;

comment on table public.inventory is
  'Derived stock levels. Written only by the movement triggers; a '
  'signed-in user may read it and set a bin location, nothing more.';

-- GAB Premium Ent
-- Upgrade 0020: category status, and stock that stays derived.
-- For a database ALREADY INSTALLED at migration 0019.
--
-- WHAT IT CHANGES
--   1. categories.is_active, so a category can be retired instead of
--      deleted. Deleting one would orphan the history of every product
--      that ever belonged to it.
--   2. stock_summary gains the columns the product screens filter on.
--   3. inventory is no longer directly writable. Quantities are derived
--      from the stock ledger, and until now an administrator could still
--      set one by hand. Only the movement triggers write them now; a
--      signed-in user may read the table and set a bin location.
--
--   No business data is touched. No table is dropped. Existing stock
--   levels are unchanged.
--
-- HOW TO RUN
--   Supabase -> SQL Editor -> New query -> Ctrl+A in the file -> paste -> Run.
--   Then run VERIFY_DATABASE.sql and check the new rows read OK.
