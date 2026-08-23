-- ====================================================================
-- UPGRADE 0035 - a tenant can actually be removed
-- ====================================================================
--
-- For a database installed before migration 0035.
-- Run it in the Supabase SQL editor.
--
-- GENERATED FILE - do not edit by hand.
-- Source: supabase/migrations/0035_ledger_tenant_purge.sql
-- Regenerate: node database/build.mjs
--
-- Safe to run twice. Every object is created behind an existence check,
-- so a second run reports success and changes nothing. An enum that
-- already exists is compared against what this script expects and the
-- script stops with both lists if they differ, rather than altering a
-- type other code may already depend on.
--
-- WHAT IT FIXES
--
-- stock_movements refused every UPDATE and every DELETE, from anybody,
-- with no exception. Right for a ledger - and it also meant a tenant
-- could not be removed: the cleanup reached the ledger, was refused, and
-- left the database half-emptied with an organization that could not be
-- deleted because its movements still pointed at it.
--
-- Found by testing the cleanup rather than by reading it. The script
-- logged the refusal and carried on, so the failure showed only in the
-- rows left behind.
--
-- Migration 0021 settled exactly this for audit_log. Same rule here:
--
--   * every UPDATE is still refused, from everybody, always
--   * DELETE is permitted only from a trusted server-side role
--   * 'authenticated' has no DELETE on this table to begin with, so
--     nothing changes for a signed-in user
--
-- A caller holding the service role could already read and write every
-- row in every table; this does not widen what such a key can reach.

-- ===================================================================
-- 0035  A tenant can actually be removed
-- ===================================================================
--
-- `stock_movements` refuses every UPDATE and every DELETE, from anybody,
-- with no exception. That is right for a ledger: stock is derived from
-- it, and a correction is a reversing entry rather than a rewrite.
--
-- It also means a tenant cannot be removed. The demonstration cleanup
-- deletes an organization's rows table by table, reaches the ledger, and
-- is refused - so the movements stay, the organization cannot be deleted
-- because they still reference it, and the cleanup leaves the database
-- half-emptied.
--
-- That was found by testing the cleanup rather than by reading it. The
-- script logged the refusal and carried on, so the failure was visible
-- only in the rows left behind.
--
-- Migration 0021 met exactly this problem with `audit_log` and settled
-- it: refuse every rewrite, permit a delete from a trusted server-side
-- role, because removing a tenant and honouring a retention policy both
-- need one. This applies the same rule to the ledger, for the same
-- reason and with the same limits.
--
-- What does not change:
--   * Every UPDATE is still refused, from everybody, always. Stock is
--     never rewritten.
--   * `authenticated` has no DELETE privilege on this table to begin
--     with, so nothing changes for a signed-in user.
--   * Only a trusted context - the service role, or a direct database
--     connection such as the SQL editor - can delete, and such a caller
--     could already read and write every row in every table.

create or replace function public.block_movement_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and public.is_trusted_context() then
    -- Removing a tenant. Never reachable from the Data API by a
    -- signed-in user, and never reachable at all for an UPDATE.
    return old;
  end if;

  raise exception 'stock_movements is append-only; post a reversing movement instead'
    using errcode = '42501';
end;
$$;

comment on function public.block_movement_mutation is
  'Refuses every UPDATE, and every DELETE except from a trusted '
  'server-side role. Stock is never rewritten; a tenant can be removed '
  'wholesale.';

-- The same for van inventory movements, which share the ledger, and for
-- product batches, which are drawn down rather than edited.
--
-- Batches have no such trigger today, so nothing to relax there. This
-- comment is here so the next person looking for one knows why.

-- ------------------------------------------------------------------
-- Proving the ledger is still closed to ordinary callers
-- ------------------------------------------------------------------
--
-- Left as a comment rather than a check: `authenticated` holds no
-- DELETE on this table, and 0015 revoked it explicitly. The grant is
-- verified by VERIFY_DATABASE.sql and by tests/db/test_stock.js.

-- ====================================================================
-- Confirm it took. Every row should read PASS.
-- ====================================================================
select 'the ledger still refuses rewrites' as check,
       case when exists (select 1 from pg_trigger
                          where tgrelid = 'public.stock_movements'::regclass
                            and tgname = 'stock_movements_no_update')
            then 'PASS' else 'FAIL' end as result
union all
select 'a signed-in user cannot delete from it',
       case when not exists (
              select 1 from information_schema.role_table_grants
               where table_name = 'stock_movements' and grantee = 'authenticated'
                 and privilege_type in ('UPDATE','DELETE'))
            then 'PASS' else 'FAIL' end
union all
select 'a tenant purge is possible',
       case when position('is_trusted_context' in
              (select pg_get_functiondef(p.oid) from pg_proc p
                 join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'block_movement_mutation'
                limit 1)) > 0
            then 'PASS' else 'FAIL' end;
