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
