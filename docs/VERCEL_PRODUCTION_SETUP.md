# Deploying to Vercel

GAB Premium Ent

Exact steps. Nothing here has been done for you — no deployment, no
environment variable, no connection to your accounts.

---

## Before you start

The database must be ready first. The application reads the schema at
startup and degrades where it is behind, so deploying against an
un-upgraded database gives you an application that runs and quietly
lacks features. Do `docs/SUPABASE_SETUP.md` first, then come back.

---

## 1. The four environment variables

| Variable | Where it comes from | Reaches the browser? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → Project URL | Yes, by design |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → `anon` `public` | Yes, by design |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role` | **Never** |
| `PIN_PEPPER` | You generate it: `openssl rand -base64 48` | **Never** |

The first two are public on purpose: the anon key is useless without a
session, and every table is behind row level security.

The last two are not. The service role key bypasses row level security
entirely, and the pepper is what makes a stolen PIN digest worthless.
Neither is prefixed `NEXT_PUBLIC_`, and that prefix is the only thing
that puts a value in the browser bundle — so the protection here is
simply not to add it.

**Write `PIN_PEPPER` down somewhere safe before you use it.** Changing it
later invalidates every PIN in the system at once, and every person needs
issuing a new one. It is not recoverable from the database: only digests
are stored.

---

## 2. Setting them in Vercel

**Project → Settings → Environment Variables.**

Add each of the four. For each one, tick the environments it applies to:

| | Production | Preview | Development |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ● | ● | ● |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ● | ● | ● |
| `SUPABASE_SERVICE_ROLE_KEY` | ● | ● | ● |
| `PIN_PEPPER` | ● | ● | ● |

**A word about Preview.** Vercel builds a preview deployment for every
branch, and by default it will point at whatever you configure here. If
you give Preview the production values then every preview URL is a live
window onto real customer data, protected by nothing but an unguessable
address.

Two honest options:

- **Give Preview a separate Supabase project.** Run the same installer
  against it, seed the demonstration data, and point Preview at that.
  This is the right answer if anybody other than you will open a preview
  link.
- **Do not deploy previews at all.** Settings → Git → disable preview
  deployments. Simpler, and fine if you only ever ship from `main`.

What you should not do is leave Preview pointing at production and rely
on nobody finding the URL.

---

## 3. Deploy

Push to your default branch, or **Deployments → Redeploy**.

The build must finish with no warnings suppressed. If it fails on a
missing environment variable, that is the check working: the application
refuses to build a bundle it cannot configure.

---

## 4. Confirm no secret reached the browser

This is worth doing once, by hand, rather than trusting that the naming
convention held. From the project root, with your real `.env.local`:

```bash
npm run build

grep -rl "$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2-)" .next/static | wc -l
grep -rl "$(grep '^PIN_PEPPER=' .env.local | cut -d= -f2-)" .next/static | wc -l
```

Both must print `0`. If either prints anything else, stop and find out
why before deploying.

---

## 5. Check the deployment

- **Open the site.** You should see the PIN screen.

  A *setup* page instead means the environment variables did not reach
  the build — they were added after the last deploy, or scoped to the
  wrong environment. Redeploy after fixing.

- **Sign in.** Then open the administrator's dashboard and read the panel
  that reports the database schema. If it names outstanding upgrade
  scripts, the database is behind the application and some features are
  quietly absent. Run them.

- **Install it on a phone.** Open the site on Android or iOS and add it
  to the home screen. It should open without browser chrome and keep
  working with the connection off.

---

## 6. What is already configured for you

You do not need to set any of this up; it is in the repository.

**Service worker and manifest.** `public/sw.js` and the manifest are
served as static files. The middleware deliberately does not match them:
a browser refuses to install a worker that arrives behind a redirect,
which is the kind of failure that looks like "offline just doesn't work".

**Headers.** Set in `next.config.ts`, including the referrer policy and
frame refusal.

**No localhost anywhere.** Every URL comes from the environment.

**No development bypass.** There is no build flag, header or query
parameter that skips authentication. The demonstration PINs are seeded
data, not code — removing the demonstration organization removes them.

---

## 7. After go-live

- **Remove the demonstration data**: `npm run production:clean`, then
  `npm run production:verify`. See `docs/DEMO_TO_PRODUCTION.md`.
- **Every administrator changes their PIN** from the one they were
  issued.
- **Rotate the service role key** if it has ever been pasted anywhere it
  should not have been: Supabase → Settings → API → Reset, then update
  Vercel and redeploy. Rotating it is cheap; the alternative is not.

---

## If something is wrong

| Symptom | Almost always |
|---|---|
| Setup page instead of the PIN screen | Variables missing, or scoped to the wrong environment. Redeploy after fixing. |
| A whole feature is absent rather than broken | An upgrade script has not been run. The administrator's dashboard names which. |
| Sign-in refuses a PIN that is definitely right | `PIN_PEPPER` differs from the one the PIN was set under. |
| Offline does not work on a phone | The service worker did not install. Check it is served from the site root and not redirected. |
| A preview URL shows real data | Preview is pointing at the production database. See §2. |
