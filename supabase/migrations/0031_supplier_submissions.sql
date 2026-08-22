-- ===================================================================
-- 0031  Suppliers submit their own invoices, and the gaps around it
-- ===================================================================
--
-- 0029 let the office file paperwork that arrived with a delivery, and
-- 0030 let a supplier look at their orders. Neither closed the loop the
-- business actually wants: the supplier sends the invoice themselves,
-- somebody here looks at it, and it is accepted or sent back.
--
-- That loop is the point. A supplier emailing a PDF to whoever they
-- have a contact for is how an invoice ends up in one person's inbox
-- and nowhere else. A document submitted through the link arrives
-- attached to the supplier record, with the number and amount they
-- typed, waiting for somebody to agree it.
--
-- This migration also closes five smaller gaps found in the production
-- audit: invoices could not carry a discount, waybills could not record
-- a shortage, returns had no reason worth reporting on, purchase orders
-- had nowhere to put the supplier's own invoice reference, and nothing
-- told the office a supplier had sent anything.

-- ------------------------------------------------------------------
-- Where a document is up to
-- ------------------------------------------------------------------
create type public.document_review_status as enum (
  -- Waiting on the supplier: a link was issued, nothing has arrived.
  'pending',
  -- They sent it. Nobody here has looked yet.
  'received',
  -- Somebody has opened it and is working through it.
  'reviewing',
  'approved',
  'rejected'
);

alter table public.supplier_documents
  add column if not exists status public.document_review_status not null default 'approved',
  -- What the supplier typed, kept apart from what we recorded. If their
  -- number disagrees with ours, both are on the record rather than one
  -- having quietly overwritten the other.
  add column if not exists submitted_company text,
  add column if not exists submitted_by_name text,
  add column if not exists submitted_at timestamptz,
  add column if not exists submitted_via_token uuid,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text;

comment on column public.supplier_documents.status is
  'Where the document is up to. Defaults to approved because a document '
  'filed by our own staff has already been seen by somebody here; only '
  'a supplier submission starts at received.';

comment on column public.supplier_documents.submitted_company is
  'The name the supplier typed, which is not always the name we hold '
  'them under. Kept as evidence rather than corrected.';

create index if not exists supplier_documents_awaiting
  on public.supplier_documents (org_id, status, submitted_at desc)
  where status in ('received', 'reviewing');

-- ------------------------------------------------------------------
-- A supplier submitting one
-- ------------------------------------------------------------------
--
-- Runs for somebody holding a link, not a session, so it takes the
-- supplier and organization the link already resolved to rather than
-- reading them from anything the browser sent. The caller is the server;
-- nothing here is reachable from a page.
create or replace function public.submit_supplier_document(
  p_supplier_id  uuid,
  p_org_id       uuid,
  p_token_id     uuid,
  p_company      text,
  p_contact      text,
  p_reference    text,
  p_document_date date,
  p_amount       numeric,
  p_notes        text,
  p_storage_path text,
  p_file_name    text,
  p_mime_type    text,
  p_size_bytes   bigint
)
returns public.supplier_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  supplier public.suppliers;
  token    public.supplier_portal_tokens;
  document public.supplier_documents;
begin
  -- The link is checked again here rather than trusted from the caller.
  -- A revoked link must stop working everywhere at once, including for a
  -- request already in flight.
  select * into token
    from public.supplier_portal_tokens
   where id = p_token_id
     and supplier_id = p_supplier_id
     and org_id = p_org_id
     and revoked_at is null
     and expires_at > now();

  if not found then
    raise exception 'That link is no longer valid' using errcode = '42501';
  end if;

  select * into supplier from public.suppliers where id = p_supplier_id;
  if not found or supplier.org_id <> p_org_id then
    raise exception 'That link is no longer valid' using errcode = '42501';
  end if;

  if p_reference is null or length(trim(p_reference)) = 0 then
    raise exception 'An invoice number is required';
  end if;

  if p_amount is not null and p_amount < 0 then
    raise exception 'An invoice cannot be for a negative amount';
  end if;

  insert into public.supplier_documents (
    org_id, supplier_id, kind, title, reference, document_date, amount,
    storage_path, file_name, mime_type, size_bytes, notes,
    status, submitted_company, submitted_by_name, submitted_at, submitted_via_token
  ) values (
    p_org_id, p_supplier_id, 'invoice',
    'Invoice ' || trim(p_reference),
    trim(p_reference), p_document_date, p_amount,
    p_storage_path, p_file_name, p_mime_type, p_size_bytes,
    nullif(trim(coalesce(p_notes, '')), ''),
    'received',
    nullif(trim(coalesce(p_company, '')), ''),
    nullif(trim(coalesce(p_contact, '')), ''),
    now(), p_token_id
  )
  returning * into document;

  -- Somebody has to know it arrived. Without this it sits in a list
  -- nobody opens until the supplier rings to ask why they have not been
  -- paid.
  perform public.notify(
    p_org_id, 'accountant', 'supplier.invoice_received',
    supplier.name || ' has sent an invoice',
    'Invoice ' || trim(p_reference)
      || case when p_amount is not null
              then ' for ' || to_char(p_amount, 'FM999,999,990.00') || ' cedi'
              else '' end
      || '. It needs checking before it is approved for payment.',
    '/suppliers/' || p_supplier_id, 'info', 'supplier_document', document.id
  );

  return document;
end;
$$;

comment on function public.submit_supplier_document is
  'A supplier filing their own invoice through a portal link. The link '
  'is re-checked here, so revoking it stops a submission already in '
  'flight.';

revoke all on function public.submit_supplier_document(
  uuid, uuid, uuid, text, text, text, date, numeric, text, text, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.submit_supplier_document(
  uuid, uuid, uuid, text, text, text, date, numeric, text, text, text, text, bigint)
  to service_role;

-- What a supplier can see of what they have already sent.
create or replace function public.supplier_portal_documents(
  p_supplier_id uuid,
  p_org_id      uuid
)
returns table (
  id uuid,
  reference text,
  document_date date,
  amount numeric,
  status public.document_review_status,
  submitted_at timestamptz,
  file_name text,
  review_note text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    d.id, d.reference, d.document_date, d.amount, d.status,
    d.submitted_at, d.file_name,
    -- A rejection reason is the one part of our review the supplier
    -- needs, because it tells them what to send instead. Internal notes
    -- on an approved document are not their business.
    case when d.status = 'rejected' then d.review_note else null end
  from public.supplier_documents d
  where d.supplier_id = p_supplier_id
    and d.org_id = p_org_id
    and d.submitted_at is not null
  order by d.submitted_at desc
  limit 50;
$$;

revoke all on function public.supplier_portal_documents(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.supplier_portal_documents(uuid, uuid) to service_role;

-- ------------------------------------------------------------------
-- Reviewing one
-- ------------------------------------------------------------------
create or replace function public.review_supplier_document(
  p_document_id uuid,
  p_status      public.document_review_status,
  p_note        text default null
)
returns public.supplier_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  document public.supplier_documents;
begin
  -- Approving an invoice is agreeing to pay it.
  perform public.require_role('admin', 'senior_manager', 'manager', 'accountant');

  select * into document from public.supplier_documents where id = p_document_id;
  if not found then
    raise exception 'Document % not found', p_document_id;
  end if;

  if auth.uid() is not null and document.org_id is distinct from public.auth_org_id() then
    raise exception 'Document % not found', p_document_id using errcode = '42501';
  end if;

  if p_status not in ('reviewing', 'approved', 'rejected') then
    raise exception 'A review sets a document to reviewing, approved or rejected';
  end if;

  -- Sending an invoice back without saying why guarantees the supplier
  -- sends the same thing again.
  if p_status = 'rejected' and (p_note is null or length(trim(p_note)) = 0) then
    raise exception 'Say why it is being rejected, so the supplier knows what to send instead';
  end if;

  update public.supplier_documents
     set status = p_status,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_note = nullif(trim(coalesce(p_note, '')), ''),
         updated_at = now()
   where id = p_document_id
  returning * into document;

  return document;
end;
$$;

revoke all on function public.review_supplier_document(
  uuid, public.document_review_status, text) from public, anon;
grant execute on function public.review_supplier_document(
  uuid, public.document_review_status, text) to authenticated, service_role;

-- ------------------------------------------------------------------
-- What we owe suppliers
-- ------------------------------------------------------------------
alter table public.purchase_orders
  add column if not exists supplier_invoice_number text,
  add column if not exists supplier_invoice_date date;

comment on column public.purchase_orders.supplier_invoice_number is
  'The supplier''s own reference for this order. What they quote when '
  'they ring about payment.';

create or replace view public.supplier_payables
with (security_invoker = on) as
  select
    s.org_id,
    s.id                as supplier_id,
    s.code              as supplier_code,
    s.name              as supplier_name,
    s.payment_terms_days,
    count(po.id) filter (
      where po.status in ('submitted', 'partially_received', 'received')
    )                   as open_orders,
    coalesce(sum(po.total) filter (
      where po.status in ('partially_received', 'received')
    ), 0)::numeric(14,2) as received_value,
    coalesce(sum(po.total) filter (where po.status = 'submitted'), 0)::numeric(14,2)
                        as on_order_value,
    -- What they have actually billed us, from the invoices they sent
    -- through the portal or that we filed by hand.
    coalesce((
      select sum(d.amount) from public.supplier_documents d
       where d.supplier_id = s.id and d.kind = 'invoice'
         and d.status in ('received', 'reviewing', 'approved')
    ), 0)::numeric(14,2) as invoiced_value,
    (select count(*) from public.supplier_documents d
      where d.supplier_id = s.id and d.status in ('received', 'reviewing'))
                        as invoices_awaiting_review
  from public.suppliers s
  left join public.purchase_orders po on po.supplier_id = s.id
  group by s.org_id, s.id, s.code, s.name, s.payment_terms_days;

comment on view public.supplier_payables is
  'What each supplier has delivered, what they have billed, and how much '
  'of their paperwork is still waiting on somebody here.';

-- ------------------------------------------------------------------
-- Invoices can carry a discount
-- ------------------------------------------------------------------
--
-- A wholesaler settling a round often knocks something off. Recording
-- that as a reduced line price loses the fact a discount was given,
-- which is exactly the thing a manager wants to look at later.
alter table public.invoices
  add column if not exists discount numeric(14,2) not null default 0
    check (discount >= 0);

comment on column public.invoices.discount is
  'Taken off the total. Held separately so it can be reported on, rather '
  'than buried in a reduced line price.';

-- `total` already exists as a stored column, so the discount is applied
-- when the invoice is raised rather than by redefining it - dropping a
-- column the ageing view depends on would take the view with it.

-- ------------------------------------------------------------------
-- Waybills record what did not arrive
-- ------------------------------------------------------------------
alter table public.waybill_items
  add column if not exists qty_received integer,
  add column if not exists qty_damaged integer not null default 0,
  add column if not exists qty_short integer not null default 0;

alter table public.waybill_items
  drop constraint if exists waybill_items_damage_sane;
alter table public.waybill_items
  add constraint waybill_items_damage_sane
  check (qty_damaged >= 0 and qty_short >= 0 and qty_damaged + qty_short <= quantity);

comment on column public.waybill_items.qty_short is
  'What was on the waybill and not in the vehicle. The number the '
  'document exists to make somebody account for.';

-- Signing for a delivery, line by line.
create or replace function public.receive_waybill(
  p_waybill_id  uuid,
  p_received_by text,
  p_lines       jsonb default '[]'::jsonb
)
returns public.waybills
language plpgsql
security definer
set search_path = public
as $$
declare
  waybill public.waybills;
  item    record;
  damaged integer;
  short   integer;
begin
  perform public.require_role('admin', 'senior_manager', 'manager', 'warehouse');

  select * into waybill from public.waybills where id = p_waybill_id for update;
  if not found then
    raise exception 'Waybill % not found', p_waybill_id;
  end if;

  if auth.uid() is not null and waybill.org_id is distinct from public.auth_org_id() then
    raise exception 'Waybill % not found', p_waybill_id using errcode = '42501';
  end if;

  if waybill.status <> 'issued' then
    raise exception 'Waybill % is % and is not out for delivery',
      waybill.waybill_number, waybill.status;
  end if;

  if p_received_by is null or length(trim(p_received_by)) = 0 then
    raise exception 'Record who signed for the goods';
  end if;

  for item in select * from public.waybill_items where waybill_id = p_waybill_id loop
    select
      coalesce((l ->> 'damaged')::integer, 0),
      coalesce((l ->> 'short')::integer, 0)
      into damaged, short
      from jsonb_array_elements(p_lines) as l
     where (l ->> 'item_id')::uuid = item.id
     limit 1;

    damaged := coalesce(damaged, 0);
    short   := coalesce(short, 0);

    if damaged + short > item.quantity then
      raise exception
        'More was reported damaged or missing than was on the waybill: % against %',
        damaged + short, item.quantity;
    end if;

    update public.waybill_items
       set qty_damaged = damaged,
           qty_short = short,
           qty_received = item.quantity - damaged - short
     where id = item.id;
  end loop;

  update public.waybills
     set status = 'delivered', delivered_at = now(), received_by = trim(p_received_by),
         updated_at = now()
   where id = p_waybill_id
  returning * into waybill;

  return waybill;
end;
$$;

comment on function public.receive_waybill is
  'Sign a waybill in, recording what was damaged and what never turned '
  'up. Stock is not moved here: a waybill evidences a movement that a '
  'van load or a transfer already made.';

revoke all on function public.receive_waybill(uuid, text, jsonb) from public, anon;
grant execute on function public.receive_waybill(uuid, text, jsonb) to authenticated, service_role;

-- ------------------------------------------------------------------
-- Returns get a reason worth reporting on
-- ------------------------------------------------------------------
create type public.return_reason as enum (
  'damaged', 'expired', 'wrong_item', 'customer_return', 'unsold', 'other'
);

alter table public.van_return_items
  add column if not exists reason public.return_reason;

comment on column public.van_return_items.reason is
  'Why it came back. An enum rather than free text, because "damaged in '
  'the van" and "damaged on delivery" typed forty different ways cannot '
  'be counted.';

-- The existing free-text column stays: it is where the detail goes once
-- the reason above says which kind of detail it is.
comment on column public.van_return_items.damage_reason is
  'The detail behind the reason. What was wrong, not which category it '
  'falls into.';

-- ------------------------------------------------------------------
-- Returns that are not a van coming back
-- ------------------------------------------------------------------
--
-- Two other kinds of return exist and had nowhere to go: a customer
-- bringing goods back after a sale, and us sending goods back to a
-- supplier. Both move stock, and both were being recorded as
-- adjustments - which loses who returned what, and why.
create table if not exists public.stock_returns (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  return_number text not null default public.next_document_number('RTN', 'public.van_return_seq'),

  -- One of these, never both. A customer return comes in; a supplier
  -- return goes out.
  customer_id   uuid references public.customers(id) on delete restrict,
  supplier_id   uuid references public.suppliers(id) on delete restrict,
  warehouse_id  uuid not null references public.warehouses(id) on delete restrict,

  reason        public.return_reason not null,
  notes         text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),

  constraint stock_returns_one_party check (
    (customer_id is not null) <> (supplier_id is not null)
  )
);

comment on table public.stock_returns is
  'Goods coming back from a customer, or going back to a supplier. A van '
  'coming in at the end of a round is a van_return and stays there.';

create index if not exists stock_returns_org
  on public.stock_returns (org_id, created_at desc);

create table if not exists public.stock_return_items (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  return_id  uuid not null references public.stock_returns(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity   integer not null check (quantity > 0),
  notes      text,

  unique (return_id, product_id)
);

alter table public.stock_returns enable row level security;
alter table public.stock_return_items enable row level security;

drop policy if exists stock_returns_read on public.stock_returns;
create policy stock_returns_read on public.stock_returns
  for select using (org_id = public.auth_org_id());

drop policy if exists stock_returns_write on public.stock_returns;
create policy stock_returns_write on public.stock_returns
  for all using (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'warehouse')
  ) with check (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'warehouse')
  );

drop policy if exists stock_return_items_read on public.stock_return_items;
create policy stock_return_items_read on public.stock_return_items
  for select using (
    org_id = public.auth_org_id()
    and exists (select 1 from public.stock_returns r where r.id = stock_return_items.return_id)
  );

drop policy if exists stock_return_items_write on public.stock_return_items;
create policy stock_return_items_write on public.stock_return_items
  for all using (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'warehouse')
  ) with check (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'warehouse')
  );

grant select on public.stock_returns to authenticated;
grant select on public.stock_return_items to authenticated;
grant all on public.stock_returns to service_role;
grant all on public.stock_return_items to service_role;

-- Recording one, and moving the stock with it.
create or replace function public.record_stock_return(
  p_warehouse_id uuid,
  p_reason       public.return_reason,
  p_lines        jsonb,
  p_customer_id  uuid default null,
  p_supplier_id  uuid default null,
  p_notes        text default null
)
returns public.stock_returns
language plpgsql
security definer
set search_path = public
as $$
declare
  org       uuid;
  entry     public.stock_returns;
  line      jsonb;
  quantity  integer;
  product   uuid;
  available integer;
begin
  perform public.require_role('admin', 'senior_manager', 'manager', 'warehouse');

  if (p_customer_id is null) = (p_supplier_id is null) then
    raise exception 'A return is either from a customer or to a supplier, not both';
  end if;

  select org_id into org from public.warehouses where id = p_warehouse_id;
  if org is null then
    raise exception 'Warehouse % not found', p_warehouse_id;
  end if;

  if auth.uid() is not null and org is distinct from public.auth_org_id() then
    raise exception 'Warehouse % not found', p_warehouse_id using errcode = '42501';
  end if;

  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A return needs at least one line';
  end if;

  insert into public.stock_returns
    (org_id, customer_id, supplier_id, warehouse_id, reason, notes, created_by)
  values
    (org, p_customer_id, p_supplier_id, p_warehouse_id, p_reason,
     nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
  returning * into entry;

  for line in select * from jsonb_array_elements(p_lines) loop
    product  := (line ->> 'product_id')::uuid;
    quantity := (line ->> 'quantity')::integer;

    if product is null or quantity is null or quantity <= 0 then
      raise exception 'Every line needs a product and a quantity above zero';
    end if;

    insert into public.stock_return_items (org_id, return_id, product_id, quantity, notes)
    values (org, entry.id, product, quantity, nullif(trim(line ->> 'notes'), ''));

    if p_customer_id is not null then
      -- Goods coming back in. Damaged or expired stock is booked in and
      -- then written off separately, so the return and the write-off are
      -- two facts rather than one entry that hides the first.
      insert into public.stock_movements
        (org_id, product_id, warehouse_id, type, quantity,
         reference_type, reference_id, reason, created_by)
      values
        (org, product, p_warehouse_id, 'customer_return', quantity,
         'stock_return', entry.id, p_reason::text, auth.uid());
    else
      -- Going back to the supplier, so it has to be there to send.
      select coalesce(qty_available, 0) into available
        from public.inventory
       where product_id = product and warehouse_id = p_warehouse_id;

      if coalesce(available, 0) < quantity then
        raise exception
          'Cannot return % of that line to the supplier: only % on hand',
          quantity, coalesce(available, 0);
      end if;

      insert into public.stock_movements
        (org_id, product_id, warehouse_id, type, quantity,
         reference_type, reference_id, reason, created_by)
      values
        (org, product, p_warehouse_id, 'supplier_return', quantity,
         'stock_return', entry.id, p_reason::text, auth.uid());
    end if;
  end loop;

  return entry;
end;
$$;

comment on function public.record_stock_return is
  'A customer bringing goods back, or goods going back to a supplier. '
  'Moves the stock through the ledger rather than adjusting a quantity.';

revoke all on function public.record_stock_return(
  uuid, public.return_reason, jsonb, uuid, uuid, text) from public, anon;
grant execute on function public.record_stock_return(
  uuid, public.return_reason, jsonb, uuid, uuid, text) to authenticated, service_role;

create or replace view public.stock_return_summary
with (security_invoker = on) as
  select
    r.id,
    r.org_id,
    r.return_number,
    r.reason,
    r.created_at,
    r.notes,
    case when r.customer_id is not null then 'customer' else 'supplier' end as direction,
    coalesce(c.name, s.name)  as party_name,
    coalesce(c.code, s.code)  as party_code,
    w.name                    as warehouse_name,
    p.full_name               as recorded_by,
    count(i.id)               as line_count,
    coalesce(sum(i.quantity), 0) as total_quantity
  from public.stock_returns r
  join public.warehouses w on w.id = r.warehouse_id
  left join public.customers c on c.id = r.customer_id
  left join public.suppliers s on s.id = r.supplier_id
  left join public.profiles p on p.id = r.created_by
  left join public.stock_return_items i on i.return_id = r.id
  group by r.id, r.org_id, r.return_number, r.reason, r.created_at, r.notes,
           r.customer_id, c.name, c.code, s.name, s.code, w.name, p.full_name;

-- ------------------------------------------------------------------
-- Two more things the office should be told
-- ------------------------------------------------------------------

-- A delivery has been booked in against an order.
create or replace function public.notify_purchase_received()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  supplier text;
begin
  if new.status not in ('received', 'partially_received')
     or old.status is not distinct from new.status then
    return new;
  end if;

  select name into supplier from public.suppliers where id = new.supplier_id;

  perform public.notify(
    new.org_id, 'accountant', 'purchase.received',
    coalesce(supplier, 'A supplier') || ' delivery booked in',
    new.po_number || ' is now '
      || case when new.status = 'received' then 'fully received'
              else 'part received' end
      || '. Their invoice can be matched against it.',
    '/purchasing', 'info', 'purchase_order', new.id
  );

  return new;
end;
$$;

drop trigger if exists purchase_orders_notify_received on public.purchase_orders;
create trigger purchase_orders_notify_received
  after update on public.purchase_orders
  for each row execute function public.notify_purchase_received();

-- An offline operation came back from a device and could not be applied.
-- Guarded: sync_operations arrived in 0022, and a database that skipped
-- it should not fail this migration.
do $sync$
begin
  if to_regclass('public.sync_operations') is null then
    return;
  end if;

  execute $fn$
    create or replace function public.notify_sync_failed()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
      who text;
    begin
      if new.status <> 'failed' or old.status is not distinct from 'failed' then
        return new;
      end if;

      select full_name into who from public.profiles where id = new.profile_id;

      -- A driver whose sale did not apply believes it did. Somebody in
      -- the office has to find out before the customer is asked to pay
      -- twice, or never asked at all.
      perform public.notify(
        new.org_id, 'manager', 'sync.failed',
        'An offline operation from ' || coalesce(who, 'a driver') || ' failed',
        coalesce(new.error, 'It could not be applied.')
          || ' The device believes it was recorded.',
        '/driver/queue', 'critical', 'sync_operation', new.id
      );

      return new;
    end;
    $body$;
  $fn$;

  execute 'drop trigger if exists sync_operations_notify_failed on public.sync_operations';
  execute $trg$
    create trigger sync_operations_notify_failed
      after insert or update on public.sync_operations
      for each row execute function public.notify_sync_failed()
  $trg$;
end
$sync$;

-- ------------------------------------------------------------------
-- Redeeming a link now says which link it was
-- ------------------------------------------------------------------
--
-- submit_supplier_document() re-checks the link at the moment of
-- submission, which means it needs the link's id - and the version in
-- 0030 returned only the supplier and the organization. Replaced here
-- rather than edited there, so a database already at 0030 gets the
-- change by running this script.
--
-- The token id is not a secret: it identifies a row, not a credential,
-- and the digest is what actually opens anything.
drop function if exists public.resolve_supplier_token(text, inet, text);

create or replace function public.resolve_supplier_token(
  p_token_hash text,
  p_ip         inet default null,
  p_user_agent text default null
)
returns table (supplier_id uuid, org_id uuid, token_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  token   public.supplier_portal_tokens;
  recent  integer;
begin
  if p_ip is not null then
    select count(*) into recent
      from public.supplier_portal_attempts
     where request_ip = p_ip
       and not succeeded
       and attempted_at > now() - interval '15 minutes';

    if recent >= 10 then
      insert into public.supplier_portal_attempts (request_ip, user_agent, succeeded)
      values (p_ip, p_user_agent, false);
      return;
    end if;
  end if;

  select * into token
    from public.supplier_portal_tokens t
   where t.token_hash = p_token_hash
     and t.revoked_at is null
     and t.expires_at > now();

  if not found then
    insert into public.supplier_portal_attempts (request_ip, user_agent, succeeded)
    values (p_ip, p_user_agent, false);
    return;
  end if;

  update public.supplier_portal_tokens
     set last_used_at = now(), use_count = use_count + 1
   where id = token.id;

  insert into public.supplier_portal_attempts (request_ip, user_agent, succeeded, token_id)
  values (p_ip, p_user_agent, true, token.id);

  return query select token.supplier_id, token.org_id, token.id, token.expires_at;
end;
$$;

comment on function public.resolve_supplier_token is
  'Exchange a link digest for the supplier it belongs to. Returns '
  'nothing for a link that is unknown, expired, revoked or rate '
  'limited - the holder is not told which.';

revoke all on function public.resolve_supplier_token(text, inet, text)
  from public, anon, authenticated;
grant execute on function public.resolve_supplier_token(text, inet, text) to service_role;


-- ------------------------------------------------------------------
-- The office view carries the review state
-- ------------------------------------------------------------------
--
-- Appended rather than reordered: `create or replace view` refuses to
-- rename or reorder an existing column, so the new ones go on the end.
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
    d.created_at,
    d.status,
    d.submitted_company,
    d.submitted_by_name,
    d.submitted_at,
    r.full_name as reviewed_by_name,
    d.reviewed_at,
    d.review_note
  from public.supplier_documents d
  join public.suppliers s on s.id = d.supplier_id
  left join public.purchase_orders po on po.id = d.purchase_order_id
  left join public.profiles p on p.id = d.uploaded_by
  left join public.profiles r on r.id = d.reviewed_by;
