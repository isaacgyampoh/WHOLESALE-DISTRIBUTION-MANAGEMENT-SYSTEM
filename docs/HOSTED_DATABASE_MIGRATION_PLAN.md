# Hosted database migration plan

GAB Premium Ent — project `ujzk…supabase.co`

**Nothing in this document has been applied.** The hosted database is
unchanged. What follows was established by reading it, not by assuming.

---

## How this was determined

Migration numbers were not trusted. Each one was checked by asking the
hosted database for an object it creates — a table, a view, a function,
or a specific column — through the Data API using the service role key.
Every request was a zero-row select. Nothing was written.

That distinction matters here: this database has **0022 applied but not
0020 or 0021**, which no ordering assumption would have predicted.

---

## Current hosted state

**40 relations, 23 functions exposed.** There is real business data:

| | |
|---|---|
| Organizations | 3 |
| Staff profiles | 27 |
| Products | 18 |
| Customers | 6 |
| Sales | 16 |
| Stock movements | 253 |
| Suppliers | 5 |
| Warehouses | 3 |
| Van assignments | 4 |

Organizations present:

| Slug | Name |
|---|---|
| `default` | Default Organization |
| `gab-premium-ent-demo` | GAB Premium Ent — DEMO |
| `purge-probe-tmp` | ZZ INERT - remove after UPGRADE_0021 |

The third is mine — a leftover from a probe in an earlier session. It
holds nothing and should be removed, but I have not touched it.

---

## Migration ledger

| Migration | Marker checked | Hosted | Action |
|---|---|---|---|
| 0001–0019 | base schema, `audit_log` | present | **skip** |
| **0020** | `categories.is_active` | **column absent** | **apply** |
| 0021 | audit purge function | present | skip |
| 0022 | `sync_operations` + `sync_submit()` | present | skip |
| **0023** | `products_priced` view | **missing** | **apply** |
| **0024** | `products.track_expiry` | **column absent** | **apply** |
| **0025** | `van_sale_payments` | **missing** | **apply** |
| **0026** | `waybills` | **missing** | **apply** |
| **0027** | `stock_transfer_summary` | **missing** | **apply** |
| **0028** | `notifications` | **missing** | **apply** |
| **0029** | `supplier_documents` | **missing** | **apply** |
| **0030** | `supplier_portal_tokens` | **missing** | **apply** |
| **0031** | `stock_returns` | **missing** | **apply** |
| **0032** | `salesperson` enum label | not readable over the API | **apply** |
| **0033** | `van_assignments.member_id` | **column absent** | **apply** |
| **0034** | `momo_providers` | **missing** | **apply** |
| **0035** | ledger purge guard | not readable over the API | **apply** |
| **0036** | salesperson role lists | not readable over the API | **apply** |
| **0037** | `products.image_path` | **column absent** | **apply** |

**0022 was applied out of order**, before 0020 and 0021. Neither depends
on it, so applying them now is safe — but it is why the number alone
could not be trusted.

0032 and 0035 change a function body and an enum, neither of which the
Data API exposes. They are listed as *apply* because everything around
them is missing; both are idempotent, so applying one already present is
a no-op.

---

## Objects that already exist

`audit_log`, `auth_pin_attempts`, `categories`, `credit_transactions`,
`customer_balances`, `customer_credit_position`, `customer_statement`,
`customers`, `inventory`, `invoice_ageing`, `invoices`,
`manager_category_scopes`, `organizations`, `payments`, `products`,
`profiles`, `purchase_order_items`, `purchase_orders`,
`reconciliation_variances`, `sales_order_items`, `sales_orders`,
`stock_movements`, `stock_summary`, `stock_transfer_items`,
`stock_transfers`, `suppliers`, `sync_operations`, `van_assignments`,
`van_inventory`, `van_load_items`, `van_load_summary`, `van_loads`,
`van_reconciliations`, `van_return_items`, `van_returns`,
`van_sale_items`, `van_sales`, `van_stock_summary`, `vans`, `warehouses`

---

## Objects that are missing

**Relations (19):** `products_priced`, `product_batches`,
`van_sale_payments`, `waybills`, `waybill_items`, `invoice_detail`,
`receipt_detail`, `stock_transfer_summary`, `stock_in_transit`,
`notifications`, `supplier_documents`, `supplier_portal_tokens`,
`supplier_payables`, `stock_returns`, `van_load_crew`, `momo_providers`,
`van_crew`, `salesperson_performance`, `momo_reconciliation`

**Functions (12):** `product_cost`, `receive_purchase_batch`,
`record_sale_payments`, `issue_invoice_for_sale`,
`approve_stock_transfer`, `refresh_standing_alerts`,
`resolve_supplier_token`, `submit_supplier_document`,
`record_stock_return`, `is_van_crew`, `is_van_salesperson`,
`issue_waybill_for_load`

Until these exist the application runs and *quietly lacks* the features
that depend on them. It does not break: each is probed at startup and
the screens that need one say which script is outstanding. The
administrator's dashboard names them too.

---

## The order to run them

Each file is idempotent. Run them as separate queries, in this order,
and read the result of each before starting the next.

```
 1.  UPGRADE_0020_CATALOGUE.sql
 2.  UPGRADE_0023_COST_SECURITY.sql
 3.  UPGRADE_0024_BATCHES_AND_EXPIRY.sql
 4.  UPGRADE_0025_PAYMENT_METHODS.sql
 5.  UPGRADE_0026_DOCUMENTS.sql
 6.  UPGRADE_0027_TRANSFERS.sql
 7.  UPGRADE_0028_NOTIFICATIONS.sql
 8.  UPGRADE_0029_SUPPLIER_DOCUMENTS.sql
 9.  UPGRADE_0030_SUPPLIER_PORTAL.sql
10.  UPGRADE_0031_SUPPLIER_SUBMISSIONS.sql
11.  UPGRADE_0032_SALESPERSON_ROLE.sql   <-- ON ITS OWN. See below.
12.  UPGRADE_0033_VAN_CREW.sql
13.  UPGRADE_0034_MOMO_PROVIDER.sql
15.  VERIFY_DATABASE.sql
```

`UPGRADE_0021_AUDIT_PURGE.sql` is not in the list: 0021 is already
applied. Running it again would be harmless but pointless.

---

## Step 11 is the one that will catch you out

**`UPGRADE_0032_SALESPERSON_ROLE.sql` contains one statement and must be
run entirely on its own.** Paste it, run it, let it finish, clear the
editor, then paste the next file.

PostgreSQL refuses to *use* a new enum label in the same transaction that
added it, and the Supabase SQL editor runs whatever is in the editor as
one transaction. `UPGRADE_0033` creates policies that mention
`salesperson`, so putting the two together fails.

This was tested rather than assumed, on a database built to exactly the
hosted state:

```
label present before:        no
combined in one transaction: REFUSED - unsafe use of new value
                             "salesperson" of enum type user_role
0032 alone, then 0033:       OK / OK
crew columns after:          2/2
```

Running 0032 twice is also safe (`add value if not exists`), and it
leaves no duplicate labels — checked, because a duplicated enum label is
what broke an upgrade on this project once before.

---

## After each file

The SQL editor reports success or the exact failure. In addition, each
`UPGRADE_*.sql` **ends with its own verification query** — a short list
of PASS/FAIL rows for the objects it just created. Read it. If any row
says FAIL, stop and do not run the next file.

At the end, `VERIFY_DATABASE.sql` checks the whole schema: tables, views,
enums and their exact members, functions, triggers, indexes, constraints,
row level security, grants, storage, cost-price protection, the crew
model, payments, invoices, expiry and offline sync.

**Expected: 81 checks, every row OK or INFO.** A `CHECK` row means a
count differs from this build; a `FAIL` row means something is missing or
a security rule is not in place.

---

## If a migration fails

Stop. Do not run the next one.

Every script is one transaction, so a failure leaves the database exactly
as it was — there is no half-applied state to unpick.

Send me the error text. Do not delete an object to "make room": if a
script says something already exists, that is information about the
database's real state, and the fix belongs in the script.

---

## What is not covered here

**Supabase Auth users.** No script creates or removes them. Staff
accounts are made under Authentication → Users, and PINs are set in the
application.

**Storage.** Two buckets, and the difference between them is deliberate.

`UPGRADE_0029` creates `supplier-documents` — **private**. The files in
it carry purchase prices.

`UPGRADE_0037` creates `product-images` — **public**. A product
photograph is the thing the customer is holding, and it has to be public
because a signed URL expires: a phone that cached its round at six in the
morning and has had no signal since cannot mint a new one. The service
worker also caches by URL, which a signed URL defeats by being different
every time.

After running both, confirm in Storage that each shows the right
visibility.

**The demonstration data.** Removing it is a separate step —
`npm run production:clean`, or `database/PRODUCTION_CLEAN.sql`. See
`docs/DEMO_TO_PRODUCTION.md`. Do that *after* the upgrades, not before.

---

## Current blocker

**Hosted verification is blocked by database credentials.**

`SUPABASE_DB_URL` in `.env.local` still contains the placeholder
password from the connection-string template, so no statement can be
executed against the hosted database.

The read-only inspection above was done with `SUPABASE_SERVICE_ROLE_KEY`
over the Data API, which needs no database password — but that API cannot
run DDL, so it can report the state and not change it.

To unblock, replace that line in `.env.local` (not in chat) with the
pooler connection string:

```
SUPABASE_DB_URL=postgresql://postgres.ujzknvmbugqnvvezmged:[YOUR-DATABASE-PASSWORD]@aws-1-eu-west-1.pooler.supabase.com:5432/postgres
```

The region `aws-1-eu-west-1` was confirmed by connection attempt: every
other region reported "tenant not found", that one recognised the project
and rejected only the password. Use the **session pooler on port 5432**,
not the direct host — `db.ujzk….supabase.co` is IPv6-only and unreachable
from this machine.

Alternatively, run the fourteen files by hand in the SQL editor in the
order above. That needs no credential from me at all.
