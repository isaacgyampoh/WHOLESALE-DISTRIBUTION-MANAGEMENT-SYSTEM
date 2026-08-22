# Offline operation and synchronisation

A driver loses signal between Accra and a customer's yard. They keep
selling. Nothing is lost, and nothing is charged twice.

This is how that works, and where each guarantee is actually enforced.

---

## The shape of it

```
     DEVICE                                    SERVER
  ┌──────────────┐                        ┌──────────────────┐
  │ sell / collect│                        │                  │
  │ return / count│                        │                  │
  └──────┬───────┘                        │                  │
         │ uuid generated here            │                  │
         ▼                                 │                  │
  ┌──────────────┐   when there is signal  │  sync_submit()   │
  │  IndexedDB   │ ──────────────────────▶ │  ├ re-checks who │
  │  queue       │       one at a time     │  ├ idempotent on │
  │              │ ◀────────────────────── │  │   the uuid    │
  └──────────────┘   applied / conflict /  │  └ calls the     │
                     failed                │    business fn   │
                                           └──────────────────┘
```

The important detail is where the identifier comes from. Each operation
is given a uuid **on the phone, before it is stored**. That uuid is the
primary key of `sync_operations`. Uploading the same operation twice
collides on insert and returns the first outcome instead of doing the
work again.

Retry safety is therefore a database constraint, not a promise the
client code makes. A driver can press *Send everything* twenty times.

---

## What works with no connection

| | |
|---|---|
| Open the app | Service worker serves the cached shell |
| See the van, the load, what is on board | Cached snapshot in IndexedDB |
| See customers and their balances | Same snapshot, marked "as at last sync" |
| Record a sale (cash or credit) | Queued |
| Record a collection | Queued |
| Count the van in | Queued |
| Submit the end of day | Queued |
| See what has and has not reached the office | Queue screen |

What does **not** work offline is signing in. A session is issued by the
server. A driver signs in at the depot in the morning; the session then
survives the round.

---

## The snapshot

`sync_bootstrap()` returns what a device needs and deliberately no more:

- the van the driver is assigned to
- its open load
- what is on board, by product
- the price each product was loaded at
- active customers, with balance and remaining credit

It does **not** return cost prices, other drivers' rounds, or the wider
product catalogue. A phone left in a taxi should not be carrying the
company's margins.

The snapshot is refreshed on every successful sync, and only once the
queue is empty — otherwise a driver would see stock that does not
account for sales still waiting to upload.

---

## Three outcomes, not two

When an operation reaches the server it comes back as one of:

**Applied.** It is done. The result — the sale number, the total — is
recorded against the queue item.

**Conflict.** The world moved while the device was offline. The van did
not have that much stock. The load was closed. The customer was
deactivated. The work was *not* applied and will not be retried, because
retrying cannot change the answer. The driver is shown it under *Needs
attention* and it goes to a supervisor.

**Failed.** The server refused: the account was deactivated mid-round,
the payload was malformed. Also not retried.

Only transport failures are retried, and those never reached the server
at all, so the item goes straight back to pending.

This distinction matters. Silently retrying a conflict forever would
hide a real discrepancy; treating a dropped connection as a failure
would lose a real sale.

---

## Authorization

**Nothing in the queue is trusted for authorization.** The queue holds an
operation, a payload and a device id. It holds no role, no organization
id, no token and no PIN.

`sync_submit()` re-derives authorization from the session presenting the
row:

```sql
perform public.require_role(
  'admin', 'senior_manager', 'manager', 'accountant', 'sales_rep', 'driver');
```

and reads the organization from the caller's own profile, never from the
payload. This is the case the design exists for: a device that has been
offline since morning may be holding a role that was revoked at lunch.
The queue uploads; the server refuses it.

A queue key belonging to someone else is refused outright rather than
replayed — a collision or an attempt, either way not a legitimate retry.

Row level security applies throughout. A driver's queue cannot touch
another organization's load, and `sync_operations` is readable only by
its author and by supervisors in the same organization.

---

## The sync history is evidence

`sync_operations` keeps every operation a device sent, with the time the
driver performed it and the time the server received it. The gap between
those two is how long the round was out of coverage, which is the first
thing anyone investigating a discrepancy wants.

It is append-only for everybody reachable through the Data API:
`authenticated` is granted `SELECT` and nothing else, and a trigger
refuses `UPDATE` and `DELETE` from any untrusted caller. A driver cannot
tidy away a conflict.

---

## The service worker

`public/sw.js`. Three jobs, all read-side:

1. **Navigations** — network first, cache the result, fall back to the
   cached page and then to `/offline`.
2. **The router's data** — Next fetches an RSC payload for the route it
   is on. Offline that fails, the router falls back to a full browser
   navigation, the worker answers it from cache, and the router asks
   again. That loop reloads the app forever. Caching the payload under
   the route's key breaks it.
3. **Static assets** — content-hashed build output, cache first.

It deliberately does **not** queue mutations. A service worker replaying
a captured POST has no way to know the driver's role was revoked while
they were offline; the page can, because it re-authenticates.

It never caches Supabase responses or the sign-in page, and the shell
cache is emptied whenever the sign-in screen is reached — a van's phone
gets handed between people.

`VERSION` in that file names the caches. Bump it whenever you change
what is cached; the next activation retires everything older.

---

## Testing it

```bash
npm run db:test          # test_sync.mjs — 30 assertions at the database
npm start                # then, in another shell:
npm run hosted:offline   # the browser, actually offline
```

`test_sync.mjs` proves the database half: twenty operations applied,
replayed in full, and still twenty. Conflicts recorded rather than
applied. Cross-organization and deactivated callers refused. History
immutable. No credentials in any payload.

`test_offline.mjs` proves the device half with the network genuinely cut
(`context.setOffline(true)`, which is what a dead cell looks like to the
browser): the app opens, the queue fills, nothing reaches the server, and
after reconnecting the whole queue uploads — twice — leaving one of
everything.

The server half of that second suite needs migration 0022 on whichever
database you point it at. If it is missing the suite says so and skips
those assertions rather than reporting a pass it did not earn.
