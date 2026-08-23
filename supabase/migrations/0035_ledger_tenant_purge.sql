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
