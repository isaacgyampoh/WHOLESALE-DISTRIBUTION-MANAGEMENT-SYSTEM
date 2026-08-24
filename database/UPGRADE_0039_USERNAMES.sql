-- ====================================================================
-- UPGRADE 0039 - a name to sign in with
-- ====================================================================
--
-- For a database installed before migration 0039.
-- Run it in the Supabase SQL editor.
--
-- GENERATED FILE - do not edit by hand.
-- Source: supabase/migrations/0039_a_name_to_sign_in_with.sql
-- Regenerate: node database/build.mjs
--
-- Safe to run twice. Every object is created behind an existence check,
-- so a second run reports success and changes nothing. An enum that
-- already exists is compared against what this script expects and the
-- script stops with both lists if they differ, rather than altering a
-- type other code may already depend on.
--
-- WHAT IT CHANGES
--
-- Until now sign-in looked an account up *by* its PIN digest: whoever
-- typed four digits became whoever those digits belonged to. The PIN was
-- the identifier as well as the credential, which meant a guess that
-- landed landed on somebody, no two people could hold the same PIN, and
-- the business could never have more staff than there are PINs.
--
--   profiles.username         what the person types to say who they are
--   profiles.must_change_pin  this PIN was issued, not chosen
--
-- Existing accounts are given a username derived from the name they are
-- already known by - "Ama Mensah" becomes "ama.mensah" - with a number
-- appended if two people would collide. Nobody is locked out, but
-- EVERYONE MUST BE TOLD THEIR USERNAME, because the sign-in screen now
-- asks for it. The list is printed by the verification block below.
--
-- must_change_pin marks a PIN somebody else chose: the one bootstrap
-- creates the first administrator with, and any an administrator hands
-- out when creating an account or resetting a forgotten one. The
-- application allows such an account nothing but choosing its own PIN,
-- and clears the flag when it does.
--
-- Nothing is dropped and no policy is relaxed. The unique index on
-- pin_hash is deliberately left in place: it is no longer needed to tell
-- people apart, but it still keeps two of them from sharing a credential.
--
-- AFTER RUNNING IT, redeploy, then give each person their username.

-- ===================================================================
-- 0039  A name to sign in with, and a PIN that must not be kept
-- ===================================================================
--
-- Two changes, both additive. No table is dropped, no policy relaxed,
-- no constraint removed.
--
-- ------------------------------------------------------------------
-- 1. The PIN was doing two jobs
-- ------------------------------------------------------------------
--
-- Sign-in looked an account up *by* its PIN digest: whoever typed four
-- digits became whoever those digits belonged to. That made the PIN the
-- identifier as well as the credential, with three consequences.
--
--   Four digits is ten thousand values, and the obvious ones are
--   refused, so a guess that lands lands on somebody. Guessing needed no
--   knowledge of who worked here.
--
--   Two people could never hold the same PIN, so the business could
--   never have more staff than there are PINs, and assigning one leaked
--   the fact that another account already held it.
--
--   Nobody could be told "your PIN is wrong" without the system first
--   having decided who they were - which it could not do.
--
-- A username restores the usual split: the username says who you claim
-- to be, the PIN proves it. Sign-in now resolves the account by name and
-- compares the digest for that one account.
--
-- The unique index on pin_hash is deliberately left in place. It is no
-- longer required for identification, but it costs nothing and keeps two
-- people from sharing a credential.
--
-- ------------------------------------------------------------------
-- 2. A PIN somebody else chose is provisional
-- ------------------------------------------------------------------
--
-- The first administrator is created by `npm run production:bootstrap`
-- with a documented PIN, and administrators hand out PINs when they
-- create staff or reset a forgotten one. In all three cases the PIN is
-- known to somebody other than its owner, so it is a way in and not yet
-- a credential.
--
-- must_change_pin marks that state. The application will not let such an
-- account do anything except choose its own PIN, and clears the flag
-- when it does.

-- ------------------------------------------------------------------
-- The columns
-- ------------------------------------------------------------------

-- citext, matching email: usernames are compared without regard to case,
-- so nobody is locked out by a capital letter on a phone keyboard.
alter table public.profiles
  add column if not exists username      citext,
  add column if not exists must_change_pin boolean not null default false;

comment on column public.profiles.username is
  'What the person types to say who they are. The PIN proves it. '
  'Case-insensitive and unique across the installation.';

comment on column public.profiles.must_change_pin is
  'The current PIN was chosen by somebody else - bootstrap, an admin '
  'creating this account, or a reset. The application allows nothing '
  'but setting a new one until this is cleared.';

-- ------------------------------------------------------------------
-- A username nobody else holds
-- ------------------------------------------------------------------
--
-- Used by the backfill below and by handle_new_user, which has no way to
-- retry an insert that collides.
create or replace function public.unique_username(base text)
returns citext
language plpgsql
security definer
set search_path = public
as $$
declare
  root      text;
  candidate citext;
  n         int := 0;
begin
  -- Letters, digits and single dots; nothing that needs quoting or
  -- looks like an email address.
  root := lower(coalesce(base, ''));
  root := regexp_replace(root, '[^a-z0-9]+', '.', 'g');
  root := regexp_replace(root, '^\.+|\.+$', '', 'g');
  root := regexp_replace(root, '\.{2,}', '.', 'g');
  root := left(root, 24);

  if root = '' then root := 'user'; end if;

  candidate := root::citext;
  while exists (select 1 from public.profiles p where p.username = candidate) loop
    n := n + 1;
    candidate := (root || n::text)::citext;
  end loop;

  return candidate;
end;
$$;

comment on function public.unique_username(text) is
  'A username derived from a name, with a number appended if taken.';

revoke all on function public.unique_username(text) from public, anon, authenticated;

-- ------------------------------------------------------------------
-- Existing rows
-- ------------------------------------------------------------------
--
-- Derived from the name people already know each other by, falling back
-- to the local part of the address. Runs before the column is made
-- NOT NULL, and does nothing on a database that has no profiles yet -
-- which production, at this point, does not.
do $backfill$
declare r record;
begin
  for r in select id, full_name, email from public.profiles
            where username is null order by created_at loop
    update public.profiles
       set username = public.unique_username(
             coalesce(nullif(trim(r.full_name), ''), split_part(r.email::text, '@', 1)))
     where id = r.id;
  end loop;
end
$backfill$;

-- One person, one name. Partial on nothing - every row has one now.
create unique index if not exists profiles_username_key
  on public.profiles (username);

alter table public.profiles alter column username set not null;

-- ------------------------------------------------------------------
-- New accounts arrive with one
-- ------------------------------------------------------------------
--
-- handle_new_user builds the profile from auth metadata. It now carries
-- the username an administrator chose, and derives one when the account
-- came from somewhere that did not supply it.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  target_org uuid;
  was_invited boolean;
  chosen citext;
begin
  -- An invitation is an org_id placed in user metadata by an
  -- administrator. Anything arriving without one is self-registration,
  -- whatever provider it came through.
  target_org := nullif(new.raw_user_meta_data ->> 'org_id', '')::uuid;
  was_invited := target_org is not null;

  if target_org is null then
    select id into target_org from public.organizations where slug = 'default';
  end if;

  -- Taken as offered when it is free, so the administrator who typed it
  -- gets the name they typed; otherwise derived, so the insert cannot
  -- fail on a collision it has no way to retry.
  chosen := nullif(trim(new.raw_user_meta_data ->> 'username'), '')::citext;
  if chosen is null or exists (select 1 from public.profiles p where p.username = chosen) then
    chosen := public.unique_username(coalesce(
      nullif(chosen::text, ''),
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(coalesce(new.email, ''), '@', 1)));
  end if;

  insert into public.profiles (id, email, phone, full_name, role, org_id, is_active, username)
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
    was_invited,
    chosen
  )
  on conflict (id) do nothing;

  return new;
end;
$function$;

-- ====================================================================
-- Confirm it took. Every row should read PASS.
-- ====================================================================
select 'every account has a username' as check,
       case when not exists (select 1 from public.profiles where username is null)
            then 'PASS' else 'FAIL' end as result
union all
select 'no two accounts share one',
       case when exists (select 1 from pg_indexes
                          where schemaname = 'public' and indexname = 'profiles_username_key')
            then 'PASS' else 'FAIL' end
union all
select 'an issued PIN can be marked provisional',
       case when exists (select 1 from information_schema.columns
                          where table_name = 'profiles' and column_name = 'must_change_pin')
            then 'PASS' else 'FAIL' end
union all
select 'new accounts are given one automatically',
       case when position('unique_username' in
              coalesce((select pg_get_functiondef(p.oid) from pg_proc p
                          join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname = 'public' and p.proname = 'handle_new_user'
                         limit 1), '')) > 0
            then 'PASS' else 'FAIL' end
union all
select 'the PIN is no longer the only credential',
       case when exists (select 1 from information_schema.columns
                          where table_name = 'profiles' and column_name = 'username'
                            and is_nullable = 'NO')
            then 'PASS' else 'FAIL' end;

-- TELL EACH PERSON THE NAME IN THIS LIST. They cannot sign in without it.
select full_name as "who", username as "signs in as", role as "role"
  from public.profiles where is_active order by full_name;
