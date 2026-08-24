-- ===================================================================
-- 0041  A receipt the customer can actually open
-- ===================================================================
--
-- Receipts existed, and no customer had ever seen one.
--
-- A sale produced a page inside the application, and the only way to
-- hand it over was the printer - which a salesperson standing in a yard
-- does not have. The share button shared the page's own URL, and its
-- own comment admitted the problem: anybody opening it has to be signed
-- in, so a receipt forwarded to a customer showed them a sign-in screen.
--
-- What follows is the same shape as the supplier portal, which has been
-- carrying outside visitors safely since 0030: a long random string that
-- exists only in the message it was sent in, its digest stored here, and
-- a SECURITY DEFINER function that trades the digest for exactly one
-- receipt and nothing else.
--
-- WHAT A TOKEN CAN REACH
--
-- One receipt. Not a customer, not their other purchases, not a list.
-- resolve_receipt_token takes a digest and returns a single document,
-- assembled here rather than in the application, so no query written
-- later can widen it by accident.
--
-- WHAT IS DELIBERATELY NOT IN THE DOCUMENT
--
-- Cost price, margin, supplier, internal ids, the van, the load, the
-- organization's id. A receipt is what the customer already knows -
-- what they bought, what they paid, what they still owe - and the
-- assembly below selects those columns and no others.

-- ------------------------------------------------------------------
-- Receipt numbers
-- ------------------------------------------------------------------
--
-- A sale already has a sale_number. A credit payment has nothing a
-- customer could quote back, so receipts get their own series. Shared
-- by both kinds, so "RCP-000412" means one document.
create sequence if not exists public.receipt_number_seq;

create or replace function public.next_receipt_number()
returns text
language sql
volatile
as $$
  select 'RCP-' || to_char(now(), 'YYYY') || '-' ||
         lpad(nextval('public.receipt_number_seq')::text, 6, '0');
$$;

comment on function public.next_receipt_number() is
  'RCP-2026-000123. One series for sales and credit payments alike, so '
  'a number a customer reads out identifies one document.';

-- ------------------------------------------------------------------
-- The tokens
-- ------------------------------------------------------------------
create table if not exists public.receipt_tokens (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete restrict,

  -- What this receipt is for. Not a foreign key, because it points at
  -- one of two tables; the issuing function checks the row exists and
  -- belongs to the organization before writing anything.
  subject_type   text not null check (subject_type in ('sale', 'credit_payment')),
  subject_id     uuid not null,

  receipt_number text not null unique default public.next_receipt_number(),

  -- Only ever the digest. The link itself exists in the message it was
  -- sent in and nowhere else, so a copy of this table is not a set of
  -- working links.
  token_hash     text not null unique,
  -- First few characters, so staff can tell two links apart in a list
  -- without the table holding anything that opens one.
  token_hint     text not null,

  -- Where it was sent. E.164, normalised by the application. Kept here
  -- rather than on van_sales because it belongs to the delivery of the
  -- receipt, not to the money: a walk-in gives a number for the receipt
  -- without becoming a customer record.
  customer_phone text,

  issued_by      uuid references public.profiles(id) on delete set null,
  expires_at     timestamptz not null,
  revoked_at     timestamptz,
  created_at     timestamptz not null default now(),

  -- So somebody can answer "did they ever open it?" when a customer
  -- says they never got it.
  last_viewed_at timestamptz,
  view_count     integer not null default 0
);

comment on table public.receipt_tokens is
  'One unguessable link per receipt, for sending to a customer over '
  'WhatsApp. Holds the digest, never the link.';

-- The question every view asks.
create index if not exists receipt_tokens_subject
  on public.receipt_tokens (subject_type, subject_id, created_at desc);

create index if not exists receipt_tokens_org_time
  on public.receipt_tokens (org_id, created_at desc);

alter table public.receipt_tokens enable row level security;

-- Staff see their own organization's; nobody signed out sees any. The
-- customer's route in is the resolver below, which runs as its owner
-- and never consults these policies.
drop policy if exists receipt_tokens_select on public.receipt_tokens;
create policy receipt_tokens_select on public.receipt_tokens
  for select to authenticated
  using (org_id = public.auth_org_id());

-- Written only through issue_receipt_token, which checks the subject.
revoke insert, update, delete on public.receipt_tokens from authenticated, anon;
grant select on public.receipt_tokens to authenticated;

-- ------------------------------------------------------------------
-- Issuing
-- ------------------------------------------------------------------
create or replace function public.issue_receipt_token(
  p_subject_type text,
  p_subject_id   uuid,
  p_token_hash   text,
  p_token_hint   text,
  p_phone        text default null,
  p_days         integer default 180
)
returns public.receipt_tokens
language plpgsql
security definer
set search_path = public
as $$
declare
  subject_org uuid;
  issued      public.receipt_tokens;
begin
  perform public.require_role(
    'admin', 'senior_manager', 'manager', 'accountant', 'salesperson', 'driver');

  if p_subject_type not in ('sale', 'credit_payment') then
    raise exception 'Unknown receipt subject %', p_subject_type;
  end if;

  -- The subject must exist and be ours. Without this, a caller could
  -- mint a working link to another organization's sale by id.
  if p_subject_type = 'sale' then
    select org_id into subject_org from public.van_sales where id = p_subject_id;
  else
    select org_id into subject_org from public.credit_transactions where id = p_subject_id;
  end if;

  if subject_org is null then
    raise exception 'No such transaction %', p_subject_id;
  end if;

  if auth.uid() is not null and subject_org is distinct from public.auth_org_id() then
    raise exception 'No such transaction %', p_subject_id using errcode = '42501';
  end if;

  if p_days < 1 or p_days > 3650 then
    raise exception 'A receipt link lasts between 1 and 3650 days';
  end if;

  insert into public.receipt_tokens
    (org_id, subject_type, subject_id, token_hash, token_hint,
     customer_phone, issued_by, expires_at)
  values
    (subject_org, p_subject_type, p_subject_id, p_token_hash, p_token_hint,
     nullif(trim(coalesce(p_phone, '')), ''), auth.uid(), now() + make_interval(days => p_days))
  returning * into issued;

  return issued;
end;
$$;

comment on function public.issue_receipt_token(text, uuid, text, text, text, integer) is
  'Mint a customer-facing link for one sale or credit payment. Refuses '
  'a subject belonging to another organization.';

revoke all on function public.issue_receipt_token(text, uuid, text, text, text, integer)
  from public, anon;
grant execute on function public.issue_receipt_token(text, uuid, text, text, text, integer)
  to authenticated;

-- ------------------------------------------------------------------
-- Redeeming
-- ------------------------------------------------------------------
--
-- The whole document, assembled here. The application receives a
-- finished receipt and has no query of its own to widen.
create or replace function public.resolve_receipt_token(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tok      public.receipt_tokens;
  doc      jsonb;
  org_name text;
begin
  select * into tok
    from public.receipt_tokens
   where token_hash = p_token_hash
     and revoked_at is null
     and expires_at > now();

  -- Null for unknown, expired and revoked alike. Telling the holder of
  -- a bad link which it was tells them how to make a better guess.
  if tok.id is null then
    return null;
  end if;

  update public.receipt_tokens
     set view_count = view_count + 1, last_viewed_at = now()
   where id = tok.id;

  select name into org_name from public.organizations where id = tok.org_id;

  if tok.subject_type = 'sale' then
    select jsonb_build_object(
      'kind',           'sale',
      'receiptNumber',  tok.receipt_number,
      'reference',      s.sale_number,
      'issuedAt',       s.sold_at,
      'organization',   org_name,
      'customerName',   c.name,
      'customerPhone',  tok.customer_phone,
      'servedBy',       coalesce(sp.full_name, dr.full_name),
      'saleType',       s.sale_type,
      'status',         s.status,
      'subtotal',       s.subtotal,
      'taxTotal',       s.tax_total,
      'total',          s.total,
      'amountPaid',     s.amount_paid,
      'balance',        s.balance,
      'dueDate',        s.due_date,
      'items',          coalesce((
        select jsonb_agg(jsonb_build_object(
                 'name',      p.name,
                 'sku',       p.sku,
                 'quantity',  i.quantity,
                 'unitPrice', i.unit_price,
                 'lineTotal', i.line_total)
               order by p.name)
          from public.van_sale_items i
          join public.products p on p.id = i.product_id
         where i.sale_id = s.id), '[]'::jsonb),
      'payments',       coalesce((
        select jsonb_agg(jsonb_build_object(
                 'method',    pay.method,
                 'amount',    pay.amount,
                 'provider',  pay.provider,
                 'reference', pay.reference)
               order by pay.created_at)
          from public.van_sale_payments pay
         where pay.sale_id = s.id), '[]'::jsonb)
    )
    into doc
    from public.van_sales s
    join public.customers c on c.id = s.customer_id
    left join public.profiles sp on sp.id = s.salesperson_id
    left join public.profiles dr on dr.id = s.driver_id
   where s.id = tok.subject_id;

  else
    -- A credit payment. The two figures the customer wants are what
    -- they owed and what they owe now, so both are computed here rather
    -- than left to the caller to get right.
    select jsonb_build_object(
      'kind',            'credit_payment',
      'receiptNumber',   tok.receipt_number,
      'reference',       null,
      'issuedAt',        t.occurred_at,
      'organization',    org_name,
      'customerName',    c.name,
      'customerPhone',   tok.customer_phone,
      'servedBy',        col.full_name,
      'method',          t.reference_type,
      'amount',          abs(t.amount),
      'notes',           t.notes,
      -- The ledger is signed: charges positive, payments negative. The
      -- balance after this payment is everything up to and including it.
      'balanceAfter',    coalesce((
        select sum(x.amount) from public.credit_transactions x
         where x.customer_id = t.customer_id
           and (x.occurred_at < t.occurred_at
                or (x.occurred_at = t.occurred_at and x.id <= t.id))), 0),
      'balanceBefore',   coalesce((
        select sum(x.amount) from public.credit_transactions x
         where x.customer_id = t.customer_id
           and (x.occurred_at < t.occurred_at
                or (x.occurred_at = t.occurred_at and x.id < t.id))), 0)
    )
    into doc
    from public.credit_transactions t
    join public.customers c on c.id = t.customer_id
    left join public.profiles col on col.id = t.created_by
   where t.id = tok.subject_id;
  end if;

  return doc;
end;
$$;

comment on function public.resolve_receipt_token(text) is
  'Trade a link digest for exactly one receipt. Carries no cost price, '
  'no margin, no supplier and no internal identifiers.';

-- Only the server calls this, holding the service role, the same way
-- the supplier portal resolves its links.
revoke all on function public.resolve_receipt_token(text) from public, anon, authenticated;
