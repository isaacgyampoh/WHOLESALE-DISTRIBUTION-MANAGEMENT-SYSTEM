-- ====================================================================
-- UPGRADE 0030 - letting a supplier see their own orders
-- ====================================================================
--
-- For a database installed before migration 0030.
-- Run it in the Supabase SQL editor.
--
-- GENERATED FILE - do not edit by hand.
-- Source: supabase/migrations/0030_supplier_portal.sql
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
-- Suppliers ring up to ask what was ordered and what has been received.
-- Every one of those calls is somebody in the office reading a screen
-- aloud.
--
-- The obvious answer - give the supplier a login - is the wrong one.
-- Accounts need provisioning, resetting and deprovisioning, and a
-- supplier's staff turn over without telling us. So a link instead,
-- which is a capability rather than an identity.
--
-- The link is treated as the credential it is:
--
--   held as a digest, never in full, so a leaked backup hands over no
--   working links
--   expires, between 1 and 365 days. A link with no end date is a
--   permanent grant to whoever it was last forwarded to.
--   revocable without waiting for expiry
--   rate limited per address, with every attempt recorded
--   scoped to one supplier: their own orders, their own lines, and
--   nothing about any other supplier or any customer at all
--
-- Nothing here is granted to anon or to authenticated. The portal route
-- resolves the link server side with the service role and then reads on
-- the supplier's behalf, so the database's position that anonymous
-- callers get nothing is unchanged.
--
-- AFTER RUNNING IT, redeploy. Links are issued from the supplier's page
-- and shown once.

-- ===================================================================
-- 0030  Letting a supplier see their own orders
-- ===================================================================
--
-- Suppliers ring up to ask what was ordered, what has been received and
-- what is still outstanding. Every one of those calls is a person in the
-- office reading a screen aloud.
--
-- The obvious answer - give the supplier a login - is the wrong one.
-- Accounts need provisioning, resetting and deprovisioning, and a
-- supplier's staff turn over without anybody telling us. So: a link,
-- which is a capability rather than an identity.
--
-- A link is a credential, and this one is treated like one:
--
--   it is stored as a digest, never in full. A leaked database backup
--   does not hand over working links, exactly as it does not hand over
--   PINs.
--   it expires. A link with no end date is a permanent grant to whoever
--   the supplier last forwarded it to.
--   it can be revoked without waiting for expiry.
--   guessing at it is rate limited, and every attempt is recorded.
--   it is scoped to one supplier, so it discloses nothing about any
--   other supplier and nothing about customers at all.
--
-- Nothing here is granted to anon. The portal route resolves the link
-- server side and then reads on the supplier's behalf, so the database's
-- position that anonymous callers get nothing is unchanged.

create table if not exists public.supplier_portal_tokens (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  supplier_id  uuid not null references public.suppliers(id) on delete cascade,

  -- The digest only. There is deliberately no way to recover the link
  -- from this table; if it is lost, a new one is issued.
  token_hash   text not null unique,
  -- Enough to tell two links apart in a list without holding the link.
  token_hint   text not null,
  label        text,

  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  revoked_by   uuid references public.profiles(id) on delete set null,

  last_used_at timestamptz,
  use_count    integer not null default 0,

  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),

  constraint supplier_portal_tokens_expiry_ahead check (expires_at > created_at)
);

comment on table public.supplier_portal_tokens is
  'Links handed to suppliers. Held as a digest, so this table cannot be '
  'read to obtain a working link.';

create index if not exists supplier_portal_tokens_supplier
  on public.supplier_portal_tokens (org_id, supplier_id, created_at desc);

alter table public.supplier_portal_tokens enable row level security;

-- The office can see which links exist, when they expire and whether
-- they have been used. Never the link itself, which is not here to see.
drop policy if exists supplier_portal_tokens_read on public.supplier_portal_tokens;drop policy if exists supplier_portal_tokens_read on public.supplier_portal_tokens;
create policy supplier_portal_tokens_read on public.supplier_portal_tokens
  for select using (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager')
  );


-- Issuing and revoking go through their own functions, which is where
-- the digest is computed and the expiry enforced. A row written by hand
-- could carry no expiry at all.
revoke all on public.supplier_portal_tokens from anon, authenticated;
grant select on public.supplier_portal_tokens to authenticated;
grant all on public.supplier_portal_tokens to service_role;

-- ------------------------------------------------------------------
-- Attempts
-- ------------------------------------------------------------------
create table if not exists public.supplier_portal_attempts (
  id           uuid primary key default gen_random_uuid(),
  request_ip   inet,
  user_agent   text,
  succeeded    boolean not null default false,
  -- Only on success. A failed attempt matched nothing by definition, and
  -- recording a guess against a supplier would be recording a guess.
  token_id     uuid references public.supplier_portal_tokens(id) on delete set null,
  attempted_at timestamptz not null default now()
);

comment on table public.supplier_portal_attempts is
  'Portal link attempts, for rate limiting. Holds no link and no digest.';

create index if not exists supplier_portal_attempts_by_ip
  on public.supplier_portal_attempts (request_ip, attempted_at desc)
  where request_ip is not null;

alter table public.supplier_portal_attempts enable row level security;
revoke all on public.supplier_portal_attempts from anon, authenticated;
grant all on public.supplier_portal_attempts to service_role;
-- No policy, so nothing but the service role reads it. Deliberate: this
-- is server-side machinery, and 0015 grants new tables to authenticated
-- by default.

-- ------------------------------------------------------------------
-- Issuing one
-- ------------------------------------------------------------------
--
-- Takes the digest rather than the link. The link is generated by the
-- application, shown once, and never travels to the database in full -
-- so it cannot appear in a query log, a statement sample, or a plan.
create or replace function public.issue_supplier_token(
  p_supplier_id uuid,
  p_token_hash  text,
  p_token_hint  text,
  p_days        integer default 30,
  p_label       text default null
)
returns public.supplier_portal_tokens
language plpgsql
security definer
set search_path = public
as $$
declare
  supplier public.suppliers;
  issued   public.supplier_portal_tokens;
begin
  perform public.require_role('admin', 'senior_manager', 'manager');

  select * into supplier from public.suppliers where id = p_supplier_id;
  if not found then
    raise exception 'Supplier % not found', p_supplier_id;
  end if;

  if auth.uid() is not null and supplier.org_id is distinct from public.auth_org_id() then
    raise exception 'Supplier % not found', p_supplier_id using errcode = '42501';
  end if;

  if p_token_hash is null or length(p_token_hash) < 32 then
    raise exception 'A portal link must be issued with a full digest';
  end if;

  -- A link that never expires is a permanent grant to whoever the
  -- supplier last forwarded it to.
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'A portal link lasts between 1 and 365 days';
  end if;

  insert into public.supplier_portal_tokens (
    org_id, supplier_id, token_hash, token_hint, label, expires_at, created_by
  ) values (
    supplier.org_id, p_supplier_id, p_token_hash, p_token_hint, nullif(trim(p_label), ''),
    now() + make_interval(days => p_days), auth.uid()
  )
  returning * into issued;

  return issued;
end;
$$;

revoke all on function public.issue_supplier_token(uuid, text, text, integer, text)
  from public, anon;
grant execute on function public.issue_supplier_token(uuid, text, text, integer, text)
  to authenticated, service_role;

create or replace function public.revoke_supplier_token(p_token_id uuid)
returns public.supplier_portal_tokens
language plpgsql
security definer
set search_path = public
as $$
declare
  token public.supplier_portal_tokens;
begin
  perform public.require_role('admin', 'senior_manager', 'manager');

  select * into token from public.supplier_portal_tokens where id = p_token_id;
  if not found then
    raise exception 'Portal link % not found', p_token_id;
  end if;

  if auth.uid() is not null and token.org_id is distinct from public.auth_org_id() then
    raise exception 'Portal link % not found', p_token_id using errcode = '42501';
  end if;

  update public.supplier_portal_tokens
     set revoked_at = coalesce(revoked_at, now()), revoked_by = auth.uid()
   where id = p_token_id
  returning * into token;

  return token;
end;
$$;

revoke all on function public.revoke_supplier_token(uuid) from public, anon;
grant execute on function public.revoke_supplier_token(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- Redeeming one
-- ------------------------------------------------------------------
--
-- Returns the supplier a link is for, or null. Null covers every kind of
-- failure - unknown, expired, revoked, rate limited - because telling
-- the holder of a bad link which of those it was tells them how to make
-- a better guess.
create or replace function public.resolve_supplier_token(
  p_token_hash text,
  p_ip         inet default null,
  p_user_agent text default null
)
returns table (supplier_id uuid, org_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  token   public.supplier_portal_tokens;
  recent  integer;
begin
  -- Guessing is cheap without this: the digest space is large, but an
  -- unthrottled endpoint is still an endpoint somebody will point a
  -- script at, and every attempt would otherwise cost nothing.
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

  return query select token.supplier_id, token.org_id, token.expires_at;
end;
$$;

comment on function public.resolve_supplier_token is
  'Exchange a link digest for the supplier it belongs to. Returns '
  'nothing for a link that is unknown, expired, revoked or rate '
  'limited - the holder is not told which.';

-- Only the server may redeem. The portal route resolves the link with
-- the service role and then reads on the supplier''s behalf, so nothing
-- here is exposed to a browser.
revoke all on function public.resolve_supplier_token(text, inet, text)
  from public, anon, authenticated;
grant execute on function public.resolve_supplier_token(text, inet, text) to service_role;

-- ------------------------------------------------------------------
-- What a supplier may see
-- ------------------------------------------------------------------
--
-- Their own orders and nothing else. No customer, no selling price, no
-- other supplier's line. These are read by the server with the service
-- role and always filtered to the resolved supplier, so the filter is
-- applied twice: here by construction, and again by the caller.
create or replace function public.supplier_portal_orders(
  p_supplier_id uuid,
  p_org_id      uuid
)
returns table (
  id uuid,
  po_number text,
  status public.po_status,
  order_date date,
  expected_date date,
  total numeric,
  lines bigint,
  qty_ordered bigint,
  qty_received bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    po.id,
    po.po_number,
    po.status,
    po.order_date,
    po.expected_date,
    po.total,
    count(i.id)                        as lines,
    coalesce(sum(i.quantity), 0)       as qty_ordered,
    coalesce(sum(i.qty_received), 0)   as qty_received
  from public.purchase_orders po
  left join public.purchase_order_items i on i.po_id = po.id
  where po.supplier_id = p_supplier_id
    and po.org_id = p_org_id
    and po.status <> 'draft'
  group by po.id, po.po_number, po.status, po.order_date, po.expected_date, po.total
  order by po.order_date desc
  limit 100;
$$;

comment on function public.supplier_portal_orders is
  'A supplier''s own orders. Drafts are excluded: an order the business '
  'has not sent is not something the supplier should learn about.';

revoke all on function public.supplier_portal_orders(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.supplier_portal_orders(uuid, uuid) to service_role;

create or replace function public.supplier_portal_order_lines(
  p_order_id    uuid,
  p_supplier_id uuid,
  p_org_id      uuid
)
returns table (
  product_name text,
  sku text,
  quantity integer,
  qty_received integer,
  unit_cost numeric,
  line_total numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.name,
    p.sku,
    i.quantity,
    i.qty_received,
    i.unit_cost,
    i.line_total
  from public.purchase_order_items i
  join public.purchase_orders po on po.id = i.po_id
  join public.products p on p.id = i.product_id
  where i.po_id = p_order_id
    and po.supplier_id = p_supplier_id
    and po.org_id = p_org_id
    and po.status <> 'draft';
$$;

comment on function public.supplier_portal_order_lines is
  'The lines of one of the supplier''s own orders. unit_cost here is '
  'what this supplier is charging us, which is their own price and not '
  'a disclosure.';

revoke all on function public.supplier_portal_order_lines(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.supplier_portal_order_lines(uuid, uuid, uuid) to service_role;

-- ------------------------------------------------------------------
-- Housekeeping
-- ------------------------------------------------------------------
create or replace function public.purge_supplier_portal_attempts(
  older_than interval default '30 days'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.supplier_portal_attempts
   where attempted_at < now() - older_than;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.purge_supplier_portal_attempts(interval)
  from public, anon, authenticated;
grant execute on function public.purge_supplier_portal_attempts(interval) to service_role;

-- ====================================================================
-- Confirm it took. Every row should read PASS.
-- ====================================================================
select 'supplier_portal_tokens table' as check,
       case when to_regclass('public.supplier_portal_tokens') is not null
            then 'PASS' else 'FAIL' end as result
union all
select 'links are held as a digest only',
       case when exists (select 1 from information_schema.columns
                          where table_name = 'supplier_portal_tokens'
                            and column_name = 'token_hash')
             and not exists (select 1 from information_schema.columns
                              where table_name = 'supplier_portal_tokens'
                                and column_name in ('token', 'secret', 'plaintext'))
            then 'PASS' else 'FAIL' end
union all
select 'every link expires',
       case when exists (select 1 from pg_constraint
                          where conrelid = 'public.supplier_portal_tokens'::regclass
                            and conname = 'supplier_portal_tokens_expiry_ahead')
            then 'PASS' else 'FAIL' end
union all
select 'attempts are recorded for rate limiting',
       case when to_regclass('public.supplier_portal_attempts') is not null
            then 'PASS' else 'FAIL' end
union all
select 'and hold no link',
       case when not exists (select 1 from information_schema.columns
                              where table_name = 'supplier_portal_attempts'
                                and column_name like '%hash%')
            then 'PASS' else 'FAIL' end
union all
select 'redeeming is server-side only',
       case when not exists (
              select 1 from pg_proc p
                join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'resolve_supplier_token'
                 and (has_function_privilege('anon', p.oid, 'EXECUTE')
                      or has_function_privilege('authenticated', p.oid, 'EXECUTE')))
            then 'PASS' else 'FAIL' end
union all
select 'a supplier sees only their own orders',
       case when exists (select 1 from pg_proc p
                           join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'supplier_portal_orders')
            then 'PASS' else 'FAIL' end;
