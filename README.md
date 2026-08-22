# GAB Premium Ent

Wholesale distribution management. Goods come in from suppliers, go out
on vans, and the cash and credit come back — with every movement
traceable to a person and a reason.

Built as a Next.js application on Supabase (PostgreSQL), with an
installable driver app that keeps working when the signal does not.

---

## What it does

**Warehouse** — products and categories, stock held per warehouse,
suppliers, purchase orders and receiving. Stock is never edited: every
change is an append-only movement, and quantities are derived from that
ledger.

**Distribution** — vans and their drivers, loads dispatched from a
warehouse, sales made from the van, returns when it comes back, and an
end-of-day reconciliation of both the cash and the stock.

**Commercial** — customers with credit limits and terms, cash and credit
sales, invoice ageing, and collections against customer accounts.

**Insight** — role-specific dashboards, reports on sales, stock,
purchasing, drivers, credit and reconciliation, and an append-only audit
trail of every administrative action.

**The driver app** — installable on a phone, and usable with no
connection: the round, the customers, the stock on board, and the ability
to sell, collect, return and reconcile. Work is queued on the device and
uploaded when the signal returns, with duplicate submission prevented by
the database rather than by hope.

---

## How it is put together

Three rules shape most of the code.

**The database is the security boundary.** Row level security is on for
every table. Every policy narrows by the caller's own organization, taken
from their profile and never from anything the browser sent. The
interface asks `can(role, permission)` to decide what to *offer*; hiding
a button is a courtesy, not a control.

**Business rules live in the database, once.** Dispatching a load,
completing a sale, receiving goods, approving a return, building a
reconciliation — each is a function in PostgreSQL that owns its rule. The
application assembles the rows and calls it. The offline sync path calls
the same functions, so a sale made in a tunnel and one made at a desk go
through identical logic.

**Stock is derived, never set.** All changes go through
`stock_movements`, which is append-only. Corrections are reversing
movements, not edits.

```
src/
  app/(app)/          the screens, one directory per route
  features/           queries, server actions and components, by domain
  lib/
    auth/             sessions, PIN handling
    offline/          the device queue and the sync engine
    supabase/         the only place the provider is named
  types/              domain vocabulary and the permission map
supabase/migrations/  the schema, in order
database/            the consolidated installer and upgrade scripts
docs/                deployment, security, PWA, offline sync
tests/               database, browser, offline and visual suites
```

---

## Running it locally

```bash
npm install
cp .env.example .env.local     # then fill in the four values
npm run dev
```

`.env.local` needs a Supabase project. See `docs/SUPABASE_SETUP.md` — it
takes about ten minutes and is all done from the SQL editor.

### Demonstration data

```bash
npm run demo:seed     # a complete, coherent business day
npm run demo:clean    # removes only the demo organization
```

The seed creates a company, staff, products with deliberately varied
stock, customers, a supplier, a part-received purchase order, a
dispatched van load, cash and credit sales, a collection, a return with
damage and shortage, and a reconciliation with a real variance. Every
stage runs through the same functions the application uses, so a broken
workflow fails the seed rather than producing tidy numbers.

It prints the PINs it issued. It is idempotent, and it will not reset a
PIN somebody has already changed.

---

## Checks

```bash
npm run verify        # lint, typecheck, build

npm run db:start      # a local PostgreSQL for the schema suites
npm run db:test       # 279 assertions across 13 suites
npm run test:unit

npm start             # then, in another shell:
npm run hosted:pages      # every route, every role, direct URL access
npm run hosted:workflow   # PIN sign-in and a stock adjustment, in a browser
npm run hosted:offline    # the driver app with the network genuinely cut
npm run visual:audit      # every screen at six viewports
```

The database suites run against a local PostgreSQL that is rebuilt from
the migrations each time, so they are fast and safe to run repeatedly.
The browser suites need the application running and write to whichever
Supabase project `.env.local` points at.

---

## Deploying

The application and the database are deployed separately and
deliberately: a migration is never applied by a code deploy.

1. `docs/SUPABASE_SETUP.md` — create the project, run the installer, verify.
2. `docs/VERCEL_DEPLOYMENT.md` — push, import, set four environment
   variables, deploy.
3. `docs/PRODUCTION_CHECKLIST.md` — the whole sequence, with a box to tick
   against each step.
4. `docs/DEMO_TO_PRODUCTION.md` — turning a demonstration into a client's
   live system without rebuilding anything.

---

## Documentation

| | |
|---|---|
| `docs/SUPABASE_SETUP.md` | The database, from an empty project |
| `docs/VERCEL_DEPLOYMENT.md` | Getting it online |
| `docs/DEMO_TO_PRODUCTION.md` | Demonstration → real client |
| `docs/PWA.md` | The driver app |
| `docs/OFFLINE_SYNC.md` | The queue, idempotency and conflicts |
| `docs/SECURITY.md` | What is enforced, where, and how to test it |
| `docs/PRODUCTION_CHECKLIST.md` | Every step from an empty project to real use, in order |
| `docs/ROLE_GUIDE.md` | Who can do what, and the separations that stop one person completing a loop |
| `docs/DRIVER_GUIDE.md` | For whoever runs a van |
| `docs/ADMIN_GUIDE.md` | For whoever administers it |
| `docs/SUPPLIER_PORTAL.md` | The link you give a supplier, and what protects it |
| `docs/FINAL_PRODUCTION_AUDIT.md` | Every area, traced end to end, with what was fixed |
| `ROADMAP.md` | What is built, what is not, and the open risks |

---

## Authentication

Sign-in is a four-digit PIN against an account an administrator created.
There is no self-registration — the schema refuses it.

The PIN itself is never stored. What is stored is an HMAC of it under a
server-side pepper, so a copy of the database does not yield anybody's
PIN. Repeated wrong PINs trip a cooldown, and an inactive account reaches
nothing even with a valid session.

PINs cannot be recovered, only reset by an administrator.
