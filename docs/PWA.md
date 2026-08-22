# The driver app

A driver spends their day in a van with patchy signal. The application
they use is the same deployment as the office one, but the part they
live in is built to be installed on a phone and to keep working when the
network does not.

For how the queue and synchronisation work, see `docs/OFFLINE_SYNC.md`.
This is about the app itself.

---

## Installing it

There is nothing to publish and no app store involved. On the phone:

- **Android / Chrome** — open the site, sign in, then **⋮ → Add to Home
  screen** (or accept the install prompt the browser offers).
- **iPhone / Safari** — open the site, then **Share → Add to Home
  Screen**.

It then opens like any other app: its own icon, no browser chrome, its
own window in the task switcher.

**It must be served over HTTPS.** Vercel does this automatically. Over
plain `http` a browser silently refuses to register the service worker
and the offline half will not work — if the install option never
appears, check the certificate first.

---

## What the driver sees

`/driver` — their round, and nothing else:

- The van they are assigned to and its open load.
- What is still on board, and what it is worth.
- Today's cash, credit and collections, as three large figures.
- Four buttons: **Sell**, **Collect**, **Return**, **End of day**.
- A link to everything they have recorded, and whether it has reached
  the office.

Deliberately not a smaller copy of the administrator's dashboard. A
driver at the back of a van, one-handed, in the sun, does not need a
filterable table of every sale in the company.

The design rules that follow from that:

- Every control is at least 44px, most are 56px.
- Amounts are large and monospaced; a mistyped quantity should be
  obvious before it is submitted.
- Choosing from a list beats typing. Products, customers and quantities
  come from the cached round.
- Totals are shown as they are built, so the number the customer is told
  is the number on the screen.

---

## The connection bar

Pinned above every driver screen, because a driver about to hand over
cash needs to know whether the office has actually seen their sales.

It says one of:

| | |
|---|---|
| **Connected · Up to date** | Everything has reached the office |
| **Connected · 3 waiting to send** | Recorded, uploading |
| **Working offline · 3 waiting to send** | No signal; the work is safe on the phone |
| A red count | Something did not go through and needs a supervisor |

The **Sync** button forces an upload. It is always safe to press: the
idempotency key means a repeated upload cannot record anything twice.

---

## What works with no signal

Signing in does not — a session comes from the server, so a driver signs
in at the depot. Everything after that does:

- Open the app and every driver screen
- See the van, the load, and what is on board
- See customers and their balances, marked as of the last sync
- Record a sale, cash or credit
- Record a collection
- Count the van in at the end of the round
- Submit the end of day cash
- See what has and has not reached the office

---

## How it is put together

| Piece | Where |
|---|---|
| Manifest, icons, shortcuts | `public/manifest.webmanifest`, `public/icons/` |
| Service worker | `public/sw.js` |
| Registration | `src/components/pwa/register.tsx` |
| Queue and cached round | `src/lib/offline/queue.ts` |
| Upload engine | `src/lib/offline/sync.ts` |
| Shared state | `src/features/driver/sync-provider.tsx` |
| Screens | `src/app/(app)/driver/`, `src/features/driver/` |

The icons are generated, not committed as artwork:

```bash
node scripts/icons/generate.mjs
```

Change `BRAND` in that file and every size, the maskable variant and the
favicon follow.

---

## Three things worth knowing if you change it

**The worker must not be behind the auth middleware.** A browser refuses
to register a service worker whose script arrived via a redirect. If
`/sw.js` is ever matched by the middleware and redirected to sign-in,
registration fails permanently and the offline app quietly stops
existing. `sw.js`, `manifest.webmanifest` and `icons/` are excluded in
`src/proxy.ts` for this reason.

**Caching a page is not enough to make it work offline.** A cached HTML
document with no JavaScript renders once and stays inert — the queue
screen would show "nothing recorded" over a full queue. The worker
therefore also caches the scripts each warmed page references, and the
RSC payload the router asks for. Without that last one the router's
fetch fails, it falls back to a full navigation, the worker answers from
cache, and the app reloads in a loop that never settles.

**Bump `VERSION` in `public/sw.js` when you change what is cached.** The
cache names carry it, and the next activation deletes everything older.
Without a bump, drivers keep yesterday's shell.

---

## Testing it

```bash
npm start                 # then, in another shell
npm run hosted:offline    # the network genuinely cut
```

`tests/visual/test_offline.mjs` signs a driver in, waits for the round to
cache, cuts the network with `context.setOffline(true)` — which is what a
dead cell looks like to the browser — queues twenty sales and a
collection, checks nothing reached the server, reconnects, uploads, then
uploads the whole queue a second time and checks the business is left
with exactly one of everything.

The visual audit covers the driver screens at 390×844 and 375×812 along
with everything else:

```bash
npm run visual:audit
```
