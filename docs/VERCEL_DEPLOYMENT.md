# Vercel deployment

Getting GAB Premium Ent online. Do the Supabase side first —
`docs/SUPABASE_SETUP.md` — because you need its keys here.

---

## 1. Push to GitHub

```bash
git status                 # check nothing unexpected is staged
git push origin main
```

`.env.local` is in `.gitignore` and must never be committed. If you ever
suspect it was, rotate the service role key and the PIN pepper
immediately — a leaked service role key gives read and write access to
every organization in the database.

---

## 2. Import the project

1. Vercel dashboard → **Add New** → **Project**.
2. Import the GitHub repository.
3. Framework preset: **Next.js** (detected automatically).
4. Build command, output directory and install command: leave the
   defaults. The project builds with `next build` and needs nothing
   special.
5. Do **not** deploy yet — set the environment variables first, or the
   first build will fail on missing configuration.

---

## 3. Environment variables

**Settings → Environment Variables.** Add all four, to **Production**,
**Preview** and **Development**.

| Name | Value | Exposed to the browser |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → Project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → `anon` key | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role` key | **No** |
| `PIN_PEPPER` | `openssl rand -hex 32`, generated once | **No** |

Two things worth being careful about:

- **Anything prefixed `NEXT_PUBLIC_` is compiled into the JavaScript the
  browser downloads.** That is correct for the first two and would be a
  serious mistake for the other two. The application refuses to start if
  `PIN_PEPPER` is given a `NEXT_PUBLIC_` prefix.
- **`PIN_PEPPER` must match the value the PINs were created under.**
  Changing it invalidates every PIN in the database at once. If you
  seeded a demo locally and then deploy with a different pepper, none of
  the demo PINs will work.

---

## 4. Deploy

**Deploy**. The first build takes a couple of minutes.

A successful build ends with a route table listing about thirty routes,
all marked `ƒ (Dynamic)` apart from `/_not-found` and `/offline`. Every
page resolves the signed-in user per request, so dynamic is correct here.

---

## 5. Point Supabase at the domain

Back in Supabase → **Authentication → URL Configuration**, set **Site
URL** to the production domain Vercel gave you
(`https://your-project.vercel.app`, or your own domain once attached).

---

## 6. Verify the deployment

Work through these against the live URL. They take about five minutes and
catch the things that only break in production.

**Build and configuration**

- [ ] The deployment is green and the route table looks complete.
- [ ] Opening the site redirects to `/sign-in`.

**Authentication**

- [ ] A correct PIN signs in and lands on the right dashboard for that role.
- [ ] A wrong PIN is refused, and repeated wrong PINs trip the cooldown.
- [ ] Signing out returns to the PIN screen.
- [ ] Visiting `/users` while signed out redirects to sign-in rather than rendering.

**Authorization**

- [ ] Signed in as a driver, typing `/users` directly shows "Not available
      to you" — not the staff list.
- [ ] Signed in as a manager, `/settings` is refused.

**The database**

- [ ] Products, inventory and customers show real rows.
- [ ] Adjusting stock writes a movement and an audit entry.

**The PWA** — this is the part that only works in production

- [ ] Open the site on a phone. The browser offers **Install** or **Add to
      Home Screen**.
- [ ] The installed app opens without browser chrome and shows the green
      "G" icon.
- [ ] Sign in as a driver, open **My round**, then turn on flight mode.
- [ ] The app still opens and shows "Working offline".
- [ ] Record a sale. It says it will send when there is a signal.
- [ ] Turn flight mode off. The sync bar clears and the sale appears in
      **Sales** in the office view.

> The service worker requires HTTPS. Vercel gives you that automatically.
> It will not register over plain `http` on a custom domain without a
> certificate, and the offline app silently will not work — if
> installation is not offered, check the certificate first.

---

## Things that are already handled

You do not need to configure any of these; they are worth knowing about
if something looks odd.

- **No hardcoded URLs.** Everything reads from
  `NEXT_PUBLIC_SUPABASE_URL`. There is no `localhost` anywhere in the
  application code.
- **The service worker is excluded from the auth middleware.** A browser
  refuses to register a worker whose script arrived via a redirect, so
  `/sw.js`, `/manifest.webmanifest` and `/icons/*` bypass it.
- **The worker never caches Supabase responses or the sign-in page.** One
  person's data cannot be served to the next, and the shell cache is
  cleared whenever the sign-in screen is reached.
- **Deploys invalidate the worker's caches.** The cache name carries a
  version; bumping it in `public/sw.js` retires every older cache. If you
  change what the worker caches, bump `VERSION`.

---

## Redeploying

Pushing to `main` deploys automatically. Database changes are separate and
manual by design: a migration is never applied by a deploy. When a release
includes a new migration, run its `database/UPGRADE_*.sql` in the Supabase
SQL editor **before** the deploy that needs it.

---

## Related

- `docs/SUPABASE_SETUP.md` — the database
- `docs/DEMO_TO_PRODUCTION.md` — from demonstration to a real client
- `docs/PWA.md` — how the offline app is put together
