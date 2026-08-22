# From demonstration to a real client system

You show the demo, the client says yes, and you turn the same
application into their live system. No rebuild, no code changes — the
difference between demo and production is entirely environment
variables and data.

---

## Why no code changes are needed

Nothing about the demonstration is compiled in. There is no demo
organization id in the source, no demo PIN, no demo product, no
conditional "if demo" branch anywhere. The demo is a seed script that
writes rows, and those rows live in their own organization, kept apart
from everything else by the same row level security that keeps any two
clients apart.

So "switching to production" means: point at a production database,
create the real company, delete the demo rows.

---

## Two ways to do it

**Separate projects** (recommended). One Supabase project for demos, one
for the client. Nothing the client's data can ever be mixed with a
demonstration, and you can keep demoing after they go live.

**One project** (fine, and simpler). The demo lives in its own
organization alongside the real one and is removed with
`npm run demo:clean` when you are finished with it.

The steps below cover both; where they differ it is called out.

---

## 1. Before the demonstration

```bash
# .env.local pointing at your demo Supabase project
npm run demo:seed
```

This creates a complete, coherent business: a company, four staff, three
categories, twelve products with deliberately varied stock, a supplier, a
warehouse, customers, a van and driver, a purchase order part-received, a
dispatched load, four van sales in cash and credit, a mobile-money
collection, a return with damaged and missing stock, and an end-of-day
reconciliation showing a real cash and stock variance.

Every stage goes through the same database functions the application
uses. Nothing is a fixture: if the workflow were broken, the seed would
fail rather than produce tidy numbers.

It prints the PINs it issued:

```
1024   Demo Super Administrator (admin)
2048   Adwoa Demo (manager)
3072   Kojo Demo (driver)
4096   Efua Demo (accountant)
```

Running it again changes nothing, and it will not reset a PIN somebody
has already changed.

### Worth demonstrating

- Sign in as **1024**. The dashboard shows the day's real trading position.
- **Products → a product → Adjust stock.** Then **Audit trail** — the
  change is there, with who made it.
- Sign in as **3072** on a phone. A different application: their van,
  their load, four big buttons.
- **Turn on flight mode.** Record a sale. It still works, and says it
  will send when there is a signal. Turn flight mode off; watch it go.
- Sign in as **2048**. They see only their assigned categories — and
  typing another category's URL directly is refused by the server.

---

## 2. Production database

Follow `docs/SUPABASE_SETUP.md` against the production project:

1. Create the project.
2. Run `database/WHOLESALE_DISTRIBUTION_DATABASE.sql`.
3. Run `database/VERIFY_DATABASE.sql` — every row must read `PASS`.
4. Collect the URL, the anon key and the service role key.
5. Generate a **new** `PIN_PEPPER` for production:
   `openssl rand -hex 32`.

> Use a different pepper from the demo. If the two share one, a PIN
> issued in a demonstration would work against the client's live system.

---

## 3. Create the real company

In the Supabase SQL editor:

```sql
insert into public.organizations (name, slug, country, currency)
values ('GAB Premium Ent', 'gab-premium-ent', 'GH', 'GHS')
returning id;
```

Keep that id.

---

## 4. Create the first administrator

**Authentication → Users → Add user.** Any internal email address; the
client never uses it to sign in. Set the user metadata to:

```json
{
  "full_name": "Owner's Name",
  "role": "admin",
  "org_id": "<the id from step 3>"
}
```

Then set their PIN:

```sql
update public.profiles
   set pin_hash = encode(hmac('4821', '<production PIN_PEPPER>', 'sha256'), 'hex'),
       pin_set_at = now()
 where email = 'owner@theircompany.com';
```

Give them that PIN privately and have them change it under **Your
account** at first sign-in. Once they do, the one you set stops working —
which is the point.

---

## 5. Deploy

Follow `docs/VERCEL_DEPLOYMENT.md` with the production values. If the
demo is on a separate Vercel project, nothing about it changes.

---

## 6. Set up the client's own data

Signed in as the administrator, in this order — each step depends on the
one before it:

1. **Settings** — check the company name, country and currency.
2. **Staff** — create their people, assign roles, issue PINs. For each
   manager, tick the categories they are responsible for.
3. **Categories** — their real product categories.
4. **Products** — their catalogue: code, category, unit, cost, selling
   price, and the reorder point that drives the low-stock warnings.
5. **Warehouses** — where stock is held. Mark one as default.
6. **Purchasing** — their suppliers, then a purchase order for opening
   stock and receive it. This is the honest way to bring stock in: it
   arrives through the ledger with an order behind it, rather than
   appearing from nowhere.
7. **Customers** — the customer book, with credit limits and payment
   terms.
8. **Vans** — the fleet, and assign each driver to a van.

Opening stock can also be posted as an adjustment on each product with
the reason "Opening stock count", if there is no purchase order to
receive against. Either way it goes through the ledger.

---

## 7. Remove the demonstration

**Separate projects:** nothing to do. The demo project is untouched.

**One project:**

```bash
# .env.local pointing at that project
npm run demo:clean
```

It finds the demo organization by its slug and removes only rows in it.
Every delete is filtered on that organization id, and the id is never
taken from an argument, so it cannot reach the client's data. If the
demo organization is absent it does nothing at all.

> `demo:clean` needs migration 0021. Without it, an organization that has
> recorded any audited action cannot be removed — `audit_log` references
> it and its rows were undeletable by anyone. If the demo will not
> delete, run `database/UPGRADE_0021_AUDIT_PURGE.sql` first.

Afterwards, confirm what is left:

```sql
select name, slug, is_active from public.organizations;
```

Only the client's organization should remain.

---

## 8. Before handing over

- [ ] `VERIFY_DATABASE.sql` reads `PASS` on every row.
- [ ] The demo organization is gone (or is in a separate project).
- [ ] The owner has signed in and changed their PIN.
- [ ] Their staff can sign in with the roles you gave them.
- [ ] A manager sees only their categories, and typing another
      category's URL is refused.
- [ ] A driver can install the app on their phone and record a sale in
      flight mode.
- [ ] The audit trail shows the setup work you just did.
- [ ] The production service role key and PIN pepper are in your password
      manager and nowhere else.

---

## What to tell the client

Two things matter operationally and are worth saying out loud:

**PINs cannot be recovered, only reset.** Nobody — not you, not an
administrator, not the database — can read somebody's PIN. An
administrator resets it and hands over a new one.

**Stock is never edited, only moved.** Every change to a quantity is a
movement in an append-only ledger with a reason and a person against it.
Corrections are reversing movements. That is why the numbers can be
trusted, and it is why there is no "just fix the number" button.
