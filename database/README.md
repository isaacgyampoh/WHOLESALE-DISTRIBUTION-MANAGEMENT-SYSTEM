# Database installation

Everything the system needs is in one file. You paste it into Supabase
once and the database is ready. No command line, no database password, no
CLI tools.

| File | What it is |
|---|---|
| `WHOLESALE_DISTRIBUTION_DATABASE.sql` | The installer. Paste this into Supabase. |
| `VERIFY_DATABASE.sql` | A read-only check. Paste it afterwards to confirm the install worked. |
| `build.mjs` | Regenerates the installer from `supabase/migrations`. You do not need to run this. |

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

- **29 tables** covering organizations, users, products, warehouses,
  stock, customers, suppliers, sales, invoices, payments, purchasing,
  vans, van loading, van sales, returns, credit and reconciliation
- **8 reporting views**
- **33 functions**, including the business workflow (van dispatch, sale
  completion, returns, reconciliation) and the security helpers
- **64 triggers**
- **67 row level security policies**, with RLS enabled on all 29 tables
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
