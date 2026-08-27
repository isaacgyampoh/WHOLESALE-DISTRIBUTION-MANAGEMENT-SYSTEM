# Wholesale Distribution Management System

Supabase (PostgreSQL) backend for a wholesale distribution business, covering
inventory, sales orders and invoicing, customers and suppliers, and role-based
access control.

## Status

| Layer | State |
|---|---|
| Database schema, triggers, views, RLS | Executed and verified against PostgreSQL 17.10 |
| Business rule test suite | 288 assertions, all passing |
| Real Supabase project | Not yet connected (no credentials supplied) |
| Next.js application | Catalogue, stock, selling, receipts, van crew and staff |

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

Stock has three named ways in, so a variance report can tell them apart.
`create_product_with_stock()` posts an `opening_stock` movement for the
quantity a product already had when it was first entered — that is part of
the Add Product form, not a stock count. `add_stock()` posts a receipt for
goods arriving outside a purchase order. `adjust_stock_to()` corrects a
figure by posting the *difference* as an adjustment, with a reason that is
required, so changing 50 to 45 leaves both numbers in the history.
`record_stocktake()` compares a physical count against the ledger and posts
`stocktake_in` / `stocktake_out` only for the lines that actually differ.

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

**Van crew** — `van_assignments` holds the whole crew, not just the driver:
`member_id` is the person and `crew_role` is the seat, `driver` or
`salesperson`. The driver keeps the van and answers for what is on it; the
salesperson crewed with them is the one who sells. Unique indexes enforce one
active driver per van and nobody crewed on two vans at once, which is what
makes "the caller's van" a single answer the server can trust.

**Selling** — `van_sales` / `van_sale_items` cover both a field sale off a
van and a counter sale from a shop: `van_id` and `warehouse_id` are mutually
exclusive, so an in-shop salesperson is not given a van to satisfy the schema.
`record_sale()` is the way a sale is made. It resolves the seller's authorized
location from their session through `resolve_sales_location()` — never from
the request — then writes the header, the lines, the stock movements and any
credit charge in one transaction. A driver calling it is refused. Overselling
is refused with the number that is actually there: *"Only 45 units of Tomatoes
are available in your van."*

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
`van_stock_summary`, `van_load_summary`, `reconciliation_variances`,
`sale_lines` (a sale with the names a receipt needs), `van_day_activity`
(what a van started the day's selling with, what went, what is left) and
`product_stock_by_location`.

## Setup

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run the files in `supabase/migrations/` **in
   filename order**, 0001 through 0021, **one file per run**. Order matters,
   and 0010 and 0020 must each be their own run: PostgreSQL forbids using a
   new enum value in the transaction that created it.
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
| sales_rep | own van, or all if in shop | write | read | own van only | sells | – | no |
| warehouse | read | read | write | load / receive | fulfil | – | returns |
| accountant | read | read | read | read | read | full | no |
| driver | own van only | create | none | own van, read only | **none** | collect | no |

A **driver cannot sell.** They hold no `sales.create` permission, no RLS policy
lets them insert a sale, and `record_sale()` refuses them by role. What they
have instead is visibility: their van's stock, every sale made from it today,
who made it, and what is left.

A `sales_rep` is a salesperson. Which stock they sell is decided by their
assignment, not by their role: crewed on a van they are a field salesperson and
see only that van; with `profiles.sales_warehouse_id` set they are an in-shop
salesperson and sell from that counter. Only an administrator can change that
column, guarded the same way as a role change.

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
npm test          # 288 assertions
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

`test_workflow.js` covers the selling workflow end to end: opening stock at
product creation, a correction that keeps its history, a stock count that
posts only what differs, a driver refused a sale in three different ways, a
salesperson selling from their own van and nobody else's, an oversell refused
with nothing left behind, a counter sale from a shop, and a credit sale
against the customer's limit.

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
