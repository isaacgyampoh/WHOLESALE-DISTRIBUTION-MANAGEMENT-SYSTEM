-- ====================================================================
-- UPGRADE 0038 - the masked view carries the picture too
-- ====================================================================
--
-- For a database installed before migration 0038.
-- Run it in the Supabase SQL editor.
--
-- GENERATED FILE - do not edit by hand.
-- Source: supabase/migrations/0038_priced_view_carries_the_picture.sql
-- Regenerate: node database/build.mjs
--
-- Safe to run twice. Every object is created behind an existence check,
-- so a second run reports success and changes nothing. An enum that
-- already exists is compared against what this script expects and the
-- script stops with both lists if they differ, rather than altering a
-- type other code may already depend on.
--
-- WHAT IT FIXES
--
-- The Products screen fails outright on a database upgraded to 0037,
-- with either
--
--   column products_priced.image_path does not exist
--   permission denied for table products
--
-- depending on which part of the page asks first. Both are the same
-- mistake made twice.
--
-- Nothing reads products from the table. 0023 withdrew table-level
-- SELECT and granted the columns individually, leaving products_priced
-- as the only way in. So a column added to the table afterwards arrives
-- with no grant and outside the view - which is half a change. It
-- happened to the batch columns in 0024 and to the picture in 0037.
--
-- This adds the four missing columns to the view and re-applies 0023's
-- column grants over whatever the table holds today, so both halves
-- cover everything currently there.
--
-- It reads nothing and deletes nothing. The view is replaced and the
-- grants re-stated; no table, row or policy is touched.
--
-- AFTER RUNNING IT the Products screen loads. No redeploy is needed -
-- this is entirely inside the database.

-- ===================================================================
-- 0038  The masked view carries the picture too
-- ===================================================================
--
-- Migration 0037 added `products.image_path` to the table and stopped
-- there. But nothing reads products from the table: 0023 withdrew
-- table-level SELECT and left `products_priced` as the only way in, so
-- the catalogue asks the view for a column the view does not have and
-- the Products page fails outright with
--
--   column products_priced.image_path does not exist
--
-- This was invisible locally because no test exercised the real query
-- path - the schema tests read the table directly, where the column does
-- exist. It surfaced the moment the application ran against a real
-- database.
--
-- The lesson worth keeping: adding a column to a table that is only ever
-- read through a view is half a change.

-- `create or replace view` refuses to rename or reorder a column, so the
-- eighteen already there are reproduced in exactly their existing order
-- and the new ones are appended after them.
create or replace view public.products_priced
with (security_invoker = on) as
  select
    p.id,
    p.org_id,
    p.sku,
    p.barcode,
    p.name,
    p.description,
    p.category_id,
    p.supplier_id,
    p.unit_of_measure,
    p.units_per_case,
    p.list_price,
    p.tax_rate,
    p.reorder_point,
    p.reorder_qty,
    p.is_active,
    p.created_at,
    p.updated_at,
    -- Cost only for the roles allowed it; null for everybody else. This
    -- is the whole reason the view exists.
    public.product_cost(p.id) as cost_price,
    -- Appended below. All four are columns the catalogue asks this view
    -- for and the view did not have - the batch ones since 0024, the
    -- picture since 0037. Each was added to the table and nowhere else.
    p.track_batches,
    p.track_expiry,
    p.shelf_life_days,
    p.image_path
  from public.products p;

comment on view public.products_priced is
  'Products with cost masked per caller. The only route to a product '
  'row: table-level SELECT was withdrawn in 0023, so every column the '
  'catalogue needs has to be here.';

grant select on public.products_priced to authenticated;

-- ------------------------------------------------------------------
-- Every column added since 0023 was left without a grant
-- ------------------------------------------------------------------
--
-- 0023 withdrew table-level SELECT on the cost-bearing tables and
-- granted the individual columns instead - every column that existed
-- *at that moment*. Nothing re-runs it, so each column added afterwards
-- arrived with no grant at all:
--
--   0024  track_batches, track_expiry, shelf_life_days
--   0037  image_path
--
-- That is what actually broke the products screen. `products_priced` is
-- security_invoker, so it reads with the caller's privileges; one
-- ungranted column in its select list and the whole view is refused with
-- "permission denied for table products" - which reads like the view is
-- the problem when the view is fine.
--
-- Re-applying the same rule now covers everything present today. The
-- verification script checks it from here on, so the next column added
-- without a grant fails a check rather than a screen.
do $columns$
declare
  target record;
  cols   text;
begin
  for target in select * from (values
      ('products','cost_price'),
      ('van_load_items','unit_cost'),
      ('purchase_order_items','unit_cost')
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

-- ====================================================================
-- Confirm it took. Every row should read PASS.
-- ====================================================================
select 'the view carries the picture' as check,
       case when exists (select 1 from information_schema.columns
                          where table_name = 'products_priced' and column_name = 'image_path')
            then 'PASS' else 'FAIL' end as result
union all
select 'the view carries the batch columns',
       case when (select count(*) from information_schema.columns
                   where table_name = 'products_priced'
                     and column_name in ('track_batches','track_expiry','shelf_life_days')) = 3
            then 'PASS' else 'FAIL' end
union all
select 'cost is still masked per caller',
       case when position('product_cost' in
              coalesce(pg_get_viewdef('public.products_priced'::regclass), '')) > 0
            then 'PASS' else 'FAIL' end
union all
select 'every product column but cost is granted',
       case when (select count(*) from information_schema.columns c
                   where c.table_schema = 'public' and c.table_name = 'products'
                     and c.column_name <> 'cost_price'
                     and not exists (
                       select 1 from information_schema.column_privileges g
                        where g.table_schema = 'public' and g.table_name = 'products'
                          and g.column_name = c.column_name
                          and g.grantee = 'authenticated' and g.privilege_type = 'SELECT')) = 0
            then 'PASS' else 'FAIL' end
union all
select 'cost_price itself is still not granted',
       case when not exists (select 1 from information_schema.column_privileges
                              where table_schema = 'public' and table_name = 'products'
                                and column_name = 'cost_price'
                                and grantee in ('authenticated','anon')
                                and privilege_type = 'SELECT')
            then 'PASS' else 'FAIL' end
union all
select 'table-level select is still withdrawn',
       case when not exists (select 1 from information_schema.table_privileges
                              where table_schema = 'public' and table_name = 'products'
                                and grantee in ('authenticated','anon')
                                and privilege_type = 'SELECT')
            then 'PASS' else 'FAIL' end;
