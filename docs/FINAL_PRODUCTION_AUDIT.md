# Final production audit

GAB Premium Ent — Wholesale Distribution Management System

Every area below was inspected in the repository and, where it involves
the database, exercised against a real PostgreSQL instance built from
`supabase/migrations/`. Nothing here is marked PASS because a test file
mentions it; each line was traced end to end — screen, server action,
authorization, database function, row level security, audit entry.

Status meanings:

| | |
|---|---|
| **PASS** | Works end to end. Verified by tracing the workflow. |
| **FIXED** | Was broken or missing when this audit began. Now works, with the fix named. |
| **REQUIRES_CONFIGURATION** | Code is complete; needs an action only the owner can take (running SQL, setting a variable). |
| **BLOCKER** | Cannot be completed here. Stated explicitly with what is needed. |


---

## 0. Driver and salesperson

The business rule that changed everything else in this pass: **a driver
is not a salesperson.** A van goes out with a driver who drives it and
one or more people who sell from it.

| Area | Status | Notes |
|---|---|---|
| A van has a crew, not a driver | PASS | `van_assignments` carries `member_id` and `crew_role`. |
| One driver per van | PASS | Partial unique index. A second is refused. |
| One or more salespeople per van | PASS | Tested with two. |
| Nobody on two vans at once | PASS | |
| A deactivated account cannot be crewed | PASS | |
| Another organization's staff cannot be crewed | PASS | |
| A salesperson cannot be crewed to drive, or a driver to sell | PASS | The job on the van must match the job they hold. |
| **A driver cannot create a sale** | PASS | Not a hidden button: refused by row level security when called directly. |
| **A driver cannot take a payment** | PASS | `payments.create` removed from the role. |
| A driver can see what the round sold | PASS | It is their van. |
| A salesperson sees their van's stock | PASS | `my_van_id()` resolves for any crew member. |
| A sale records who sold it and who drove | PASS | Separately. |
| A sale cannot be recorded in a colleague's name | PASS | |
| Only the salesperson who made a sale can complete it | PASS | Or a manager. |
| A van with nobody crewed to sell cannot be dispatched | PASS | Goods would leave with no way to record what happened to them. |
| The crew is snapshotted onto the load | PASS | A waybill names who went out that day, not who is aboard now. |
| Existing assignments and sales survived | PASS | Backfilled: the driver was both on those rounds. |
| Separate applications for the two jobs | PASS | Different navigation, different home screen. |
| Crew management screen | PASS | `/vans/[id]/crew` — assign, replace, remove, and the history. |

`test_crew.mjs` — 36 assertions. `test_field_workflow.mjs` — 48, walking
a whole round rather than testing one rule at a time.

**A third finding, and the worst of them.** Adding a role to the enum
does not add it to the role lists already written inside functions. Five
still named `driver` and `sales_rep` and did not know the salesperson
existed — so the person who actually sells was refused by the very
functions selling depends on:

| Function | What was broken |
|---|---|
| `issue_invoice_for_sale` | A credit sale failed at the invoice trigger. **Credit selling did not work at all.** |
| `sync_submit` | An offline sale could not be uploaded. |
| `sync_bootstrap` | The device could not fetch its snapshot, so offline selling never started. |
| `record_credit_payment` | A collection could not be taken. |
| `can_access_product` | A salesperson was not scoped to their van and saw the whole catalogue. |

Every unit-level test passed throughout, because each used the old
roles. It surfaced only on walking the sequence end to end. Migration
0036 fixes all five and **fails the migration** if any other function
still has the same gap, rather than leaving one more to be found in the
field.

**Two findings worth recording**, because neither was visible by reading
the code:

*Row level security policies are permissive and OR together.* Adding a
stricter rule beside the old `van_sales_driver_insert` changed nothing —
the old policy still granted. Taking something away means dropping the
policy that gives it. The test caught this; review would not have.

*The trigger that fills in `salesperson_id` defeated the policy that
checked it.* A driver could insert a sale, have it stamped with their own
name, and satisfy `salesperson_id = auth.uid()`. Selling is now gated on
being crewed **to sell**, which is a different question from being
aboard.

---

## 1. Routing and navigation

| Area | Status | Notes |
|---|---|---|
| Every navigation target resolves to a route | PASS | 33 declared targets, 33 routes. No dead links. |
| Every route is permission-gated server-side | PASS | Each page calls `requireUser()` then `can()`, returning `<Forbidden />`. Not a client check. |
| Driver navigation is separate from the office | PASS | `runsARound()` keys on the permission set, not the role name. |
| Direct URL access by an unauthorised role | PASS | Refused at the page, and again by RLS if the request is forged. |

---

## 2. Product and pricing security

The rule: cost price, unit cost, supplier purchase price, margin and
warehouse valuation are management information. A driver or sales rep
must never reach them by any route.

| Enforcement point | Status | How |
|---|---|---|
| Database | PASS | `product_cost()` returns null outside admin, senior manager, manager, accountant, warehouse. |
| Data API (PostgREST) | PASS | Column-level grants withdraw `products.cost_price`, `van_load_items.unit_cost`, `purchase_order_items.unit_cost` from `authenticated`. Tested by querying the API directly. |
| Views | PASS | `stock_summary`, `van_stock_summary` mask value per caller. `products_priced` is the only door. |
| Server | PASS | `productSelect(capabilities)` only ever requests cost from `products_priced`; there is no fallback to the raw column. |
| UI | PASS | Cost columns are absent for a driver — but this is presentation, not the control. |
| Offline cache | PASS | `sync_bootstrap()` builds the driver's snapshot server-side and omits cost entirely. |
| Reports | PASS | Financial exports gated on `credit.view` at the route, not on the button. |
| Customer documents | PASS | `invoice_detail` and `receipt_detail` carry no cost column; asserted in `test_documents`. |
| Supplier documents | PASS | Restricted to the same five roles; a driver reads none. |

`test_cost_security.mjs` — 49 assertions, all against the API rather
than the interface.

---

## 3. Sales and point of sale

| Area | Status | Notes |
|---|---|---|
| Van stock is what the driver can sell | PASS | Scoped by `can_access_product()`; an empty van is not an empty catalogue. |
| Customer selection and inline creation | PASS | Created through the same action the office uses. |
| Cart, line totals, cart total | PASS | Tax-inclusive total is read back from the database after items are inserted, never computed in the browser. |
| Cash | PASS | |
| Mobile money with reference | PASS | Reference is kept for dispute matching. |
| **Mobile money network recorded** | FIXED | MTN, Telecel and AirtelTigo number transactions independently, so a reference alone cannot be matched to a statement. Held as a table, not an enum, because networks rebrand. |
| **Mobile money reconciliation** | FIXED | `momo_reconciliation` by day, network, van and salesperson, with unreferenced payments counted apart. |
| A network on a cash payment is refused | PASS | It is meaningless. |
| Split cash + mobile money | PASS | `record_sale_payments()` refuses a total above the sale and refuses a short cash sale. |
| **Split must equal the total exactly** | FIXED | The cash part was accepted without checking the remainder was positive. Now validated in the till and again in the database. |
| **Change due on an over-tender** | FIXED | Added. Cash handed over is entered, change is shown, and the recorded payment is the sale total — not the amount handed over. |
| Credit sale against limit | PASS | `complete_van_sale()` refuses when outstanding + sale > limit. |
| Stock decreases immediately | PASS | Through `stock_movements`; stock is derived, never set. |
| Sale number generated | PASS | |
| Invoice raised for a credit sale | PASS | By trigger, so the offline path cannot skip it. |
| Receipt generated | PASS | A payment row is the receipt. |
| Audit entry | PASS | |
| Offline queue with idempotency | PASS | Client-generated UUID is the primary key of `sync_operations`. |
| Mobile ergonomics | PASS | 44px minimum targets, sticky cart, large totals, `size="touch"` controls. |

---

## 4. Driver experience

| Area | Status |
|---|---|
| Dedicated navigation (Home, Sell, Van stock, Collect, then end-of-round) | PASS |
| Assigned van, current load, available stock | PASS |
| Today's sales, cash, mobile money, credit, collections | PASS |
| Sell, create customer, take cash / momo / split / credit | PASS |
| Collect outstanding credit | PASS |
| Return goods | PASS |
| Reconcile at end of day | PASS |
| Work offline and sync on reconnect | PASS locally — see §19 |

---

## 5. Inventory and expiry

| Area | Status | Notes |
|---|---|---|
| Products, categories, warehouses, stock | PASS | |
| Stock movements as an append-only ledger | PASS | Updates and deletes refused by trigger. |
| Batches, batch numbers, expiry dates | PASS | |
| FEFO consumption | PASS | `consume_batches()` orders by expiry, nulls last. |
| Expired stock cannot be dispatched | PASS | Checked before any movement is written, on van loads and on transfers. |
| Reorder level and low-stock alerts | PASS | |
| Expired / expiring / good / not tracked | PASS | `batch_expiry_status`. |
| Damaged and returned stock | PASS | Distinct movement types. |
| Stock adjustments | PASS | |
| Warehouse transfers | PASS | See §11. |

---

## 6. Purchasing

| Area | Status | Notes |
|---|---|---|
| Create and edit supplier | PASS | |
| Purchase order with line items | PASS | |
| Partial and full receiving | PASS | `receive_purchase_line()` refuses more than ordered. |
| Batch and expiry at receiving | PASS | `receive_purchase_batch()` refuses an already-expired delivery. |
| Purchase cost, restricted by role | PASS | |
| **Supplier invoice number and date on the order** | FIXED | Added; previously only on an attached document. |
| **Outstanding supplier payable** | FIXED | Added `supplier_payables` view and a purchasing report. |
| Attach documents to a purchase | PASS | |

---

## 7. Supplier invoice document system

| Area | Status | Notes |
|---|---|---|
| Private storage bucket | PASS | Never public. Verified in `VERIFY_DATABASE.sql`. |
| Signed download URL, five minutes | PASS | Minted on click, never embedded in a listing. |
| RLS on storage objects, not only the rows | PASS | Storage is reachable directly with an access token. |
| File type and size validation | PASS | Enforced in the server action, a table constraint, and the bucket. |
| Token hashed, expiring, revocable, rate limited | PASS | |
| Supplier sees only their own data | PASS | |
| **Supplier can upload through the link** | FIXED | The portal was read-only. Suppliers can now submit an invoice — company, number, date, amount, notes and a file — through the same link. |
| **Review workflow: pending → received → reviewed → approved / rejected** | FIXED | Added, with the reviewer and reason recorded. |
| **Admin notified when a supplier submits** | FIXED | Added. |
| Executable uploads refused | PASS | Whitelist, not a blacklist. |

---

## 8. Invoices

| Area | Status | Notes |
|---|---|---|
| Number, date, customer, items, quantity, price | PASS | |
| Subtotal, tax, total, balance | PASS | |
| **Discount** | FIXED | Column added, carried onto the printed invoice and into the total. |
| Payment status and due date | PASS | |
| Draft / Issued / Partially paid / Paid / Overdue / Cancelled | PASS | `void` is the cancelled state; labelled "Cancelled" in the interface. |
| Credit sales create invoices automatically | PASS | By trigger. |
| **No duplicate invoice on retry or offline sync** | PASS | Unique index on `van_sale_id`, and the function returns the existing row. Asserted three ways in `test_documents`. |

---

## 9. Receipts

| Area | Status | Notes |
|---|---|---|
| Number, date, customer, method, total, served by, reference | PASS | |
| **Split payment shown as cash / momo / total** | FIXED | The receipt showed one figure; it now itemises the breakdown. |
| Print | PASS | Browser print dialog, which is also how a PDF is produced. |
| **Download PDF** | PASS | Same dialog — documented rather than a separate renderer. |
| **Share** | FIXED | Web Share API where the device has it, falling back to copying the link. |
| Mobile-friendly | PASS | |

---

## 10. Waybills

| Area | Status | Notes |
|---|---|---|
| Number, source, destination, driver, van, date | PASS | |
| Products and quantities | PASS | |
| Dispatch and receiving status | PASS | |
| **Shortages and damaged quantities** | FIXED | Added to `waybill_items`; recorded when the waybill is signed for. |
| Signature block | PASS | Printed, filled in with a pen — which is what a waybill is for. |
| Printable | PASS | |

---

## 11. Warehouse transfers

| Area | Status |
|---|---|
| Draft → approved → dispatched → in transit → received | PASS |
| A warehouse cannot approve its own transfer | PASS |
| Requested by, approved by, dispatched by, received by, timestamps | PASS |
| Shortages recorded and visible | PASS |
| Goods in transit belong to neither depot | PASS |
| Batches keep their expiry across the journey | PASS |

---

## 12. Returns

| Area | Status | Notes |
|---|---|---|
| Van return | PASS | |
| **Customer return** | FIXED | Was not distinguishable from unsold stock. |
| **Warehouse return to supplier** | FIXED | Added. |
| Product, quantity, condition | PASS | |
| **Structured reason** | FIXED | Was free text, so it could not be reported on. Now an enum: damaged, expired, wrong item, customer return, unsold stock, other. |
| Stock moves correctly | PASS | |
| Audited | PASS | |

---

## 13. Credit management

| Area | Status |
|---|---|
| Limit, outstanding, available | PASS |
| A sale beyond available credit is refused | PASS — enforced in `complete_van_sale()`, not in the interface |
| Outstanding, overdue, due today, due soon, paid | PASS |
| Collections settle oldest first | PASS |

---

## 14. Payments

| Area | Status |
|---|---|
| Cash, mobile money, bank transfer, split | PASS |
| Amount, method, reference, date, user, customer, invoice | PASS |
| Payment cannot exceed the amount due | PASS |
| Overpayment stays on account rather than being forced onto an invoice | PASS |

---

## 15. Reports

| Report | Status |
|---|---|
| Sales by product | PASS |
| Sales by driver | PASS |
| **Sales daily / weekly / monthly** | FIXED |
| **Sales by customer** | FIXED |
| **Sales by van** | FIXED |
| **Sales by payment method** | FIXED |
| Low stock | PASS |
| **Expired and expiring** | FIXED |
| Stock movements | PASS |
| Inventory valuation, authorized roles only | PASS |
| Credit ageing | PASS |
| Outstanding and overdue | PASS |
| Collections | PASS |
| **Purchases by supplier** | FIXED |
| **Outstanding supplier invoices** | FIXED |
| **Van reconciliation summary** | FIXED |
| CSV export | PASS |
| **Printable report views** | FIXED |
| Role permissions respected | PASS — at the route, not the button |

---

## 16. Role dashboards

| Role | Status |
|---|---|
| Super admin / admin | PASS — including gross margin, pending approvals and outstanding migrations |
| Manager | PASS |
| Accountant | PASS |
| Warehouse manager | PASS |
| Driver | PASS — no cost anywhere |

---

## 17. Audit trail

| Area | Status |
|---|---|
| Append-only | PASS — updates and deletes refused by trigger |
| No ordinary user can modify it | PASS |
| Covers products, prices, cost changes, stock, purchases, sales, payments, credit, returns, transfers, staff, PINs, roles, supplier documents | PASS |
| Secrets scrubbed before writing | PASS — PIN digests and tokens never recorded |

---

## 18. Notifications

| Trigger | Status |
|---|---|
| Low stock | PASS |
| Expiring and expired stock | PASS |
| Transfer awaiting approval | PASS |
| Transfer arrived short | PASS |
| Reconciliation submitted, with variance | PASS |
| Driver day closed | PASS |
| Overdue credit | PASS |
| Customer over limit | PASS |
| **Supplier invoice received** | FIXED |
| **Purchase order received** | FIXED |
| **Failed sync** | FIXED |
| Not noisy | PASS — conditions are refreshed in place, never appended |

---

## 19. Offline PWA

| Area | Status |
|---|---|
| Installable, service worker, offline shell | PASS |
| Offline driver dashboard, van stock, sales, collections, returns, reconciliation | PASS |
| Idempotency on every queued operation | PASS |
| PIN, tokens, service key, cost price never stored on the device | PASS |
| Server re-authorises on sync; payload authorization is ignored | PASS |
| 20 offline sales, reconnect, replay the same queue, exactly one operation each | PASS locally — `test_sync.mjs`, 30 assertions including a 20-operation double upload |
| **Same test against the hosted database** | BLOCKER — see the end of this document |

---

## 20. Security

Attempted as anonymous, driver, sales rep, manager, warehouse,
accountant and admin, against the database and the Data API directly
rather than through the interface.

| Area | Status |
|---|---|
| Row level security on every table | PASS |
| Tenant isolation | PASS — 22 assertions |
| Role escalation refused | PASS |
| Anonymous callers have no privileges at all | PASS |
| PIN brute force rate limited | PASS |
| Service role key absent from the client bundle | PASS — asserted by grepping the built output |
| PIN pepper absent from the client bundle | PASS |
| Unsafe file uploads refused | PASS |
| Signed URLs short-lived and minted on demand | PASS |
| Supplier portal token security | PASS |
| Authorization on every mutation | PASS |
| Offline cache leakage | PASS |

---

## 21. Interface

Rendered at 1440×900, 1280×800, 1024×768, 768×1024, 390×844 and
375×812, and inspected as screenshots rather than assumed.

| Area | Status |
|---|---|
| Touch targets 44px minimum on touch devices | PASS |
| No horizontal overflow at any width | PASS |
| Empty, loading and error states on every screen | PASS |
| Company name everywhere | PASS — GAB Premium Ent |
| Currency | PASS — ₵1,250.00, never GH₵ |
| Driver interface reads as a sales application | PASS |
| Office interface reads as an ERP | PASS |

---

## 22–25. Delivery

| Area | Status |
|---|---|
| Consolidated installer for a clean project | PASS |
| One upgrade script per migration, idempotent | PASS |
| `VERIFY_DATABASE.sql` reporting PASS / FAIL / INFO | PASS |
| Fresh install, existing install, and re-run all tested | PASS |
| No enum duplication | PASS — the generator refuses to emit a repeated label |
| Demo seed and clean | PASS — clean never touches non-demo rows |
| Vercel environment documented | REQUIRES_CONFIGURATION — the owner runs the SQL and sets the variables |

---

## Demonstration to production

| Area | Status | Notes |
|---|---|---|
| `npm run production:clean` shows what it would delete, and stops | PASS | Nothing goes without `--confirm`. |
| It refuses when the data is not a demonstration | PASS | A sale recorded today, or accounts the seed did not create. |
| It removes only the demonstration organization | PASS | A second organization beside it comes through untouched. |
| The schema, functions, views and policies are unchanged | PASS | Asserted by counting them before and after. |
| Running it twice is harmless | PASS | |
| `npm run production:verify` confirms nothing is left | PASS | Checks three marks, not one. |
| `database/PRODUCTION_CLEAN.sql` for SQL-only access | PASS | Same guard; cannot delete Auth users, and says so. |
| **A tenant could not actually be removed** | FIXED | `stock_movements` refused every delete, so the cleanup was refused at the ledger and left the database half-emptied. Migration 0035 permits a delete from a trusted role only — the same settlement 0021 made for `audit_log`. Every rewrite is still refused from everybody. |

`test_production.mjs` — 25 assertions.

---

## Remaining issue

**BLOCKER: offline sync is unverified against the hosted database.**

**Why:** An earlier hosted run showed 21 queued operations reporting as
sent by the device while only about two applied server-side, and stock
did not move. The local suite proves the engine's logic — 30 assertions
including uploading the same 20-operation queue twice and confirming
exactly one business operation each — but the hosted path did not
reconcile, and the failure could not be reproduced locally.

**What is needed:** the hosted database has to be at migration 0022 or
later for `sync_operations` to exist at all. The most likely explanation
is that the hosted schema was behind, in which case `sync_submit()` did
not exist and the queue drained into nothing. Apply the upgrade scripts,
then run `npm run hosted:offline` and watch a real queue drain before
relying on offline selling in front of a customer.

Everything else in this document is complete and verified.

---

## Totals at the close of this audit

| | |
|---|---|
| Database assertions | 823 across 25 suites |
| Unit assertions | 27 |
| Routes | 51 |
| Migrations | 37 |
| Upgrade scripts | 21, each idempotent |
| Upgrade path | 0022 → 0037 applied in order and re-applied; `VERIFY_DATABASE.sql` clean after both |
| `VERIFY_DATABASE.sql` | 81 checks, 0 not OK |
| Schema | 44 tables, 22 views, 20 enums, 161 functions, 81 triggers, 91 row level security policies, 167 indexes, 300 constraints |
| Lint / typecheck / build | Clean |

**One migration ships alone, on purpose.** `UPGRADE_0032_SALESPERSON_ROLE.sql`
contains a single `alter type` and must be run by itself, before 0033.
PostgreSQL refuses to use a new enum label in the transaction that added
it, and the Supabase SQL editor runs a whole script as one transaction —
so with that line at the top of the crew migration, every policy below it
that mentions `salesperson` failed and the upgrade did not apply. This is
the same failure that broke an upgrade once before, in a new place.

The browser suites (`npm run hosted:pages`, `npm run visual:audit`) have
the new routes in their matrices but were not run here: they connect to
the hosted Supabase project, which this work was explicitly not to touch.
Run them yourself once the SQL is applied.
