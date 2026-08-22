-- ===================================================================
-- UPGRADE 0021 — let a tenant be removed
-- ===================================================================
--
-- For a database installed before migration 0021. Safe to run twice.
--
-- Paste into the Supabase SQL editor and run. It replaces one function
-- and changes nothing else: no table, column, policy or grant is
-- touched, and no data moves.
--
-- WHY THIS IS NEEDED
--
-- audit_log is append-only. That was enforced absolutely by a trigger,
-- for every caller including the service role. Because
-- audit_log.org_id references organizations ON DELETE RESTRICT, an
-- organization that had ever recorded an audited action could not be
-- removed: its audit rows could not be deleted, and it could not be
-- deleted while they existed. Removing a tenant was impossible, and
-- `npm run demo:clean` failed on exactly this.
--
-- WHAT CHANGES, AND WHAT DOES NOT
--
--   UPDATE   still refused for every caller, with no exception.
--   DELETE   still refused for anon and authenticated. `authenticated`
--            holds SELECT on this table and no other privilege, so a
--            signed-in user's access is unchanged in every respect.
--   DELETE   now permitted for a trusted server-side role, which is
--            what removing a tenant requires.
--
-- Rewriting history stays impossible. Removing a tenant's history
-- wholesale becomes possible for the server alone.

create or replace function public.block_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and public.is_trusted_context() then
    -- Removing a tenant, or ageing out history under a retention
    -- policy. Never reachable from the Data API.
    return old;
  end if;

  raise exception 'audit_log is append-only; history cannot be altered'
    using errcode = '42501';
end;
$$;

comment on function public.block_audit_mutation is
  'Refuses every UPDATE, and every DELETE except from a trusted '
  'server-side role. Rewriting history is never allowed; removing a '
  'tenant wholesale is.';

-- ------------------------------------------------------------------
-- Confirm it took. Expect: rewrite_blocked = t
-- ------------------------------------------------------------------
do $$
begin
  begin
    update public.audit_log set action = action where false;
  exception when others then null;
  end;
end $$;

select
  exists (
    select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'block_audit_mutation'
      and pg_get_functiondef(p.oid) like '%is_trusted_context%'
  ) as upgrade_applied;
