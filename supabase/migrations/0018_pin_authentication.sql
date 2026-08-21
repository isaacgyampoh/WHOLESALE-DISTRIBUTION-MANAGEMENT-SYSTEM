-- =====================================================================
-- 0018_pin_authentication.sql
--
-- Four-digit PIN sign-in.
--
-- HOW THE PIN IS STORED
--   Never in the clear. What is kept is an HMAC-SHA256 of the PIN under
--   a secret held only in the server environment (PIN_PEPPER), so a copy
--   of this database is not enough to recover anyone's PIN.
--
--   The digest is deterministic, which two things depend on:
--   sign-in can find the account with one indexed lookup rather than
--   testing every user in turn, and the database itself can guarantee
--   that no two active people share a PIN.
--
-- WHY UNIQUENESS IS GLOBAL, NOT PER ORGANIZATION
--   The sign-in screen asks for nothing but the PIN, so at the moment of
--   lookup there is no organization to scope by. A PIN must therefore
--   resolve to exactly one active person across the whole system. Two
--   organizations cannot each hold PIN 1024.
--
--   Inactive accounts are excluded from the constraint, so a PIN becomes
--   free for reuse once someone leaves.
--
-- WHAT THIS DOES NOT CHANGE
--   Supabase still issues and holds the session. Row level security,
--   auth_role(), organization isolation, the role escalation guard and
--   the 0017 signup guard are untouched: this migration decides who is
--   asking, and everything after that works exactly as before.
-- =====================================================================

alter table public.profiles add column pin_hash text;
alter table public.profiles add column pin_set_at timestamptz;

comment on column public.profiles.pin_hash is
  'HMAC-SHA256 of the four-digit PIN under the server-side PIN_PEPPER. '
  'Deterministic so sign-in is a single indexed lookup and uniqueness is '
  'enforceable. Never a plaintext PIN.';

-- No two active people may share a PIN, or one PIN could not identify
-- one person. Enforced here rather than in application code so a race
-- between two administrators cannot slip a duplicate through.
create unique index profiles_active_pin_key
  on public.profiles (pin_hash)
  where pin_hash is not null and is_active;

-- A PIN is a credential, so only an administrator may set someone
-- else's. Changing your own is handled by a function that requires the
-- current PIN.
create or replace function public.guard_pin_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_trusted_context()
     and new.pin_hash is distinct from old.pin_hash
     and auth.uid() <> new.id
     and not public.has_role('admin', 'senior_manager') then
    raise exception 'Only an administrator may change another user''s PIN'
      using errcode = '42501';
  end if;

  if new.pin_hash is distinct from old.pin_hash then
    new.pin_set_at := now();
  end if;

  return new;
end;
$$;

create trigger profiles_guard_pin_change
  before update on public.profiles
  for each row execute function public.guard_pin_change();

-- ------------------------------------------------- brute force defence
-- Four digits is ten thousand possibilities, so unlimited guessing would
-- find someone's PIN quickly. Attempts are recorded and throttled.
create table public.auth_pin_attempts (
  id           uuid primary key default gen_random_uuid(),
  request_ip   inet,
  user_agent   text,
  succeeded    boolean not null default false,
  -- Only set on success. A failed attempt matched nobody by definition.
  profile_id   uuid references public.profiles (id) on delete set null,
  attempted_at timestamptz not null default now()
);

create index auth_pin_attempts_by_ip
  on public.auth_pin_attempts (request_ip, attempted_at desc)
  where request_ip is not null;
create index auth_pin_attempts_recent
  on public.auth_pin_attempts (attempted_at desc);

comment on table public.auth_pin_attempts is
  'Sign-in attempt log, for rate limiting. Holds no PIN and no digest.';

-- Server-side machinery. Nothing in the browser reads this, and 0015
-- granted new tables to authenticated by default, so that is withdrawn.
alter table public.auth_pin_attempts enable row level security;
revoke all on public.auth_pin_attempts from anon, authenticated;
grant all on public.auth_pin_attempts to service_role;

-- No policy: with row level security on and none defined, a caller who
-- somehow held a privilege still reads nothing. service_role bypasses
-- row level security and is the only intended reader.

create or replace function public.purge_old_pin_attempts(older_than interval default '7 days')
returns integer
language sql
volatile
security definer
set search_path = public
as $$
  with removed as (
    delete from public.auth_pin_attempts
    where attempted_at < now() - older_than
    returning 1
  )
  select count(*)::integer from removed;
$$;

revoke all on function public.purge_old_pin_attempts(interval) from public, anon, authenticated;
grant execute on function public.purge_old_pin_attempts(interval) to service_role;
