# Wholesale Distribution Management System

Supabase (PostgreSQL) backend for a wholesale distribution business, covering
inventory, sales orders and invoicing, customers and suppliers, and role-based
access control.

## Status

| Layer | State |
|---|---|
| Database schema, triggers, views, RLS | Executed and verified against PostgreSQL 17.10 |
| Business rule test suite | 118 assertions, all passing |
| Real Supabase project | Not yet connected (no credentials supplied) |
| Next.js application | Not started |

The migrations have been run end to end against a real PostgreSQL 17.10
instance, not merely checked for syntax. They have **not** yet been run
against a hosted Supabase project. See "Verifying" below.

## Modules

**Auth & roles** — `profiles` extends `auth.users` with a `user_role` enum
(`admin`, `manager`, `sales_rep`, `warehouse`, `accountant`). A trigger on
`auth.users` creates the profile on signup. Every RLS policy keys off
`has_role()`, and a guard trigger blocks self-promotion.

**Inventory** — `categories`, `products`, `warehouses`, `inventory`,
`stock_movements`. Stock levels are never written directly: each change is an
append-only row in `stock_movements`, folded into `inventory` by trigger. The
ledger rejects UPDATE and DELETE — correct mistakes with a reversing movement.

**Sales** — `sales_orders` → `sales_order_items` → `invoices` → `payments`.
Line and header totals are generated columns and triggers. Confirming an order
reserves stock, shipping issues it, cancelling releases the reservation.

**Purchasing** — `purchase_orders` / `purchase_order_items`, received through
`receive_purchase_line(item_id, quantity)`, which posts a receipt movement,
updates the line, refreshes standard cost, and advances PO status.

**Van operations** — `vans`, `van_assignments`, `van_inventory`, `van_loads`
and `van_load_items`. `dispatch_van_load()` moves stock from warehouse to van
as two ledger legs, and refuses to run until the driver has signed for the
load. One open load per van, one active driver per van.

**Van sales** — `van_sales` / `van_sale_items`, cash or credit.
`complete_van_sale()` verifies the stock is physically on the van, requires
full payment for cash sales, and checks the customer's remaining credit
before allowing a credit sale.

**Credit** — `credit_transactions` is the customer ledger; positive amounts
increase what is owed. `record_credit_payment()` books collections taken in
the field.

**Returns** — `van_returns` / `van_return_items` capture expected, good and
damaged quantities; `qty_missing` is derived. `approve_van_return()` restocks
good units, writes off damage, and books shortages against the van.

**Reconciliation** — `build_reconciliation()` computes expected cash
(float + cash sales + collections) and expected stock from the ledger.
`cash_variance` and `stock_variance` are generated columns. A driver cannot
approve their own reconciliation: enforced by check constraint, by RLS, and
by `approve_reconciliation()`.

**Manager scopes** — `manager_category_scopes` limits a `manager` to named
product categories. `senior_manager` is unrestricted. Enforced in RLS via
`can_access_product()`, so it holds regardless of what the frontend does.

**Multi-tenancy** — every business table carries `org_id`, business keys are
unique per organization, and cross-organization foreign key references are
rejected by trigger.

**Reporting views** — `customer_balances`, `stock_summary`, `invoice_ageing`,
`customer_statement` (running balance), `customer_credit_position`,
`van_stock_summary`, `van_load_summary`, `reconciliation_variances`.

## Setup

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run the files in `supabase/migrations/` **in
   filename order**, 0001 through 0014, **one file per run**. Order matters,
   and 0010 must be its own run: PostgreSQL forbids using a new enum value in
   the transaction that created it.
3. Create your user under **Authentication → Users**.
4. Promote it to admin:
   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```
5. Copy the project URL and anon key from **Project Settings → API** for the
   app layer.

3. Copy `.env.example` to `.env.local` and fill in the project URL and keys.

`0008_seed.sql` loads demo warehouses, categories, suppliers, customers,
products, and opening stock. Skip it for a production project.

The service role key bypasses every policy in this schema. Keep it server
side only.

## Role permissions

| | Catalogue | Customers | Warehouse stock | Van | Sales | Credit | Approvals |
|---|---|---|---|---|---|---|---|
| admin | full | full | full | full | full | full | yes |
| senior_manager | full | full | full | full | full | full | yes |
| manager | scoped categories | full | full | full | full | read | yes |
| sales_rep | read | write | read | – | own orders | – | no |
| warehouse | read | read | write | load / receive | fulfil | – | returns |
| accountant | read | read | read | read | read | full | no |
| driver | own van only | create | none | own van only | own sales | collect | no |

A `manager` with no rows in `manager_category_scopes` sees no products.
Migration 0013 grants existing managers every category so behaviour is
unchanged on upgrade; managers created afterwards need explicit grants.

## Verifying

`tests/db` runs the migrations against a real PostgreSQL 17 instance
downloaded via npm, then asserts the business rules. No Docker required.

```bash
cd tests/db
npm install
npm run pg:start
npm test          # 118 assertions
npm run pg:stop
```

`npm run inspect` dumps the resulting tables, constraints, triggers,
policies and seed data.

What the suite covers: stock derivation and ledger immutability; order
status driving reservations and issues; per-role authorization; tenant
isolation between two organizations; the full van cycle from loading
through cash and credit sales, returns with damage and shortage, to
reconciliation and approval; driver restrictions and manager category
scopes.

The suite emulates Supabase's `auth.users`, `auth.uid()` and the
`anon`/`authenticated`/`service_role` roles (`tests/db/shim.sql`). It is a
close approximation, not the hosted platform: PostgREST behaviour, Auth
email flows, storage and realtime are not covered.

## Notes

- Views use `security_invoker = on`, so RLS still applies through them.
- `mark_overdue_invoices()` flips due invoices to `overdue`; schedule it with
  pg_cron or call it from the app.
- `SECURITY DEFINER` functions bypass RLS by design, so each one re-checks
  authorization through `require_role()`. Any new function of that kind must
  do the same.
- The stock ledger is append-only. Migration 0009 has to suspend that guard
  to backfill `org_id`; any future migration touching historical movements
  must do so deliberately and restore the guard.
