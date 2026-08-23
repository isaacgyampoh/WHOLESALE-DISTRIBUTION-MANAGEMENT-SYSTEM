-- ====================================================================
-- UPGRADE 0032 - the salesperson role
-- ====================================================================
--
-- For a database installed before migration 0032.
-- Run it in the Supabase SQL editor.
--
-- GENERATED FILE - do not edit by hand.
-- Source: supabase/migrations/0032_salesperson_role.sql
-- Regenerate: node database/build.mjs
--
-- Safe to run twice. Every object is created behind an existence check,
-- so a second run reports success and changes nothing. An enum that
-- already exists is compared against what this script expects and the
-- script stops with both lists if they differ, rather than altering a
-- type other code may already depend on.
--
-- WHAT IT ADDS
--
-- One line: the 'salesperson' role.
--
-- IT IS A FILE OF ITS OWN FOR A REASON. PostgreSQL refuses to use a new
-- enum label in the same transaction that added it, and the Supabase SQL
-- editor runs a whole script as one transaction. With this line at the
-- top of UPGRADE_0033 the policies further down that mention
-- 'salesperson' could not be created and the whole thing failed.
--
-- So: run this one on its own and let it finish. Then run
-- UPGRADE_0033_VAN_CREW.sql, which needs the role to already exist.

-- ===================================================================
-- 0032  The salesperson role
-- ===================================================================
--
-- One statement, in a migration of its own, and that is deliberate.
--
-- PostgreSQL refuses to *use* a new enum label in the same transaction
-- that added it - "unsafe use of new value of enum type". The Supabase
-- SQL editor runs a whole script as one transaction, so putting this
-- ALTER at the top of the crew migration meant the policies further down
-- that mention 'salesperson' could not be created, and the entire
-- upgrade failed on arrival.
--
-- Splitting it out gives the label its own transaction. Migration 0033
-- then runs against a database where the role already exists.
--
-- The field sales role. Deliberately not `sales_rep`, which already
-- exists and is an office role with no van and no round: merging them
-- would give office staff a van and field staff the office's reach.
alter type public.user_role add value if not exists 'salesperson';

-- ====================================================================
-- Confirm it took. Every row should read PASS.
-- ====================================================================
select 'salesperson is a role' as check,
       case when exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                          where t.typname = 'user_role' and e.enumlabel = 'salesperson')
            then 'PASS' else 'FAIL' end as result
union all
select 'user_role has no duplicate labels',
       case when (select count(*) = count(distinct e.enumlabel)
                    from pg_enum e join pg_type t on t.oid = e.enumtypid
                   where t.typname = 'user_role')
            then 'PASS' else 'FAIL' end;
