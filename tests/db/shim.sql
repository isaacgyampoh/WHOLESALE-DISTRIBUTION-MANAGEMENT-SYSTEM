-- Minimal Supabase environment: what the platform provides before your
-- own migrations run. Not part of the app; test scaffolding only.
-- Roles are cluster-wide, so they outlive a database drop.
do $shim$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin login noinherit createrole; end if;
  -- PostgREST connects as this role and then SET ROLE's to anon /
  -- authenticated / service_role per request. session_user is therefore
  -- 'authenticator' for every Data API call, which is what
  -- is_trusted_context() relies on.
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit; end if;
end
$shim$;

create schema if not exists auth authorization supabase_auth_admin;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  -- Supabase provisions this column; phone-only accounts have no email.
  phone              text unique,
  raw_app_meta_data  jsonb not null default '{}'::jsonb,
  encrypted_password text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- Supabase reads the caller identity out of the JWT claims GUC.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  -- nullif BEFORE the cast, matching Supabase: the GUC can be an empty
  -- string in non-request contexts, which is not valid json.
  select nullif(
    nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', ''
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select nullif(
    nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', ''
  )::text
$$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;

grant anon, authenticated, service_role to authenticator;
