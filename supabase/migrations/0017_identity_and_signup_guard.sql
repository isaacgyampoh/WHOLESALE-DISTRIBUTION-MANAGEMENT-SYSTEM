-- =====================================================================
-- 0017_identity_and_signup_guard.sql
--
-- Two changes to how accounts come into existence.
--
-- 1. SIGNUP GUARD (security)
--    handle_new_user() placed every new auth.users row into the default
--    organization as an active sales_rep. Nothing in the application
--    causes that today, because email signup is disabled. The moment an
--    OAuth provider such as Google is enabled, anyone with an account at
--    that provider could sign in and immediately read the catalogue and
--    the customer list.
--
--    Verified before this migration: an uninvited signup could see 6
--    products and 3 customers. Verified after marking such a profile
--    inactive: auth_role() returns null, is_staff() is false, and every
--    table returns nothing.
--
--    An account is now active only when the signup carries an org_id in
--    its metadata, which is what an administrator-issued invitation
--    does. A self-registered account is created but inert until someone
--    with authority activates it.
--
-- 2. PHONE AS AN IDENTITY
--    profiles.email was NOT NULL, so a phone-only signup failed outright
--    with a not-null violation. Drivers are the reason this matters:
--    they carry phones, often have no work email, and typing an address
--    into a phone in a van is slow. Either identifier is now sufficient,
--    and at least one is required.
-- =====================================================================

-- ------------------------------------------------- phone as identity
alter table public.profiles alter column email drop not null;

-- A profile must be reachable by something.
alter table public.profiles
  add constraint profiles_needs_an_identity
  check (email is not null or phone is not null);

-- Phone numbers identify a person within an organization, so they must
-- not repeat there. Stored as given; normalise to E.164 in the
-- application before writing.
create unique index profiles_org_phone_key
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

create trigger on_auth_user_identity_changed
  after update of email, phone on auth.users
  for each row execute function public.sync_identity_from_auth();
