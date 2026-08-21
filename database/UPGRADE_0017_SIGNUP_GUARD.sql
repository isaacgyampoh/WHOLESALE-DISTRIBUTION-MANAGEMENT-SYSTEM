





-- Applied only if migration 0017 has not already run.
do $upgrade$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'email' and is_nullable = 'NO'
  ) then
    alter table public.profiles alter column email drop not null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'profiles_needs_an_identity'
  ) then
    alter table public.profiles
      add constraint profiles_needs_an_identity
      check (email is not null or phone is not null);
  end if;
end
$upgrade$;

create unique index if not exists profiles_org_phone_key
  on public.profiles (org_id, phone)
  where phone is not null;

-- ------------------------------------------------------- signup guard
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_org uuid;
  was_invited boolean;
begin
  -- An invitation is an org_id placed in user metadata by an
  -- administrator. Anything arriving without one is self-registration,
  -- whatever provider it came through.
  target_org := nullif(new.raw_user_meta_data ->> 'org_id', '')::uuid;
  was_invited := target_org is not null;

  if target_org is null then
    select id into target_org from public.organizations where slug = 'default';
  end if;

  insert into public.profiles (id, email, phone, full_name, role, org_id, is_active)
  values (
    new.id,
    new.email,
    new.phone,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',        -- Google sends 'name'
      ''
    ),
    -- A self-registered account never chooses its own role.
    case
      when was_invited
        then coalesce((new.raw_user_meta_data ->> 'role')::public.user_role, 'sales_rep')
      else 'sales_rep'
    end,
    target_org,
    was_invited
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user is
  'Creates the profile for a new auth user. Accounts without an org_id in '
  'their metadata are created inactive, so a self-registered account can '
  'sign in but reach nothing until an administrator activates it.';

-- ------------------------------------------- keep identities in step
-- A user who adds a phone number or changes their email in Supabase Auth
-- should not drift from their profile.
create or replace function public.sync_identity_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email or new.phone is distinct from old.phone then
    update public.profiles
    set email = coalesce(new.email, email),
        phone = coalesce(new.phone, phone),
        updated_at = now()
    where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_identity_changed on auth.users;
create trigger on_auth_user_identity_changed
  after update of email, phone on auth.users
  for each row execute function public.sync_identity_from_auth();

-- Wholesale Distribution Management System
-- Upgrade 0017: signup guard and phone identity.
-- For a database that is ALREADY INSTALLED. Safe to run more than once.
--
-- WHAT IT CHANGES
--   1. An account created without an invitation is now INACTIVE. Before
--      this, enabling Google or any other OAuth provider would let a
--      stranger sign in and read your catalogue and customer list.
--   2. A phone number is accepted as an identity, so drivers can sign in
--      without an email address. Previously that failed outright.
--
--   No business data is touched. No table is dropped.
--
-- AFTER RUNNING IT
--   Existing accounts keep the active state they already have.
--   New accounts you create in Authentication will be INACTIVE unless
--   you add org_id to their user metadata. To activate one by hand:
--
--     update public.profiles
--     set is_active = true, role = 'admin'
--     where email = 'you@example.com';
--
-- HOW TO RUN
--   Supabase -> SQL Editor -> New query -> Ctrl+A in the file -> paste -> Run.
--   Then run VERIFY_DATABASE.sql: rows 22 and 23 should read OK.
