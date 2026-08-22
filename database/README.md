# Database installation

Everything the system needs is in one file. You paste it into Supabase
once and the database is ready. No command line, no database password, no
CLI tools.

| File | What it is |
|---|---|
| `WHOLESALE_DISTRIBUTION_DATABASE.sql` | The installer. Paste this into Supabase. |
| `VERIFY_DATABASE.sql` | A read-only check. Paste it afterwards to confirm the install worked. |
| `FIX_ANON_GRANTS.sql` | Repair script. Only needed if verification row 16 fails. |
| `UPGRADE_0017_SIGNUP_GUARD.sql` | Upgrade for a database installed before migration 0017. |
| `UPGRADE_0018_PIN_AUTH.sql` | Upgrade for a database installed before migration 0018. Adds PIN sign-in. |
| `UPGRADE_0019_AUDIT_LOG.sql` | Upgrade for a database installed before migration 0019. Adds the audit trail. |
| `UPGRADE_0020_CATALOGUE.sql` | Upgrade for a database installed before migration 0020. Adds category status and locks stock to the ledger. |
| `UPGRADE_0022_OFFLINE_SYNC.sql` | Offline operation for the driver app. |
| `UPGRADE_0023_COST_SECURITY.sql` | Withdraws cost price from anybody who should not see it. |
| `UPGRADE_0024_BATCHES_AND_EXPIRY.sql` | Batch numbers and expiry dates. |
| `UPGRADE_0025_PAYMENT_METHODS.sql` | Cash, mobile money and split payments, counted apart at end of day. |
| `UPGRADE_0026_DOCUMENTS.sql` | Invoices, receipts and waybills. |
| `UPGRADE_0027_TRANSFERS.sql` | Warehouse transfers with a real approval step. |
| `UPGRADE_0028_NOTIFICATIONS.sql` | In-app notifications, per role. |
| `UPGRADE_0029_SUPPLIER_DOCUMENTS.sql` | Supplier paperwork in a private storage bucket. |
| `UPGRADE_0030_SUPPLIER_PORTAL.sql` | Expiring, revocable links suppliers use to see their own orders. |
| `build.mjs` | Regenerates the installer from `supabase/migrations`. You do not need to run this. |

**A new project needs none of these.** The installer already contains
everything up to and including 0030. The upgrade scripts are for a
database that was installed before a given change; run them in number
order, and re-running one is safe.

---

## Step 1 — Open your Supabase project

Go to [supabase.com](https://supabase.com) and open your project. If you do
not have one yet, create it, and **write down the database password Supabase
asks you to set** — you will not need it today, but you will eventually.

## Step 2 — Open the SQL Editor

In the left sidebar, click **SQL Editor**.

## Step 3 — Create a new query

Click **New query**. You will get an empty text box.

## Step 4 — Paste the installer

Open `database/WHOLESALE_DISTRIBUTION_DATABASE.sql`, select **all** of it
(Ctrl+A / Cmd+A), copy, and paste it into the box.

It is a large file (about 140 KB). Make sure you paste the whole thing —
the very last line should be:

```
$regrant$;
```

## Step 5 — Run it

Click **Run** (or press Ctrl+Enter / Cmd+Enter).

It takes a few seconds. You should see **Success. No rows returned**.

> **If you see an error instead**, nothing was installed — the whole
> script runs as a single transaction, so a failure leaves the database
> exactly as it was. Copy the error message and send it over rather than
> re-running or editing the file.

## Step 6 — Verify

Click **New query** again, paste the contents of
`database/VERIFY_DATABASE.sql`, and Run.

You will get a table. Every row in the **status** column should read `OK`
or `INFO`. For example:

```
 #  check                                     expected  actual  status
 1  Tables                                    29        29      OK
 2  Views                                     8         8       OK
 6  RLS policies                              67        67      OK
 7  Tables with RLS enabled                   29        29      OK
13  anon has NO table privileges              0         0       OK
15  anon cannot execute privileged functions  0         0       OK
```

If any row says `FAIL`, stop and send the table over.

### If row 16 fails

Row 16, "anon cannot read any table or view", is the decisive security
check. It fails on Supabase projects created before Supabase stopped
granting new tables to the `anon` role automatically: the project's own
default privileges hand every new table to `anon` as it is created.

Fix it by running `database/FIX_ANON_GRANTS.sql` the same way you ran the
installer. It removes those privileges, stops future objects inheriting
them, and leaves signed-in users untouched. It changes no business data
and is safe to run twice.

Then run `VERIFY_DATABASE.sql` again: row 16 should read `0` / `OK` and
row 18 should read `0`.

### If the audit rows fail

The audit trail arrived in migration 0019. If your database predates it,
run `database/UPGRADE_0019_AUDIT_LOG.sql`. Until then the Staff pages
work but their History panel reports that it is unavailable, and the
Audit trail page reports the same. That is deliberate: a missing table
is reported as a fault, never as an empty list.

### If rows 22 or 23 fail

Those two rows cover migration 0017:

- **Row 22, "Uninvited signups are created inactive."** Without it, turning
  on Google or any other sign-in provider lets anyone with an account at
  that provider sign in and read your catalogue and customer list.
- **Row 23, "Phone accepted as an identity."** Without it, a driver
  signing in with a phone number and no email fails outright.

If your database was installed before this migration existed, run
`database/UPGRADE_0017_SIGNUP_GUARD.sql` the same way you ran the
installer. It changes no business data and is safe to run twice.

**After running it**, accounts you create in Authentication are inactive
unless their user metadata carries an `org_id`. To activate one by hand:

```sql
update public.profiles
set is_active = true, role = 'admin'
where email = 'you@example.com';
```

### Signing in

Sign-in is a **four-digit PIN**. There is no username, email, Google or
SMS on the login screen.

The PIN is never stored. What the database holds is an HMAC of it under
`PIN_PEPPER`, a secret that lives only in the server environment, so a
copy of the database is not enough to recover anyone's PIN.

Before anyone can sign in you must set that secret:

```bash
openssl rand -hex 32     # put the result in .env.local as PIN_PEPPER
```

Changing it later invalidates every PIN, and they all need reissuing.

No two **active** people may share a PIN, enforced by a unique index.
Uniqueness is global rather than per organization: the login screen asks
for nothing but the PIN, so at the moment of lookup there is no
organization to scope by, and a PIN must resolve to exactly one person.

A PIN frees up automatically when an account is deactivated.

### Old sign-in methods

Email addresses are still held on each profile, because Supabase Auth
identifies an account by one and the session it issues depends on it.
They are not used to sign in and are not shown on the login screen.

Google, phone one-time codes and SMS are not used at all.

### If row 7 reports a different function count

An extra function usually means the project already contained something
before the installer ran. To see which:

```sql
select p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and not exists (select 1 from pg_depend d
                  where d.objid = p.oid and d.deptype = 'e')
order by p.proname;
```

Anything in that list beyond the 33 this system installs came from
elsewhere and is worth identifying before you rely on the database.

## Step 7 — Configure authentication

Go to **Authentication → Providers** and make sure **Email** is enabled.

Turn **off** "Enable email signups" if you want accounts to be created only
by an administrator. Every user in this system belongs to an organization
and carries a role, so self-service signup is usually not what you want.

## Step 8 — Create the first administrator

1. Go to **Authentication → Users → Add user**.
2. Enter an email and password. Tick **Auto Confirm User**.
3. Click **Create user**.

The system creates a matching profile automatically. Now make that person
an administrator: go back to **SQL Editor**, and run this, replacing the
email with the one you just used:

```sql
update public.profiles
set role = 'admin'
where email = 'you@example.com';
```

It should report `UPDATE 1`. If it reports `UPDATE 0`, the email does not
match — check for typos.

## Step 9 — Connect the application

In Supabase, go to **Project Settings → API** and copy two values:

- **Project URL**
- **anon public** key

In the project folder, copy `.env.example` to `.env.local` and fill them in:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=paste-the-anon-key-here
```

> The **service_role** key on that same page bypasses every security rule
> in this database. Never put it in a file that gets committed, and never
> give it to a browser. `.env.local` is already ignored by git.

## Step 10 — Start the application

```bash
npm install
npm run dev
```

Open http://localhost:3000 and sign in with the administrator account you
created in Step 8.

---

## What gets installed

- **40 tables** covering organizations, users, products, warehouses,
  stock, batches and expiry, customers, suppliers and their paperwork,
  sales, invoices, receipts, waybills, payments, purchasing, vans, van
  loading, van sales, returns, transfers, credit, reconciliation,
  notifications, the audit trail and the offline sync queue
- **17 reporting views**
- **66 functions**, including the business workflow (van dispatch, sale
  completion, returns, reconciliation, transfers) and the security helpers
- **78 triggers**
- **81 row level security policies**, with RLS enabled on every table
- Demo data: two warehouses, four categories, two suppliers, three
  customers, six products and opening stock

### Removing the demo data

The demo rows are useful for a first look and harmless to delete. To start
empty, run this **before** entering real data:

```sql
delete from public.stock_movements;
delete from public.inventory;
delete from public.products;
delete from public.categories;
delete from public.customers;
delete from public.suppliers;
delete from public.warehouses;
```

## After running an upgrade

Run `VERIFY_DATABASE.sql` again. It reports one row per check, and every
row should read **OK** or **INFO**. A **CHECK** row means the schema does
not match what this build expects; a **FAIL** row means something is
missing or a security rule is not in place.

Then redeploy the application. Until you do, features carried by the new
migration are hidden rather than broken - the application probes the
schema at startup, and the administrator's dashboard names any upgrade
that is still outstanding.

## Security notes

- **Multi-tenancy is enforced by the database.** A user in one
  organization cannot read or write another organization's rows, whatever
  the application sends.
- **Anonymous callers have no access at all** — no table privileges and no
  permission to execute business functions.
- **Stock is never edited directly.** Quantities are derived from an
  append-only ledger; corrections are reversing entries. The database
  refuses updates and deletes on that ledger.
- **A driver cannot approve their own cash or stock variance.** This is
  enforced by a constraint, by row level security, and by a check inside
  the approval function.
- **Cost price is management information.** It is withdrawn from the Data
  API entirely and reached only through a function that returns null to a
  driver or a sales rep. Hiding the column in the interface would have
  changed nothing.
- **A warehouse cannot approve its own transfer.** A depot that could
  sign off its own moves could move stock wherever it liked.
- **Supplier documents live in a private bucket** and are reached only by
  a signed URL that lasts five minutes. Row level security is applied to
  the stored objects as well as to the rows describing them, because
  storage is reachable directly with an access token.
- **Supplier portal links are stored as digests**, expire, can be revoked,
  and are rate limited per address. A leaked database backup hands over no
  working links.

## Re-running the installer

Do not run it twice on the same project — it creates objects and will
error on the second run. To start over, create a fresh Supabase project.

## Regenerating the installer (developers)

The migrations under `supabase/migrations/` are the source of truth. The
installer is generated from them:

```bash
node database/build.mjs
```

The generator declares the enums complete up front rather than appending
values, because PostgreSQL cannot use a new enum value in the transaction
that added it, and the SQL Editor runs a pasted script as one transaction.
That is the only difference between the installer and the migration
sequence; it is verified by `tests/db/test_installer.mjs`, which installs
the file into a fresh database and compares every object against the
migration-built schema.
