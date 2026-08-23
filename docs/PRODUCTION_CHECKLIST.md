# Production checklist

Work down this list once. Every step is something only you can do — the
code is finished and tested, but nothing here has touched your Supabase
project or your Vercel account.

Tick each box before moving on. The order matters: the database has to
be right before the application is deployed against it, and the
application has to be up before anybody is given a PIN.


---

## 0. What is on your database right now

Inspected read-only. **No real client business data was found anywhere** —
so nothing below is destructive to work anybody has done.

| Organization | What is in it |
|---|---|
| `gab-premium-ent-demo` | The demonstration: 27 staff, 16 sales, 247 stock movements, 24 vans |
| `default` | 3 customers, 6 products, 2 suppliers, 2 warehouses, **no staff, no sales** — leftover seed data from the original installer |
| `purge-probe-tmp` | Empty. A probe I left behind in an earlier session; remove it |

**Three things to deal with before go-live:**

- [ ] **23 leftover test accounts have working PINs.** Named "Offline
      Tester" and "Flow Tester", created by hosted test runs. They sit in
      the demonstration organization and every one can sign in. They go
      when the demonstration organization does — but until then they are
      23 live credentials.

- [ ] **`npm run production:clean` currently refuses**, and it is right
      to. It found a sale recorded the previous day and 23 accounts the
      seed did not create, which is exactly the pattern of somebody
      trading in the demonstration organization. In this case they are
      test artefacts rather than real work — but the script cannot know
      that, and a script that guesses is one you cannot trust later.

      To proceed, remove the test accounts first, or delete the
      demonstration organization by hand knowing what is in it.

- [ ] **`purge-probe-tmp` is mine and should go.** It holds nothing.

- [ ] **Decide about `default`.** It has no staff and no sales, only seed
      products and customers. If the client is not going to use it, it is
      clutter; if they are, those six products are placeholders.

---

## 1. The database

- [ ] **Open your Supabase project** → SQL Editor → New query.

- [ ] **New project?** Paste `database/WHOLESALE_DISTRIBUTION_DATABASE.sql`
      in full and run it. It is one transaction: it either installs
      completely or changes nothing.

- [ ] **The project you already have?** Do **not** run the installer.
      `docs/HOSTED_DATABASE_MIGRATION_PLAN.md` lists exactly which
      upgrade scripts are missing, verified object by object rather than
      by migration number — which matters, because that database has 0022
      applied but not 0020 or 0021.

      **`UPGRADE_0032_SALESPERSON_ROLE.sql` must be run entirely on its
      own**, before 0033. PostgreSQL will not use a new enum label in the
      transaction that added it, and the SQL editor runs whatever is in
      it as one transaction. Tested both ways; the plan shows the result.

- [ ] **Run `database/VERIFY_DATABASE.sql`.** Every row must read **OK**
      or **INFO**. A **CHECK** row means the schema does not match this
      build; a **FAIL** row means something is missing or a security rule
      is not in place. Do not continue past a FAIL.

- [ ] **Storage → confirm the `supplier-documents` bucket exists and shows
      as private.** It is created by upgrade 0029. It must never be made
      public: the files in it carry purchase prices.

---

## 2. Environment

Four values. Two are public, two must never leave the server.

| Variable | Where it comes from | Public? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → Project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → `anon` `public` | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role` | **No** |
| `PIN_PEPPER` | Generate one: `openssl rand -base64 48` | **No** |

- [ ] Set all four in **Vercel → Project → Settings → Environment
      Variables**, for **Production**.

- [ ] **`PIN_PEPPER` is written down somewhere safe.** Changing it later
      invalidates every PIN in the system, and every person needs a new
      one.

- [ ] Neither secret is prefixed `NEXT_PUBLIC_`. Anything with that prefix
      is compiled into the browser bundle.

---

## 3. Deploy

- [ ] **Deploy to Vercel.** The build must succeed with no warnings
      suppressed.

- [ ] **Confirm no secret reached the browser**, from the project root:

      ```bash
      npm run build
      grep -rl "$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2-)" .next/static | wc -l   # 0
      grep -rl "$(grep '^PIN_PEPPER=' .env.local | cut -d= -f2-)" .next/static | wc -l                  # 0
      ```

      Both must print `0`.

- [ ] **Open the deployed site.** You should see the PIN screen. Not an
      error, and not a setup page — a setup page means the environment
      variables did not reach the build.

---

## 4. The first administrator

- [ ] **Supabase → Authentication → Users → Add user.** Create one account
      for yourself. The email is only an identifier; nobody signs in with
      it.

- [ ] **Sign in with the initial Super Administrator PIN** and immediately
      **change it** from the account screen. Leaving the demo PIN in place
      on a production system is the single most likely way this gets
      broken into.

- [ ] **Create your real staff** under Staff, each with their own PIN. No
      shared accounts: the audit trail is only worth having if a name in
      it means one person.

---

## 5. Before you let anybody use it

- [ ] **Set real credit limits** on every customer. The default is zero,
      which refuses every credit sale — correct, but it will look broken
      to a driver who does not know why.

- [ ] **Set reorder points** on the lines you actually watch. Without them
      the low-stock report and its notification stay silent.

- [ ] **Turn on batch and expiry tracking** for the products that need it
      (Products → the product → Batches and expiry). It is off by
      default: a crate does not expire and should not be made to carry a
      date.

- [ ] **Crew every van.** Each needs a driver *and* at least one
      salesperson: a van with nobody crewed to sell cannot be dispatched
      at all, and a salesperson with no van sees an empty round.
      Vans → open one → Crew.

- [ ] **Remove the demo data** — see `docs/DEMO_TO_PRODUCTION.md`. Run it
      *before* real data goes in, and understand that `npm run demo:clean`
      only ever removes rows the demo seed created.

---

## 6. Things worth checking with a real person

Not automated tests — these are the ones that fail in ways a test cannot
see.

- [ ] **A driver signs in on their own phone**, on mobile data, and
      installs the app to their home screen.

- [ ] **They make a sale with the phone in aeroplane mode**, then turn the
      connection back on and watch the queue drain. Confirm the stock
      moved and the sale appears once, not twice.

      This is the one part of the system that has not been verified
      against a hosted database — see the note at the end of
      `docs/FINAL_PRODUCTION_AUDIT.md`. Do it with a **salesperson**
      account: a driver cannot record a sale.

- [ ] **A cash sale, a mobile money sale and a split**, and confirm the
      end-of-day figures separate cash from mobile money.

- [ ] **A supplier opens their portal link** and sends an invoice through
      it. Confirm it appears in the review queue.

- [ ] **Print an invoice and a waybill** on the printer the business
      actually uses.

---

## 7. Ongoing

- [ ] **Someone reviews the audit trail weekly.** It is append-only and
      nobody can edit it, which only helps if somebody reads it.

- [ ] **Supabase backups are on.** Point-in-time recovery is a paid
      feature; daily backups are not. Know which you have.

- [ ] **The service role key is rotated** if it is ever pasted anywhere it
      should not be — Supabase → Settings → API → Reset, then update
      Vercel and redeploy.

---

## If something is wrong

| Symptom | Almost always |
|---|---|
| A feature is missing rather than broken | An upgrade script has not been run. The administrator's dashboard names which one. |
| The Products or Reports screen fails | Upgrade 0023 has not been run. |
| Drivers cannot sell offline | Upgrade 0022 has not been run. |
| A supplier link says it does not work | It expired, or was revoked. Issue a new one. |
| Sign-in says the account is not active | The profile exists but is deactivated, or has no PIN set. |
| Setup page instead of the PIN screen | The environment variables did not reach the build. |
