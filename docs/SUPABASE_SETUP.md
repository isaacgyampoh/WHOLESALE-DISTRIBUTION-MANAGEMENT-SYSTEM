# Supabase setup

Everything the database needs, in the order you run it. No part of this
requires anyone but you to have access to your Supabase account.

---

## 1. Create the project

1. In the Supabase dashboard, **New project**.
2. Choose a region close to Ghana — `eu-west-1` (Ireland) is the usual
   choice; `eu-west-2` (London) also works. Region affects how fast every
   page loads for people in Accra, so it is worth a moment.
3. Set a strong database password and **save it in your password
   manager**. You cannot read it back later, and you need it if you ever
   want to connect with `psql` or the Supabase CLI.
4. Wait for the project to finish provisioning.

---

## 2. Install the schema

1. Open **SQL Editor** → **New query**.
2. Open `database/WHOLESALE_DISTRIBUTION_DATABASE.sql` from this
   repository, copy all of it, paste it into the editor.
3. **Run**.

It is one transaction: it either installs completely or changes nothing.
Expect it to take a few seconds. It creates 40 tables, 17 views, 66
functions, 17 enums, 155 indexes, 270 constraints, 78 triggers, 81 row
level security policies, one private storage bucket and the Data API
grants.

The file is generated from `supabase/migrations/` by
`npm run db:build-installer` — never edit it by hand.

### If the project already has an older version of this schema

Do not run the installer again. Run only the upgrade files newer than
what is installed, in order:

| File | Adds |
|---|---|
| `database/UPGRADE_0017_SIGNUP_GUARD.sql` | Closes the self-registration hole |
| `database/UPGRADE_0018_PIN_AUTH.sql` | PIN sign-in |
| `database/UPGRADE_0019_AUDIT_LOG.sql` | The audit trail |
| `database/UPGRADE_0020_CATALOGUE.sql` | Category status; locks stock to the ledger |
| `database/UPGRADE_0021_AUDIT_PURGE.sql` | Lets a tenant be removed |
| `database/UPGRADE_0022_OFFLINE_SYNC.sql` | The offline sync engine — **required for the driver PWA** |
| `database/UPGRADE_0023_COST_SECURITY.sql` | **Security.** Stops drivers reading cost price and supplier terms |
| `database/UPGRADE_0024_BATCHES_AND_EXPIRY.sql` | Batches, expiry dates, and the block on dispatching expired stock |
| `database/UPGRADE_0025_PAYMENT_METHODS.sql` | Cash, mobile money and split payments, counted apart at end of day |
| `database/UPGRADE_0026_DOCUMENTS.sql` | Invoices raised automatically, receipts, and waybills |
| `database/UPGRADE_0027_TRANSFERS.sql` | Warehouse transfers with an approval step |
| `database/UPGRADE_0028_NOTIFICATIONS.sql` | In-app notifications, addressed by role |
| `database/UPGRADE_0029_SUPPLIER_DOCUMENTS.sql` | Supplier paperwork in a private storage bucket |
| `database/UPGRADE_0030_SUPPLIER_PORTAL.sql` | Expiring, revocable supplier links |

Every upgrade file is idempotent: running one twice is harmless, and
each ends with a `PASS`/`FAIL` check of its own work.

> **0023 is required by the current application.** It reads products
> through a masked view that 0023 creates. Run it before redeploying, or
> the Products, Reports and Warehouses screens will fail.

Everything from 0024 onwards degrades rather than breaks. The
application probes the schema when it starts and hides what the database
cannot support, so a missing upgrade shows up as a feature being absent -
and the administrator's dashboard names which script is outstanding.

### 0029 creates a storage bucket

`UPGRADE_0029_SUPPLIER_DOCUMENTS.sql` inserts a bucket named
**supplier-documents** and marks it private. After running it, open
**Storage** in the Supabase dashboard and confirm the bucket is listed
and shows as private. It should never be made public: the documents in
it carry purchase prices, and a public bucket is readable by anybody who
can guess a URL.

---

## 3. Verify

1. **SQL Editor** → **New query**.
2. Paste `database/VERIFY_DATABASE.sql` and run it.

Every row must read `PASS`. It checks the tables, views, functions,
triggers, policies, indexes, the required columns, that row level
security is on for every table, and that the Data API grants are what
they should be.

If anything reads `FAIL`, stop and fix it before going further. A `FAIL`
here means the application will misbehave in a way that is hard to
diagnose later.

---

## 4. Collect the keys

**Project Settings → API.**

| Value | Where it goes | Secret? |
|---|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` | No — it is in the browser bundle |
| `anon` / publishable key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | No — row level security governs everything it can do |
| `service_role` key | `SUPABASE_SERVICE_ROLE_KEY` | **Yes.** Bypasses every policy in the schema |

> The `service_role` key ignores row level security completely. Every
> tenant boundary, driver restriction and manager category scope in this
> schema is void for anything holding it. It belongs in server
> environment variables only — never in `NEXT_PUBLIC_*`, never in the
> repository, never in a screenshot.

You also need one value Supabase does not give you:

```
PIN_PEPPER
```

Generate it once, for this installation:

```bash
openssl rand -hex 32
```

PINs are stored as an HMAC of the PIN under this pepper. Changing it
invalidates every PIN in the system, so generate it once and keep it
somewhere you will not lose it. It is as sensitive as the service role
key.

---

## 5. Authentication settings

The application signs people in with a four-digit PIN against accounts an
administrator creates. It does not use email links, OAuth or phone OTP.

In **Authentication → Providers**, make sure:

- **Email** — leave enabled. It is how accounts are created internally by
  the server; nobody receives an email and nobody signs in with one.
- **Confirm email** — off. The server confirms accounts as it creates
  them.
- Every other provider (Google, phone, etc.) — off. The schema refuses
  self-registration regardless (migration 0017), but there is no reason to
  leave a door open.

In **Authentication → URL Configuration**, set the **Site URL** to your
production domain once Vercel has given you one.

---

## 6. Create the first administrator

The schema deliberately has no way for somebody to sign themselves up.
The first administrator is made by you, once:

```bash
# With the production values in .env.local
npm run demo:seed        # a full demonstration organization, or
```

For a **real** company rather than the demo, create the organization and
the first administrator directly in the SQL editor:

```sql
-- 1. The company
insert into public.organizations (name, slug, country, currency)
values ('GAB Premium Ent', 'gab-premium-ent', 'GH', 'GHS')
returning id;
```

Then in **Authentication → Users → Add user**, create the administrator's
account with any internal email address, and set their user metadata to:

```json
{
  "full_name": "Their Name",
  "role": "admin",
  "org_id": "<the id returned above>"
}
```

Their profile row is created automatically by a trigger. Finally set
their PIN — the application never stores the PIN itself, only its digest:

```sql
-- Replace 1234 with their PIN and <pepper> with your PIN_PEPPER
update public.profiles
   set pin_hash = encode(hmac('1234', '<pepper>', 'sha256'), 'hex'),
       pin_set_at = now()
 where email = 'their-address@yourcompany.com';
```

They can change it themselves under **Your account** once signed in.

---

## 7. Checks worth doing before you hand it over

Run these in the SQL editor. Each should return no rows.

```sql
-- Any table without row level security is a tenant leak waiting to happen.
select relname from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

-- anon must not be able to read business data.
select table_name, privilege_type
  from information_schema.role_table_grants
 where grantee = 'anon' and table_schema = 'public';

-- Nobody should be able to rewrite history.
select tgname from pg_trigger
 where tgrelid = 'public.audit_log'::regclass and not tgisinternal;
```

---

## Related

- `docs/VERCEL_DEPLOYMENT.md` — putting the application online
- `docs/DEMO_TO_PRODUCTION.md` — moving from the demonstration to a real client
- `docs/SECURITY.md` — what the schema actually enforces, and how to test it
