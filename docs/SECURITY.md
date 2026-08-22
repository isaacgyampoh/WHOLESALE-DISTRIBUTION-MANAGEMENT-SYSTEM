# Security

What this system actually enforces, where each rule lives, and how to
check it yourself.

The short version: **the interface decides what to offer, the database
decides what is allowed.** Every guarantee below is enforced in
PostgreSQL, so a request that bypasses the application entirely still
hits the same wall.

---

## Authentication

Sign-in is a four-digit PIN against an account an administrator created.
There is no self-registration, no email link, no OAuth, no OTP.

**The PIN is never stored.** What is stored is an HMAC-SHA256 of the PIN
under a server-side pepper (`PIN_PEPPER`), which never reaches the
browser. The digest cannot be reversed, and it cannot be computed by
anyone who does not hold the pepper — so a leaked database dump does not
yield anybody's PIN.

- `pin_hash` is never selected into any query the client can reach.
- A trigger refuses a PIN change that does not come through the proper
  path.
- Four digits is a small space, so it is protected by rate limiting
  rather than by entropy: `auth_pin_attempts` records failures per
  address, and repeated wrong PINs trip a cooldown.
- An inactive account is refused sign-in and reaches no data even with a
  valid session.

Migration 0017 closed the self-registration hole: a trigger refuses to
create a profile for a signup that did not originate server-side. Without
it, anyone with the public anon key could have created themselves an
administrator account.

---

## Authorization

Two layers, and only the second one is a security control.

**The interface** asks `can(role, permission)` — a map in
`src/types/permissions.ts`. This governs what is *offered*: which
navigation items appear, which buttons render. Hiding a link is a
courtesy, not a control.

**The database** enforces the same rules independently:

- Row level security is on for **every table**, without exception.
- Every policy narrows by `auth_org_id()`, taken from the caller's own
  profile — never from anything the browser sent.
- `SECURITY DEFINER` functions bypass RLS by design, so **every one of
  them re-asserts authorization** with `require_role()`. That is an
  architectural rule of this schema: a new one without that check is a
  bug.

Test it the way an attacker would — type the URL:

```
Sign in as a driver, then visit /users
Sign in as a manager, then visit /settings
```

Both are refused by the server, not by a missing link.

---

## Tenant isolation

Every business table carries `org_id`, and every policy filters on it. A
user of one organization cannot read, write, or infer the existence of
another's rows. 22 assertions cover this specifically (`test_tenancy`).

The `service_role` key is the one thing that bypasses all of it. It
belongs in server environment variables only. It is never sent to the
browser, never prefixed `NEXT_PUBLIC_`, and never committed.

---

## Manager category scopes

A manager sees only the product categories assigned to them, through
`manager_category_scopes` and `can_access_product()`. This is enforced in
the policies, so a manager who requests a product outside their scope
gets nothing back — the application does not have to remember to filter.

---

## Role escalation

- A user cannot change their own role: a trigger refuses it.
- A user cannot move themselves to another organization: a trigger
  refuses it.
- Role changes are performed by an administrator through a server action
  that re-checks the permission and records the change.

---

## The audit trail

`audit_log` records administrative actions: staff created, roles changed,
PINs reset, products and categories changed, stock adjusted, collections
recorded, loads dispatched, returns and reconciliations approved.

**It is append-only.** `authenticated` is granted `SELECT` and nothing
else — the privilege to write it is withheld, not merely blocked by a
trigger. A trigger additionally refuses `UPDATE` from every caller
including the service role, because an audit entry that says something
other than what happened is the one failure this table exists to prevent.

`DELETE` is permitted only from a trusted server-side role, and only so
that a tenant can be removed at all (migration 0021 — before it, an
organization that had recorded any audited action could never be
deleted).

**Secrets never enter it.** The application strips known credential keys
before writing, and a trigger strips them again on the way in. Belt and
braces, because the cost of getting this wrong is a PIN in a log.

---

## Offline sync

The queue on a driver's phone holds an operation, a payload and a device
id. It holds **no role, no organization id, no token and no PIN**.

`sync_submit()` re-derives authorization from the session doing the
syncing, never from the payload. This is the case that matters: a device
offline since morning may be holding a role revoked at lunch. The queue
uploads; the server refuses it.

Duplicate submission is prevented by a primary key, not by client
discipline — the uuid is generated on the device before the work is
stored, and a second upload collides. `sync_operations` is append-only on
the same terms as the audit trail.

See `docs/OFFLINE_SYNC.md`.

---

## Secrets

| Value | Where it may appear |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Anywhere. It is public. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anywhere. RLS governs everything it can do. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server environment variables only. |
| `PIN_PEPPER` | Server environment variables only. |

`.env.local` is gitignored; only `.env.example` is tracked, and it holds
no values.

Verify no secret reached the browser bundle:

```bash
npm run build
grep -rl "$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2-)" .next/static | wc -l   # 0
grep -rl "$(grep '^PIN_PEPPER=' .env.local | cut -d= -f2-)" .next/static | wc -l                  # 0
```

---

## Running the security tests

```bash
npm run db:start
npm run db:test
```

279 assertions across 13 suites. The ones that are specifically security:

| Suite | Covers |
|---|---|
| `test_rls` | Row level security across every table |
| `test_tenancy` | Cross-organization isolation |
| `test_scopes` | Manager category restrictions |
| `test_identity` | Signup guard, role and organization change guards |
| `test_pin` | PIN digest handling, rate limiting, inactive accounts |
| `test_admin_security` | Staff management boundaries, audit immutability |
| `test_grants` | Table privileges, and the anonymous authorization bypass closed in 0015 |
| `test_sync` | Offline queue authorization and idempotency |

And through the browser, against a running application:

```bash
npm run hosted:pages      # every route, every role, direct URL access
```

---

## If a key is exposed

1. **Supabase → Settings → API → Reset** the service role key.
2. Update `SUPABASE_SERVICE_ROLE_KEY` in Vercel and redeploy.
3. If `PIN_PEPPER` leaked, generate a new one — and understand that this
   invalidates every PIN in the system. Every person needs a new one.
4. Review `audit_log` for the period the key was exposed.

---

## Known limitations

Stated plainly rather than left for someone to discover.

- **A four-digit PIN is weak in isolation.** It is protected by rate
  limiting and by the fact that an attacker needs the account's device
  and network access. It is the right trade for a driver wearing gloves
  in a van; it is not the right trade for remote access to financial
  records over the open internet. If this system is ever exposed beyond
  the company's own use, add a second factor for administrators.
- **The service role key is absolute.** Anything holding it reads and
  writes everything. There is no key rotation schedule built in.
- **The offline snapshot sits on the phone.** It holds customer names,
  balances and what is on the van — not cost prices, not the wider
  catalogue, not credentials. A lost phone is a data-protection matter
  even so; the shell cache is cleared at sign-in, but IndexedDB persists
  until the browser data is cleared.
