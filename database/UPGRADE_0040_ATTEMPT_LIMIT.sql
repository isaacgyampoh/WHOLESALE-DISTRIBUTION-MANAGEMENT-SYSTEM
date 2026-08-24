-- ====================================================================
-- UPGRADE 0040 - counting attempts by device as well as address
-- ====================================================================
--
-- For a database installed before migration 0040.
-- Run it in the Supabase SQL editor.
--
-- GENERATED FILE - do not edit by hand.
-- Source: supabase/migrations/0040_counting_attempts_by_device_too.sql
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
-- Sign-in is by PIN alone: four digits, ten thousand possibilities, and
-- nothing else at the door. What makes that safe is the five-attempt
-- limit, and the limit was counted per IP address only - which fails in
-- both directions on the networks this is used on.
--
--   Too lax. A phone on a mobile network does not keep one address.
--   Ghanaian carriers rotate them, sometimes between one request and the
--   next, and each new address starts a fresh count of five. Three wrong
--   PINs in a row reported "4 attempts remaining" every time.
--
--   Too strict. The same carriers put thousands of subscribers behind
--   one address, so one person fumbling five times locked out everybody
--   else on that network.
--
--   auth_pin_attempts.device_id   an opaque per-browser identifier
--
-- set by the server in an httpOnly cookie. It is not a credential and
-- grants nothing; it exists only to be counted against. Failures now
-- count against either key and a success against either clears both, so
-- clearing cookies leaves the address, changing address leaves the
-- cookie, and a new tab changes neither.
--
-- Two indexes come with it, including one on request_ip that was missing
-- all along - every sign-in was scanning this table.
--
-- Nothing is dropped and no policy is relaxed.
--
-- AFTER RUNNING IT, redeploy, or the application will not set the cookie
-- and the column stays empty.

-- ===================================================================
-- 0040  Counting attempts by device as well as address
-- ===================================================================
--
-- Sign-in is by PIN alone: four digits, ten thousand possibilities, and
-- nothing else at the door. What makes that safe is the attempt limit,
-- so the limit has to actually hold.
--
-- It was counted per IP address, which fails in both directions on the
-- networks this is used on.
--
--   Too lax. A phone on a mobile network does not keep one address.
--   Ghanaian carriers rotate them, sometimes between one request and the
--   next, and each new address starts a fresh count of five. Observed
--   here: three wrong PINs in a row reported "4 attempts remaining"
--   every time, because they landed under three different addresses.
--
--   Too strict. The same carriers put thousands of subscribers behind
--   one address. One person fumbling their PIN five times locks out
--   everybody else on that network.
--
-- So a second key: an opaque identifier this server sets in an
-- httpOnly cookie the first time somebody reaches the sign-in screen.
-- It is not a credential and carries no meaning - it exists only to be
-- counted against, and nothing is trusted to it beyond that.
--
-- Neither key is sufficient alone, which is the point of having both:
--
--   clearing cookies      leaves the address, which still counts
--   changing address      leaves the cookie, which still counts
--   a new tab or window   changes neither
--
-- Failures are counted against either, and a success against either
-- clears both. Someone determined to guess must discard the cookie AND
-- move address for every five tries, and even then the honest user
-- beside them is unaffected, which the address-only version could not
-- manage.

alter table public.auth_pin_attempts
  add column if not exists device_id text;

comment on column public.auth_pin_attempts.device_id is
  'Opaque per-browser identifier from an httpOnly cookie, counted '
  'alongside request_ip so the attempt limit survives an address change '
  'and cannot be shed by clearing client state. Never a credential.';

-- The limiter asks the same question on every sign-in - "failures for
-- this device since its last success" - so it gets an index shaped like
-- the question.
create index if not exists auth_pin_attempts_device_time
  on public.auth_pin_attempts (device_id, attempted_at desc)
  where device_id is not null;

-- The address side of the same question. Already the hot path, and
-- until now unindexed: every sign-in scanned the table.
create index if not exists auth_pin_attempts_ip_time
  on public.auth_pin_attempts (request_ip, attempted_at desc)
  where request_ip is not null;

-- ====================================================================
-- Confirm it took. Every row should read PASS.
-- ====================================================================
select 'attempts carry a device' as check,
       case when exists (select 1 from information_schema.columns
                          where table_name = 'auth_pin_attempts' and column_name = 'device_id')
            then 'PASS' else 'FAIL' end as result
union all
select 'the limiter has its indexes',
       case when (select count(*) from pg_indexes
                   where schemaname = 'public'
                     and indexname in ('auth_pin_attempts_device_time','auth_pin_attempts_ip_time')) = 2
            then 'PASS' else 'FAIL' end
union all
select 'one PIN still cannot open two accounts',
       case when exists (select 1 from pg_indexes
                          where schemaname = 'public' and indexname = 'profiles_active_pin_key')
            then 'PASS' else 'FAIL' end;
