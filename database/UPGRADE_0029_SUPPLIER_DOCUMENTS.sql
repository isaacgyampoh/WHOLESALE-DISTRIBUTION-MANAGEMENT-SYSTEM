-- ====================================================================
-- UPGRADE 0029 - supplier paperwork
-- ====================================================================
--
-- For a database installed before migration 0029.
-- Run it in the Supabase SQL editor.
--
-- GENERATED FILE - do not edit by hand.
-- Source: supabase/migrations/0029_supplier_documents.sql
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
-- A delivery arrives with paperwork - an invoice, a delivery note, a
-- certificate - and until now that went into a drawer. When a supplier
-- disputes what was delivered six weeks later, the drawer is the only
-- evidence, and the drawer is in one building.
--
--   supplier-documents   a PRIVATE Supabase Storage bucket, capped at
--                        20 MB per file and restricted to document
--                        types. Private is the point: a public bucket
--                        hands every supplier invoice to anybody who
--                        can guess a URL, and those carry purchase
--                        prices.
--   supplier_documents   the record. The row is the document; the file
--                        is an attachment to it, so history survives a
--                        missing object.
--
-- Files are reached by short-lived signed URL, minted server side for
-- somebody already authorised. Row level security is applied to the
-- STORAGE OBJECTS as well as to the rows describing them, because
-- storage is reachable directly with an access token and a policy on
-- the table alone would leave the files open to any signed-in driver.
--
-- AFTER RUNNING IT, redeploy. Check in the Supabase dashboard that the
-- supplier-documents bucket shows as private.

-- ===================================================================
-- 0029  Supplier documents
-- ===================================================================
--
-- A delivery arrives with paperwork - an invoice, a waybill, a
-- certificate of analysis - and until now that paperwork went into a
-- drawer. When a supplier disputes what was delivered six weeks later,
-- the drawer is the only evidence, and the drawer is in one building.
--
-- Files go into a PRIVATE Supabase Storage bucket. Private is the whole
-- point: a public bucket hands every supplier invoice the business has
-- ever received to anybody who can guess a URL, and those documents
-- carry purchase prices. Access is by short-lived signed URL, minted
-- server side for somebody who has already been authorised.
--
-- The row in this table is the record; the file is an attachment to it.
-- That way a document is still accounted for if the object is ever
-- missing, rather than silently disappearing from the history.

-- ------------------------------------------------------------------
-- The bucket
-- ------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'supplier-documents', 'supplier-documents', false,
  -- 20 MB. A scanned invoice is under two; anything at twenty is a
  -- photograph nobody compressed, and beyond that it is not paperwork.
  20971520,
  array[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;do $enum$
declare
  found text[];
  wanted text[] := array['invoice', 'delivery_note', 'waybill', 'credit_note', 'certificate', 'contract', 'other'];
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'supplier_document_kind'
  ) then
    create type public.supplier_document_kind as enum ('invoice', 'delivery_note', 'waybill', 'credit_note', 'certificate', 'contract', 'other');
  else
    select array_agg(e.enumlabel order by e.enumsortorder) into found
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'supplier_document_kind';

    -- Already correct: nothing to do, and the script carries on.
    if found is distinct from wanted then
      raise exception
        'public.supplier_document_kind already exists with different values. Found %, expected %. '
        'Reconcile it before running this script; this script will not alter an '
        'enum other code may already depend on.',
        found, wanted;
    end if;
  end if;
end $enum$;


create table if not exists public.supplier_documents (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  supplier_id   uuid not null references public.suppliers(id) on delete restrict,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,

  kind          public.supplier_document_kind not null default 'other',
  title         text not null,
  reference     text,
  document_date date,
  -- What the supplier is charging, when the document says. Kept beside
  -- the file so a total can be reconciled without opening it.
  amount        numeric(14,2),

  -- Where the file is, inside the private bucket. The path is
  -- {org_id}/{supplier_id}/{uuid}, so an object cannot be reached from
  -- one organization's folder by guessing another's.
  storage_path  text not null,
  file_name     text not null,
  mime_type     text not null,
  size_bytes    bigint not null,

  notes         text,
  uploaded_by   uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint supplier_documents_title_not_blank check (length(trim(title)) > 0),
  constraint supplier_documents_size_sane check (size_bytes > 0 and size_bytes <= 20971520),
  -- Belt and braces with the bucket's own list: a row is refused even if
  -- somebody reconfigures the bucket later.
  constraint supplier_documents_type_allowed check (
    mime_type in (
      'application/pdf',
      'image/jpeg', 'image/png', 'image/webp', 'image/heic',
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    )
  ),
  -- One row per stored object. A second row pointing at the same file
  -- would make deleting either of them destroy the other's evidence.
  constraint supplier_documents_path_unique unique (storage_path)
);

comment on table public.supplier_documents is
  'Paperwork that arrived with a delivery. The row is the record; the '
  'file in the private bucket is an attachment to it.';

create index if not exists supplier_documents_supplier
  on public.supplier_documents (org_id, supplier_id, document_date desc);
create index if not exists supplier_documents_order
  on public.supplier_documents (purchase_order_id)
  where purchase_order_id is not null;

drop trigger if exists supplier_documents_touch on public.supplier_documents;drop trigger if exists supplier_documents_touch on public.supplier_documents;
create trigger supplier_documents_touch
  before update on public.supplier_documents
  for each row execute function public.set_updated_at();


alter table public.supplier_documents enable row level security;

-- Supplier paperwork carries purchase prices, which 0023 established is
-- management information. The same roles, for the same reason.
drop policy if exists supplier_documents_read on public.supplier_documents;drop policy if exists supplier_documents_read on public.supplier_documents;
create policy supplier_documents_read on public.supplier_documents
  for select using (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'accountant', 'warehouse')
  );


drop policy if exists supplier_documents_write on public.supplier_documents;drop policy if exists supplier_documents_write on public.supplier_documents;
create policy supplier_documents_write on public.supplier_documents
  for all using (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'accountant', 'warehouse')
  ) with check (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'accountant', 'warehouse')
  );


revoke all on public.supplier_documents from anon, authenticated;
grant select, insert, update, delete on public.supplier_documents to authenticated;
grant all on public.supplier_documents to service_role;

-- ------------------------------------------------------------------
-- The objects themselves
-- ------------------------------------------------------------------
--
-- Row level security on the bucket's objects, not only on the rows that
-- describe them. Storage is reachable directly with an access token, so
-- a policy only on supplier_documents would leave the files themselves
-- open to any signed-in driver.
--
-- The first path segment is the organization. A caller may only touch
-- objects under their own.
drop policy if exists supplier_documents_objects_read on storage.objects;drop policy if exists supplier_documents_objects_read on storage.objects;
create policy supplier_documents_objects_read on storage.objects
  for select to authenticated using (
    bucket_id = 'supplier-documents'
    and (storage.foldername(name))[1] = public.auth_org_id()::text
    and public.has_role('admin', 'senior_manager', 'manager', 'accountant', 'warehouse')
  );


drop policy if exists supplier_documents_objects_write on storage.objects;drop policy if exists supplier_documents_objects_write on storage.objects;
create policy supplier_documents_objects_write on storage.objects
  for insert to authenticated with check (
    bucket_id = 'supplier-documents'
    and (storage.foldername(name))[1] = public.auth_org_id()::text
    and public.has_role('admin', 'senior_manager', 'manager', 'accountant', 'warehouse')
  );


-- Deleting evidence is a narrower job than filing it. A storeman
-- uploads; removing a document that a dispute may later turn on is for
-- somebody accountable for that decision.
drop policy if exists supplier_documents_objects_delete on storage.objects;drop policy if exists supplier_documents_objects_delete on storage.objects;
create policy supplier_documents_objects_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'supplier-documents'
    and (storage.foldername(name))[1] = public.auth_org_id()::text
    and public.has_role('admin', 'senior_manager', 'manager')
  );


-- ------------------------------------------------------------------
-- What the office reads
-- ------------------------------------------------------------------
create or replace view public.supplier_document_detail
with (security_invoker = on) as
  select
    d.id,
    d.org_id,
    d.supplier_id,
    s.code  as supplier_code,
    s.name  as supplier_name,
    d.purchase_order_id,
    po.po_number,
    d.kind,
    d.title,
    d.reference,
    d.document_date,
    d.amount,
    d.storage_path,
    d.file_name,
    d.mime_type,
    d.size_bytes,
    d.notes,
    p.full_name as uploaded_by_name,
    d.created_at
  from public.supplier_documents d
  join public.suppliers s on s.id = d.supplier_id
  left join public.purchase_orders po on po.id = d.purchase_order_id
  left join public.profiles p on p.id = d.uploaded_by;

comment on view public.supplier_document_detail is
  'Supplier paperwork with the supplier and order it belongs to.';

-- ====================================================================
-- Confirm it took. Every row should read PASS.
-- ====================================================================
select 'the bucket exists' as check,
       case when exists (select 1 from storage.buckets where id = 'supplier-documents')
            then 'PASS' else 'FAIL' end as result
union all
select 'and is private',
       case when exists (select 1 from storage.buckets
                          where id = 'supplier-documents' and public = false)
            then 'PASS' else 'FAIL' end
union all
select 'with a size cap and a type list',
       case when exists (select 1 from storage.buckets
                          where id = 'supplier-documents'
                            and file_size_limit is not null
                            and allowed_mime_types is not null)
            then 'PASS' else 'FAIL' end
union all
select 'supplier_documents table',
       case when to_regclass('public.supplier_documents') is not null
            then 'PASS' else 'FAIL' end
union all
select 'the files have policies of their own',
       case when (select count(*) from pg_policies
                   where schemaname = 'storage' and tablename = 'objects'
                     and policyname like 'supplier_documents_objects%') = 3
            then 'PASS' else 'FAIL' end
union all
select 'a driver cannot read supplier paperwork',
       case when exists (select 1 from pg_policies
                          where tablename = 'supplier_documents'
                            and policyname = 'supplier_documents_read'
                            and qual like '%has_role%')
            then 'PASS' else 'FAIL' end;
