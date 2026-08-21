# Wholesale Distribution Management System

Supabase (PostgreSQL) backend for a wholesale distribution business, covering
inventory, sales orders and invoicing, customers and suppliers, and role-based
access control.

## Status

| Layer | State |
|---|---|
| Database schema, triggers, views, RLS | Written, not yet executed |
| Next.js application | Not started (needs Node.js installed) |

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

**Reporting views** — `customer_balances` (credit exposure), `stock_summary`
(on hand / reserved / available plus a reorder flag), `invoice_ageing`
(current / 1-30 / 31-60 / 61-90 / 90+).

## Setup

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run the files in `supabase/migrations/` **in
   filename order**, 0001 through 0008. Order matters — later files depend on
   types and functions defined in earlier ones.
3. Create your user under **Authentication → Users**.
4. Promote it to admin:
   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```
5. Copy the project URL and anon key from **Project Settings → API** for the
   app layer.

`0008_seed.sql` loads demo warehouses, categories, suppliers, customers,
products, and opening stock. Skip it for a production project.

## Role permissions

| | Catalogue | Customers | Stock | Sales orders | Invoices | Purchasing |
|---|---|---|---|---|---|---|
| admin | full | full | full | full | full | full |
| manager | full | full | full | full | full | full |
| sales_rep | read | write | read | own orders | read own | – |
| warehouse | read | read | write | fulfil | – | read |
| accountant | read | read | read | read | full | read |

## Notes

- Views use `security_invoker = on`, so RLS still applies through them.
- `mark_overdue_invoices()` flips due invoices to `overdue`; schedule it with
  pg_cron or call it from the app.
- The schema has been checked for statement ordering and quoting, but has not
  been executed against a live Postgres instance yet.
