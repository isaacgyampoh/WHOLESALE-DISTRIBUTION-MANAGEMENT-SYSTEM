-- ====================================================================
-- UPGRADE 0037 - a picture of what is being sold
-- ====================================================================
--
-- For a database installed before migration 0037.
-- Run it in the Supabase SQL editor.
--
-- GENERATED FILE - do not edit by hand.
-- Source: supabase/migrations/0037_product_images.sql
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
-- A salesperson outside a shop scrolls a list of names. Half a wholesale
-- catalogue is "500ml", "1L", "Crate of 24" of things that read alike
-- and look nothing alike on a shelf, and the wrong line picked in a
-- hurry is an argument at the next delivery.
--
--   product-images        a storage bucket, 5 MB, JPEG/PNG/WebP
--   products.image_path   where the picture lives
--
-- and sync_bootstrap carries the path, so the picture is still there
-- when the signal is not.
--
-- THE BUCKET IS PUBLIC, deliberately. Supplier documents are private
-- because they carry purchase prices; a product photograph is the thing
-- the customer is holding. It has to be public because a signed URL
-- expires - a phone that cached the round at 6am and has had no signal
-- since cannot mint a new one - and because the service worker caches by
-- URL, which a signed URL defeats by being different every time.
--
-- Writing is still restricted to the roles that may edit products. Only
-- reading is open.
--
-- AFTER RUNNING IT, redeploy, then set pictures on the lines that need
-- them: Products, open one, Picture.

-- ===================================================================
-- 0037  A picture of what is being sold
-- ===================================================================
--
-- A salesperson standing outside a shop scrolls a list of names. Half
-- the catalogue is "500ml", "1L", "Crate of 24" of things that look
-- alike in text and nothing alike on a shelf, and the wrong line picked
-- in a hurry is a delivery argument later.
--
-- So products get a photograph.
--
-- THE BUCKET IS PUBLIC, and that is deliberate rather than careless.
-- Supplier documents are private because they carry purchase prices; a
-- product photograph is the thing the customer is holding. Two reasons
-- it has to be public rather than served through signed URLs:
--
--   A signed URL expires. The driver's phone caches the round before it
--   leaves the yard and may not see a network again for hours, so an
--   expiring image link means a blank catalogue in the field - exactly
--   where the picture is worth having.
--
--   The service worker caches by URL. A signed URL is different every
--   time it is minted, so nothing would ever hit the cache.
--
-- Nothing confidential goes in here. Writing is still restricted to the
-- roles that may edit products; only reading is open.

-- ------------------------------------------------------------------
-- The bucket
-- ------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images', 'product-images', true,
  -- 5 MB. A product photograph is a few hundred kilobytes; anything at
  -- five megabytes is an unresized camera original, and it has to travel
  -- down a phone connection in a van.
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ------------------------------------------------------------------
-- Where the picture lives
-- ------------------------------------------------------------------
alter table public.products
  add column if not exists image_path text;

comment on column public.products.image_path is
  'Path in the public product-images bucket. Public on purpose: a phone '
  'offline in a van cannot fetch a signed URL, and a photograph of '
  'something on a shelf is not confidential.';

-- ------------------------------------------------------------------
-- Who may change one
-- ------------------------------------------------------------------
--
-- Reading is open, because the bucket is public and the pictures are of
-- things customers are handed. Writing and removing belong to whoever
-- may edit the product itself.

drop policy if exists product_images_read on storage.objects;drop policy if exists product_images_read on storage.objects;
create policy product_images_read on storage.objects
  for select using (bucket_id = 'product-images');


drop policy if exists product_images_write on storage.objects;drop policy if exists product_images_write on storage.objects;
create policy product_images_write on storage.objects
  for insert with check (
    bucket_id = 'product-images'
    and public.has_role('admin', 'senior_manager', 'manager')
  );


drop policy if exists product_images_update on storage.objects;drop policy if exists product_images_update on storage.objects;
create policy product_images_update on storage.objects
  for update using (
    bucket_id = 'product-images'
    and public.has_role('admin', 'senior_manager', 'manager')
  );


drop policy if exists product_images_delete on storage.objects;drop policy if exists product_images_delete on storage.objects;
create policy product_images_delete on storage.objects
  for delete using (
    bucket_id = 'product-images'
    and public.has_role('admin', 'senior_manager', 'manager')
  );


-- ------------------------------------------------------------------
-- The picture travels with the round
-- ------------------------------------------------------------------
--
-- sync_bootstrap builds the snapshot a phone caches before it leaves.
-- The image path has to be in it, or the field catalogue is text again
-- the moment the signal goes.
--
-- Rewritten in place rather than reproduced: the function is long, its
-- logic is settled, and a copy here would be one more place for the two
-- to drift apart.
do $bootstrap$
declare
  body text;
begin
  select pg_get_functiondef(p.oid) into body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'sync_bootstrap'
   limit 1;

  if body is null then
    raise notice 'sync_bootstrap is not on this database; skipping';
    return;
  end if;

  -- The snapshot's price block already joins products, so the picture
  -- rides along with the figure the till needs anyway.
  --
  -- Idempotent: if the column is already selected this does nothing.
  if position('image_path' in body) = 0 then
    body := replace(
      body,
      $anchor$'tax_rate', p.tax_rate$anchor$,
      $with$'tax_rate', p.tax_rate, 'image_path', p.image_path$with$);

    if position('image_path' in body) = 0 then
      raise exception
        'sync_bootstrap does not look the way this migration expects, so the '
        'product image would silently not reach the field. Update 0037.';
    end if;

    execute body;
  end if;
end
$bootstrap$;

-- ====================================================================
-- Confirm it took. Every row should read PASS.
-- ====================================================================
select 'the bucket exists and is public' as check,
       case when exists (select 1 from storage.buckets
                          where id = 'product-images' and public)
            then 'PASS' else 'FAIL' end as result
union all
select 'only images are accepted',
       case when (select allowed_mime_types from storage.buckets where id = 'product-images')
              @> array['image/jpeg','image/png','image/webp']
            then 'PASS' else 'FAIL' end
union all
select 'products carry a picture',
       case when exists (select 1 from information_schema.columns
                          where table_name = 'products' and column_name = 'image_path')
            then 'PASS' else 'FAIL' end
union all
select 'only product editors may upload',
       case when exists (select 1 from pg_policies
                          where schemaname = 'storage' and tablename = 'objects'
                            and policyname = 'product_images_write'
                            and with_check like '%has_role%')
            then 'PASS' else 'FAIL' end
union all
select 'the picture reaches the field',
       case when position('image_path' in
              coalesce((select pg_get_functiondef(p.oid) from pg_proc p
                          join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname = 'public' and p.proname = 'sync_bootstrap'
                         limit 1), '')) > 0
            then 'PASS' else 'FAIL' end
union all
select 'supplier documents are still private',
       case when exists (select 1 from storage.buckets
                          where id = 'supplier-documents' and not public)
            then 'PASS' else 'FAIL' end;
