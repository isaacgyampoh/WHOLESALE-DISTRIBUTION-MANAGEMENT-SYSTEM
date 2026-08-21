





-- =====================================================================
-- 0019_audit_log.sql
--
-- A record of who changed what about whom.
--
-- Append-only, in the same spirit as the stock ledger: an audit trail an
-- administrator can edit is not an audit trail. Updates and deletes are
-- refused by trigger and the privileges are withheld as well, so the
-- attempt fails before it is tried.
--
-- Secrets never enter it. A trigger strips known credential keys from
-- the before and after snapshots, so a careless caller cannot write a
-- PIN digest into the log by passing a whole row.
-- =====================================================================

create table public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete restrict,

  -- Who acted. The name is copied rather than joined so the entry still
  -- reads years later, after the actor's account has gone.
  actor_id     uuid references public.profiles (id) on delete set null,
  actor_name   text not null default '',
  actor_role   public.user_role,

  action       text not null,
  target_type  text not null,
  target_id    uuid,
  target_label text,

  -- Only the fields that changed, not whole rows.
  before       jsonb,
  after        jsonb,

  request_ip   inet,
  user_agent   text,
  occurred_at  timestamptz not null default now()
);

create index audit_log_org_time on public.audit_log (org_id, occurred_at desc);
create index audit_log_actor on public.audit_log (actor_id, occurred_at desc);
create index audit_log_target on public.audit_log (target_type, target_id, occurred_at desc);
create index audit_log_action on public.audit_log (action, occurred_at desc);

comment on table public.audit_log is
  'Append-only record of administrative actions. Never holds a PIN, a '
  'PIN digest or any other secret.';

-- ------------------------------------------------------- append only
create or replace function public.block_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only; history cannot be altered'
    using errcode = '42501';
end;
$$;

create trigger audit_log_no_update
  before update or delete on public.audit_log
  for each row execute function public.block_audit_mutation();

-- ------------------------------------------------ secrets never enter
create or replace function public.redact_audit_secrets()
returns trigger
language plpgsql
as $$
declare
  secret_keys text[] := array[
    'pin', 'pin_hash', 'pin_salt', 'password', 'token', 'secret',
    'api_key', 'service_role_key', 'code_hash'
  ];
  key text;
begin
  foreach key in array secret_keys loop
    if new.before ? key then new.before := new.before - key; end if;
    if new.after ? key then new.after := new.after - key; end if;
  end loop;
  return new;
end;
$$;

create trigger audit_log_redact
  before insert on public.audit_log
  for each row execute function public.redact_audit_secrets();

-- ------------------------------------------------------------ access
alter table public.audit_log enable row level security;

-- 0015 grants new tables to authenticated by default. Reading is right
-- for an administrator; writing never is, because entries come from
-- server actions running as the service role.
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
grant all on public.audit_log to service_role;

create policy audit_log_read on public.audit_log
  for select using (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager')
  );

-- No insert, update or delete policy for authenticated. Even with a
-- privilege granted by mistake, row level security would refuse.

-- GAB Premium Ent
-- Upgrade 0019: the audit trail.
-- For a database ALREADY INSTALLED at migration 0018.
--
-- WHAT IT ADDS
--   audit_log, an append-only record of administrative actions: who
--   changed what about whom, and when.
--
--   Updates and deletes are refused by trigger and the privileges are
--   withheld as well, so an administrator can read history and can never
--   author or alter it.
--
--   A trigger strips known credential keys from the stored snapshots, so
--   a careless caller cannot write a PIN digest into the log.
--
--   No business data is touched. No table is dropped.
--
-- HOW TO RUN
--   Supabase -> SQL Editor -> New query -> Ctrl+A in the file -> paste -> Run.
--   Then run VERIFY_DATABASE.sql and check the new rows read OK.
