-- ===================================================================
-- 0021  Removing a tenant must remain possible
-- ===================================================================
--
-- audit_log is append-only, enforced two ways: `authenticated` is
-- granted SELECT and nothing else, and a trigger refuses UPDATE and
-- DELETE for everyone including the service role.
--
-- That second guard was absolute, and it made a whole class of
-- operation impossible. audit_log.org_id references organizations with
-- ON DELETE RESTRICT, so once an organization had a single audited
-- action its row could never be removed: the audit entries could not be
-- deleted, and the organization could not be deleted while they existed.
-- `npm run demo:clean` hit exactly this and left the demo tenant behind.
--
-- The rule worth keeping is that history is never *rewritten*, and that
-- nobody reaching the database through the Data API can touch it at all.
-- Neither is weakened here:
--
--   * UPDATE stays refused for every caller, without exception. An
--     audit entry that says something other than what happened is the
--     failure this table exists to prevent.
--   * DELETE stays refused for every caller that is not a trusted
--     server-side role. anon and authenticated are not trusted, and
--     `authenticated` has no DELETE privilege to begin with, so for a
--     signed-in user nothing changes.
--   * DELETE by a trusted role is now permitted, which is what removing
--     a tenant and honouring a retention policy both require.
--
-- A caller holding the service role could already read every row in
-- every table and write to any of them; this does not widen what such a
-- key can reach.

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
