-- =====================================================================
-- 0016_revoke_anon_privileges.sql
--
-- Removes table, sequence and function privileges from the anon role.
--
-- WHY THIS IS NEEDED
--   Migration 0015 assumed anon would hold no object privileges, because
--   Supabase's current cloud default does not auto-expose new entities.
--   Projects created before that change carry default privileges that
--   grant every newly created table to anon as it is created, so the
--   installer left 259 grant rows behind on such a project and anon held
--   SELECT on all 29 tables and 8 views.
--
-- WAS DATA EXPOSED?
--   No. Verified by execution against a database reproducing that state:
--   every anonymous read and write failed with "permission denied for
--   function auth_org_id", because 0015 revoked EXECUTE from anon and
--   every row level security policy calls that function.
--
--   That protection is incidental rather than designed. It holds only
--   while every policy happens to call a function anon cannot execute.
--   A future table with a simpler policy would be readable. The
--   privileges are therefore removed at the source.
--
-- SAFE TO RUN on a project that never had the legacy grants: the
-- statements are no-ops there.
-- =====================================================================

-- Stop future objects from being granted to anon. This is the root
-- cause: without it, the next table created would be exposed again.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

-- Remove what the legacy defaults already granted.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- Withdraw schema access. anon also inherits USAGE from the PUBLIC
-- pseudo-role, which is left in place: revoking it from PUBLIC would
-- affect Supabase's own roles. It is inert once anon holds no object
-- privileges, and this application has no anonymous surface.
revoke all on schema public from anon;

-- The roles the application actually uses keep exactly what 0015 gave
-- them. Restated so this migration is self-contained and so a project
-- that runs it in isolation cannot end up with authenticated locked out.
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- The stock ledger stays append-only for ordinary users.
revoke update, delete on public.stock_movements from authenticated;

-- Re-assert EXECUTE on our own functions, since the blanket revoke above
-- also stripped anon's inherited rights and we want the signed-in roles
-- to keep theirs. Extension-owned functions are left untouched so citext
-- and pgcrypto operators keep working.
do $grants$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (
        select 1 from pg_depend d
        where d.objid = p.oid and d.deptype = 'e'
      )
  loop
    execute format('revoke all on function %s from public, anon', fn.sig);
    execute format('grant execute on function %s to authenticated, service_role', fn.sig);
  end loop;
end
$grants$;
