-- ====================================================================
-- UPGRADE 0028 - telling people what needs them
-- ====================================================================
--
-- For a database installed before migration 0028.
-- Run it in the Supabase SQL editor.
--
-- GENERATED FILE - do not edit by hand.
-- Source: supabase/migrations/0028_notifications.sql
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
-- Everything the system knows was already on a screen somewhere, which
-- is the problem: a reconciliation submitted at seven in the evening
-- sits on the reconciliation screen, and nobody opens that screen
-- unless they already suspect something is on it.
--
-- Two things get called a notification and they behave differently, so
-- both are here rather than one pretending to be the other:
--
--   an EVENT happened once and stays true - a driver closed their day,
--   a transfer is waiting for approval. Written by trigger when it
--   happens, and marked read by a person.
--
--   a CONDITION is true until it is not - stock below reorder, an
--   invoice past due. Nobody reads one of these away; it ends when the
--   stock is replenished or the invoice is paid.
--
-- Conditions are refreshed rather than appended: one row per subject,
-- updated in place and cleared when the condition stops. So there is no
-- scheduler to install - refresh_standing_alerts() is called by the
-- dashboard, which is where somebody is about to read the answer.
--
-- Notifications are addressed to a job rather than to a person, because
-- 'a transfer needs approving' is for whoever is managing today and not
-- for one named manager who might be on leave. Each role sees only what
-- is addressed to it, and nobody can write one: a notification a
-- browser could insert is a way to report something that did not
-- happen.
--
-- AFTER RUNNING IT, redeploy. The bell appears only once this is in
-- place.

do $enum$
declare
  found text[];
  wanted text[] := array['info', 'warning', 'critical'];
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'notification_severity'
  ) then
    create type public.notification_severity as enum ('info', 'warning', 'critical');
  else
    select array_agg(e.enumlabel order by e.enumsortorder) into found
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'notification_severity';

    -- Already correct: nothing to do, and the script carries on.
    if found is distinct from wanted then
      raise exception
        'public.notification_severity already exists with different values. Found %, expected %. '
        'Reconcile it before running this script; this script will not alter an '
        'enum other code may already depend on.',
        found, wanted;
    end if;
  end if;
end $enum$;


create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,

  -- Addressed to a person, or to whoever holds a role. Most of these are
  -- a job rather than a message: "a transfer needs approving" is for
  -- whoever is managing today, not for one named manager who might be on
  -- leave.
  recipient_id   uuid references public.profiles(id) on delete cascade,
  recipient_role public.user_role,

  kind         text not null,
  severity     public.notification_severity not null default 'info',
  title        text not null,
  body         text,
  -- Where to go to deal with it. A notification that does not lead
  -- anywhere makes the reader hunt for the screen.
  link         text,

  subject_type text,
  subject_id   uuid,

  -- Set for a condition, null for an event. A condition is refreshed in
  -- place; an event is only ever inserted.
  standing     boolean not null default false,
  resolved_at  timestamptz,

  read_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint notifications_has_an_audience
    check (recipient_id is not null or recipient_role is not null),
  constraint notifications_title_not_blank
    check (length(trim(title)) > 0)
);

comment on table public.notifications is
  'What needs somebody. Events are written once and read; conditions are '
  'refreshed while they hold and cleared when they stop.';

-- One standing row per subject per kind, so refreshing updates rather
-- than piles up. Events are excluded: two sales genuinely are two
-- notifications.
create unique index if not exists notifications_standing_unique
  on public.notifications (org_id, kind, coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where standing;

create index if not exists notifications_for_role
  on public.notifications (org_id, recipient_role, created_at desc)
  where resolved_at is null;

create index if not exists notifications_for_person
  on public.notifications (recipient_id, created_at desc)
  where resolved_at is null;

drop trigger if exists notifications_touch on public.notifications;drop trigger if exists notifications_touch on public.notifications;
create trigger notifications_touch
  before update on public.notifications
  for each row execute function public.set_updated_at();


alter table public.notifications enable row level security;

-- You see what is addressed to you, and what is addressed to your job.
drop policy if exists notifications_read on public.notifications;drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications
  for select using (
    org_id = public.auth_org_id()
    and (
      recipient_id = auth.uid()
      or (recipient_role is not null and public.has_role(recipient_role))
    )
  );


-- Marking one read is the only thing a person does to it. The content is
-- written by the database, never by a browser: a notification anybody
-- could insert is a way to tell a manager something that did not happen.
drop policy if exists notifications_mark_read on public.notifications;drop policy if exists notifications_mark_read on public.notifications;
create policy notifications_mark_read on public.notifications
  for update using (
    org_id = public.auth_org_id()
    and (
      recipient_id = auth.uid()
      or (recipient_role is not null and public.has_role(recipient_role))
    )
  ) with check (
    org_id = public.auth_org_id()
  );


revoke all on public.notifications from anon, authenticated;
grant select, update on public.notifications to authenticated;
grant all on public.notifications to service_role;

-- ------------------------------------------------------------------
-- Writing one
-- ------------------------------------------------------------------
create or replace function public.notify(
  p_org       uuid,
  p_role      public.user_role,
  p_kind      text,
  p_title     text,
  p_body      text default null,
  p_link      text default null,
  p_severity  public.notification_severity default 'info',
  p_subject_type text default null,
  p_subject_id   uuid default null,
  p_standing  boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing uuid;
begin
  if p_standing then
    -- A condition that is already flagged is updated, not repeated. The
    -- read mark is cleared only when the wording changes, so somebody
    -- who has seen "3 lines below reorder" is told again when it
    -- becomes 11.
    select id into existing
      from public.notifications
     where org_id = p_org and kind = p_kind and standing
       and coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_subject_id, '00000000-0000-0000-0000-000000000000'::uuid);

    if existing is not null then
      update public.notifications
         set title = p_title,
             body = p_body,
             severity = p_severity,
             link = p_link,
             recipient_role = p_role,
             resolved_at = null,
             read_at = case when title is distinct from p_title
                             or body is distinct from p_body
                            then null else read_at end,
             updated_at = now()
       where id = existing;
      return existing;
    end if;
  end if;

  insert into public.notifications (
    org_id, recipient_role, kind, severity, title, body, link,
    subject_type, subject_id, standing
  ) values (
    p_org, p_role, p_kind, p_severity, p_title, p_body, p_link,
    p_subject_type, p_subject_id, p_standing
  )
  returning id into existing;

  return existing;
end;
$$;

revoke all on function public.notify(uuid, public.user_role, text, text, text, text,
  public.notification_severity, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.notify(uuid, public.user_role, text, text, text, text,
  public.notification_severity, text, uuid, boolean) to service_role;

-- ------------------------------------------------------------------
-- Events
-- ------------------------------------------------------------------

-- A driver has closed their day and somebody has to check the money.
create or replace function public.notify_reconciliation_submitted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who text;
  variance numeric(14,2);
begin
  if new.status <> 'submitted' or old.status is not distinct from 'submitted' then
    return new;
  end if;

  select full_name into who from public.profiles where id = new.driver_id;
  variance := coalesce(new.cash_variance, 0);

  perform public.notify(
    new.org_id, 'manager', 'reconciliation.submitted',
    coalesce(who, 'A driver') || ' has closed their day',
    case
      when variance = 0 then 'Cash counted to the penny.'
      when variance < 0 then 'Short by ' || to_char(abs(variance), 'FM999,999,990.00') || ' cedi.'
      else 'Over by ' || to_char(variance, 'FM999,999,990.00') || ' cedi.'
    end,
    '/reconciliation',
    case when abs(variance) > 0 then 'warning' else 'info' end::public.notification_severity,
    'reconciliation', new.id
  );

  return new;
end;
$$;

drop trigger if exists reconciliations_notify on public.van_reconciliations;drop trigger if exists reconciliations_notify on public.van_reconciliations;
create trigger reconciliations_notify
  after insert or update on public.van_reconciliations
  for each row execute function public.notify_reconciliation_submitted();


-- Goods have come back off a van and need approving before they count.
create or replace function public.notify_return_submitted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who text;
begin
  if new.status <> 'submitted' or old.status is not distinct from 'submitted' then
    return new;
  end if;

  select p.full_name into who
    from public.van_loads l join public.profiles p on p.id = l.driver_id
   where l.id = new.load_id;

  perform public.notify(
    new.org_id, 'manager', 'return.submitted',
    'Goods returned from ' || coalesce(who, 'a round'),
    'Approve the return so the stock goes back on the warehouse.',
    '/returns', 'info', 'van_return', new.id
  );

  return new;
end;
$$;

drop trigger if exists van_returns_notify on public.van_returns;drop trigger if exists van_returns_notify on public.van_returns;
create trigger van_returns_notify
  after insert or update on public.van_returns
  for each row execute function public.notify_return_submitted();


-- A transfer is waiting on a manager, which is the whole reason the
-- approval step exists.
create or replace function public.notify_transfer_raised()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  src text;
  dst text;
begin
  if new.status <> 'draft' then
    return new;
  end if;

  select name into src from public.warehouses where id = new.from_warehouse_id;
  select name into dst from public.warehouses where id = new.to_warehouse_id;

  perform public.notify(
    new.org_id, 'manager', 'transfer.awaiting_approval',
    'Transfer ' || new.transfer_number || ' needs approval',
    coalesce(src, 'a warehouse') || ' to ' || coalesce(dst, 'another warehouse')
      || '. Nothing moves until it is approved.',
    '/transfers/' || new.id, 'info', 'stock_transfer', new.id
  );

  return new;
end;
$$;

drop trigger if exists stock_transfers_notify on public.stock_transfers;drop trigger if exists stock_transfers_notify on public.stock_transfers;
create trigger stock_transfers_notify
  after insert on public.stock_transfers
  for each row execute function public.notify_transfer_raised();


-- A transfer arrived with less on it than left. Somebody has to find out
-- where the rest went, and the moment it is booked in is when anyone
-- still remembers the delivery.
create or replace function public.notify_transfer_short()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  short integer;
begin
  if new.status <> 'received' or old.status is not distinct from 'received' then
    return new;
  end if;

  select coalesce(sum(quantity - coalesce(qty_received, quantity)), 0) into short
    from public.stock_transfer_items where transfer_id = new.id;

  if short <= 0 then
    return new;
  end if;

  perform public.notify(
    new.org_id, 'manager', 'transfer.short',
    'Transfer ' || new.transfer_number || ' arrived short',
    short || ' units left but were not counted in at the far end.',
    '/transfers/' || new.id, 'critical', 'stock_transfer', new.id
  );

  return new;
end;
$$;

drop trigger if exists stock_transfers_notify_short on public.stock_transfers;drop trigger if exists stock_transfers_notify_short on public.stock_transfers;
create trigger stock_transfers_notify_short
  after update on public.stock_transfers
  for each row execute function public.notify_transfer_short();


-- ------------------------------------------------------------------
-- Conditions
-- ------------------------------------------------------------------
--
-- Recomputed rather than accumulated. Called on the dashboard, which is
-- where somebody is about to read the result anyway, so no scheduler is
-- required for any of this to work.
create or replace function public.refresh_standing_alerts(p_org uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  org      uuid := coalesce(p_org, public.auth_org_id());
  low         integer;
  expiring    integer;
  expired     integer;
  overdue_n   integer;
  overdue_sum numeric(14,2);
  over_limit  integer;
  stale       integer;
  raised      integer := 0;
begin
  if org is null then
    return 0;
  end if;

  -- ---- stock below its reorder point ------------------------------
  select count(*) into low
    from public.stock_summary
   where org_id = org and is_active and needs_reorder and reorder_point > 0;

  if low > 0 then
    perform public.notify(
      org, 'warehouse', 'stock.low',
      low || ' product' || case when low = 1 then '' else 's' end || ' below reorder point',
      'Reordering now avoids selling from an empty warehouse next week.',
      '/inventory?stock=low_stock', 'warning', 'inventory', null, true);
    raised := raised + 1;
  else
    update public.notifications set resolved_at = now()
     where org_id = org and kind = 'stock.low' and standing and resolved_at is null;
  end if;

  -- ---- stock that is going off ------------------------------------
  -- Guarded: a database that has not had 0024 has no batches, and a
  -- missing table should degrade this function rather than break the
  -- dashboard that calls it.
  if to_regclass('public.batch_expiry_status') is not null then
    execute $q$
      select
        count(*) filter (where status = 'expiring'),
        count(*) filter (where status = 'expired')
      from public.batch_expiry_status
      where org_id = $1 and qty_remaining > 0
    $q$ into expiring, expired using org;

    if coalesce(expired, 0) > 0 then
      perform public.notify(
        org, 'warehouse', 'stock.expired',
        expired || ' batch' || case when expired = 1 then '' else 'es' end || ' already out of date',
        'Nothing expired may be loaded onto a van or transferred. Write it off.',
        '/inventory/expiry', 'critical', 'inventory', null, true);
      raised := raised + 1;
    else
      update public.notifications set resolved_at = now()
       where org_id = org and kind = 'stock.expired' and standing and resolved_at is null;
    end if;

    if coalesce(expiring, 0) > 0 then
      perform public.notify(
        org, 'warehouse', 'stock.expiring',
        expiring || ' batch' || case when expiring = 1 then '' else 'es' end || ' expiring soon',
        'Sell these first, or they become a write-off.',
        '/inventory/expiry', 'warning', 'inventory', null, true);
      raised := raised + 1;
    else
      update public.notifications set resolved_at = now()
       where org_id = org and kind = 'stock.expiring' and standing and resolved_at is null;
    end if;
  end if;

  -- ---- money that is late -----------------------------------------
  select count(*), coalesce(sum(balance), 0) into overdue_n, overdue_sum
    from public.invoices
   where org_id = org and status <> 'void' and balance > 0 and due_date < current_date;

  if overdue_n > 0 then
    perform public.notify(
      org, 'accountant', 'invoices.overdue',
      overdue_n || ' invoice' || case when overdue_n = 1 then '' else 's' end || ' past due',
      to_char(overdue_sum, 'FM999,999,990.00') || ' cedi outstanding beyond terms.',
      '/invoices?status=overdue', 'warning', 'invoices', null, true);
    raised := raised + 1;
  else
    update public.notifications set resolved_at = now()
     where org_id = org and kind = 'invoices.overdue' and standing and resolved_at is null;
  end if;

  -- ---- customers beyond what they are allowed ----------------------
  select count(*) into over_limit
    from public.customer_credit_position
   where org_id = org and credit_limit > 0 and ledger_balance > credit_limit;

  if over_limit > 0 then
    perform public.notify(
      org, 'manager', 'credit.over_limit',
      over_limit || ' customer' || case when over_limit = 1 then ' is' else 's are' end
        || ' over their credit limit',
      'Further credit sales to them will be refused at the point of sale.',
      '/customers?credit=over_limit', 'warning', 'customers', null, true);
    raised := raised + 1;
  else
    update public.notifications set resolved_at = now()
     where org_id = org and kind = 'credit.over_limit' and standing and resolved_at is null;
  end if;

  -- ---- goods that have been on the road too long -------------------
  if to_regclass('public.stock_in_transit') is not null then
    execute $q$
      select count(distinct transfer_id) from public.stock_in_transit
       where org_id = $1 and days_in_transit > 2
    $q$ into stale using org;

    if coalesce(stale, 0) > 0 then
      perform public.notify(
        org, 'warehouse', 'transfer.stale',
        stale || ' transfer' || case when stale = 1 then '' else 's' end
          || ' still in transit',
        'Stock that left more than two days ago and has not been booked in anywhere.',
        '/transfers?status=in_transit', 'warning', 'inventory', null, true);
      raised := raised + 1;
    else
      update public.notifications set resolved_at = now()
       where org_id = org and kind = 'transfer.stale' and standing and resolved_at is null;
    end if;
  end if;

  return raised;
end;
$$;

comment on function public.refresh_standing_alerts is
  'Recompute the conditions worth telling somebody about. Safe to call '
  'as often as a screen loads: a condition that still holds is updated '
  'in place, and one that has ended is cleared.';

revoke all on function public.refresh_standing_alerts(uuid) from public, anon;
grant execute on function public.refresh_standing_alerts(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- Reading them
-- ------------------------------------------------------------------
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  touched integer;
begin
  if auth.uid() is null then
    return 0;
  end if;

  update public.notifications
     set read_at = now(), updated_at = now()
   where org_id = public.auth_org_id()
     and read_at is null
     and resolved_at is null
     and (recipient_id = auth.uid()
          or (recipient_role is not null and public.has_role(recipient_role)))
     and (p_ids is null or id = any(p_ids));

  get diagnostics touched = row_count;
  return touched;
end;
$$;

comment on function public.mark_notifications_read is
  'Mark the caller''s own notifications read. Passing no ids marks '
  'everything they can currently see.';

revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated, service_role;

-- ====================================================================
-- Confirm it took. Every row should read PASS.
-- ====================================================================
select 'notifications table' as check,
       case when to_regclass('public.notifications') is not null
            then 'PASS' else 'FAIL' end as result
union all
select 'a condition is one row, not one a day',
       case when exists (select 1 from pg_indexes
                          where schemaname = 'public'
                            and indexname = 'notifications_standing_unique')
            then 'PASS' else 'FAIL' end
union all
select 'refresh_standing_alerts function',
       case when exists (select 1 from pg_proc p
                           join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'refresh_standing_alerts')
            then 'PASS' else 'FAIL' end
union all
select 'events are written by trigger',
       case when (select count(*) from pg_trigger
                   where tgname in ('reconciliations_notify','van_returns_notify',
                                    'stock_transfers_notify','stock_transfers_notify_short')) = 4
            then 'PASS' else 'FAIL' end
union all
select 'row level security on',
       case when (select relrowsecurity from pg_class
                   where oid = 'public.notifications'::regclass)
            then 'PASS' else 'FAIL' end
union all
select 'nobody writes their own',
       case when not exists (
              select 1 from information_schema.role_table_grants
               where table_name = 'notifications' and grantee = 'authenticated'
                 and privilege_type in ('INSERT','DELETE'))
            then 'PASS' else 'FAIL' end;
