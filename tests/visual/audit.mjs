/**
 * Full visual audit: every reachable state at six viewports.
 *
 * Signs in against the hosted project and injects the session cookie the
 * way @supabase/ssr encodes it, so authenticated pages render exactly as
 * a user sees them. Test users are removed afterwards.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { createChunks } from "@supabase/ssr/dist/main/utils/chunker.js";
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "shots"); fs.mkdirSync(OUT, { recursive: true });
const env = {};
for (const l of fs.readFileSync(path.join(here, "..", "..", ".env.local"), "utf8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
const BASE = process.env.BASE || "http://localhost:3000";
const TAG = process.env.TAG || "";
const url = env.NEXT_PUBLIC_SUPABASE_URL, ref = new URL(url).hostname.split(".")[0];
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900, touch: false },
  { name: "1280x800", width: 1280, height: 800, touch: false },
  { name: "1024x768", width: 1024, height: 768, touch: true },
  { name: "768x1024", width: 768, height: 1024, touch: true },
  { name: "390x844", width: 390, height: 844, touch: true },
  { name: "375x812", width: 375, height: 812, touch: true },
];

const stamp = Date.now().toString(36), password = `Aud-${stamp}-Aa1!`;
const created = [];
// The demo organization, not simply the first row: the demo one is the
// one carrying products, sales, loads and collections, and a screenshot
// of an empty screen proves nothing about the screen.
const { data: org } = await admin.from("organizations")
  .select("id").eq("slug", "gab-premium-ent-demo").single();
if (!org) {
  console.error("The demo organization is missing. Run: npm run demo:seed");
  process.exit(1);
}

async function makeUser(role, name, active = true) {
  const email = `htest-aud-${role}-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: name, role, org_id: org.id },
  });
  if (error) throw new Error(`${role}: ${error.message}`);
  created.push(data.user.id);
  if (!active) await admin.from("profiles").update({ is_active: false }).eq("id", data.user.id);
  return email;
}
async function cookiesFor(email) {
  const c = createClient(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  const enc = "base64-" + Buffer.from(JSON.stringify(data.session), "utf8").toString("base64url");
  return createChunks(`sb-${ref}-auth-token`, enc)
    .map((x) => ({ name: x.name, value: x.value, domain: "localhost", path: "/" }));
}

/** Everything the eye would have to hunt for, measured instead. */
async function diagnose(page, label, vp) {
  const problems = await page.evaluate((vp) => {
    const out = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) {
      const bad = [...document.querySelectorAll("*")]
        .filter((el) => { const r = el.getBoundingClientRect(); return r.right > doc.clientWidth + 1 && r.width > 0; })
        .slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`);
      out.push(`horizontal overflow ${doc.scrollWidth}/${doc.clientWidth} [${bad.join(", ")}]`);
    }
    if (vp.touch) {
      // What a finger has to hit is the whole control, not the glyph in
      // the middle of it. A checkbox is 16px by design; when it sits in
      // a 44px label, clicking anywhere in that label toggles it, so
      // the label is the target and the control is not undersized.
      const effective = (el) => {
        const wrapper = el.closest("label,button,a");
        const box = wrapper && wrapper !== el ? wrapper : el;
        return box.getBoundingClientRect();
      };
      const small = [...document.querySelectorAll("a,button,input,select,[role=tab]")]
        .map((el) => ({ el, r: el.getBoundingClientRect(), e: effective(el) }))
        .filter(({ r, e }) => r.width > 0 && r.height > 0 && e.height < 44)
        .slice(0, 5)
        .map(({ el, e }) => `${el.tagName.toLowerCase()}"${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 14)}" ${Math.round(e.height)}px`);
      if (small.length) out.push(`touch<44px: ${small.join("; ")}`);
    }
    const clipped = [...document.querySelectorAll("h1,h2,h3,p,span,a,button,td,th,li")]
      // Screen-reader-only text is clipped on purpose: that is how it is
      // hidden from sight while staying available to assistive tech.
      .filter((el) => !el.closest(".sr-only") && !el.classList.contains("sr-only"))
      .filter((el) => el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0)
      .slice(0, 4).map((el) => `${el.tagName.toLowerCase()}"${(el.textContent || "").trim().slice(0, 18)}"`);
    if (clipped.length) out.push(`clipped: ${clipped.join("; ")}`);
    // Content hidden behind the fixed bottom bar.
    const bar = document.querySelector('nav[aria-label="Primary"]');
    // getBoundingClientRect returns zeros for a display:none element, so
    // check the bar is actually laid out before comparing against it.
    if (bar && bar.getBoundingClientRect().height > 0) {
      const barTop = bar.getBoundingClientRect().top;
      const main = document.querySelector("main");
      if (main && main.scrollHeight - main.clientHeight <= 2) {
        const last = [...main.querySelectorAll("*")].pop();
        if (last) {
          const r = last.getBoundingClientRect();
          if (r.bottom > barTop && r.height > 0) out.push("content sits under the bottom bar with nothing to scroll");
        }
      }
    }
    // Headings should not skip levels.
    const levels = [...document.querySelectorAll("h1,h2,h3,h4")].map((h) => Number(h.tagName[1]));
    for (let i = 1; i < levels.length; i++) if (levels[i] - levels[i - 1] > 1) { out.push(`heading jumps h${levels[i-1]}->h${levels[i]}`); break; }
    return out;
  }, vp);
  return { label: `${label} @ ${vp.name}`, problems };
}

// A run that crashes leaves its users behind, and the next run then
// reports duplicates that are not real. Clear any strays first.
{
  const { data } = await admin.from("profiles").select("id, email");
  const stale = (data ?? []).filter((p) => String(p.email ?? "").startsWith("htest-"));
  for (const person of stale) await admin.auth.admin.deleteUser(person.id);
  if (stale.length) console.log(`cleared ${stale.length} stray test account(s) from a previous run`);
}

const findings = [];
const browser = await chromium.launch();
// Some pages query the hosted project several times; the default 30s can
// be tight when a query is failing and retrying upstream.
const NAV_TIMEOUT = 60_000;

async function shot(page, name, vp) {
  await page.waitForLoadState("load");
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(OUT, `${TAG}${name}-${vp.name}.png`) });
}

try {
  const adminEmail = await makeUser("admin", "Ama Boateng");
  const driverEmail = await makeUser("driver", "Kojo Mensah");
  const pendingEmail = await makeUser("sales_rep", "Yaw Pending", false);
  const ck = { admin: await cookiesFor(adminEmail), driver: await cookiesFor(driverEmail), pending: await cookiesFor(pendingEmail) };

  for (const vp of VIEWPORTS) {
    const opts = { viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: vp.touch, isMobile: vp.touch };

    const anon = await browser.newContext(opts);
    const p = await anon.newPage();
    p.setDefaultNavigationTimeout(NAV_TIMEOUT);
    await p.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
    await shot(p, "signin", vp); findings.push(await diagnose(p, "sign-in", vp));

    // Rejected PIN: type four digits and let the form submit itself.
    const boxes = p.locator('input[aria-label^="Digit"]');
    if (await boxes.count()) {
      await boxes.first().click();
      await p.keyboard.type("9876", { delay: 40 });
      await p.waitForTimeout(1200);
      await shot(p, "signin-rejected", vp);
      findings.push(await diagnose(p, "sign-in rejected", vp));
    }

    await p.goto(`${BASE}/nope`, { waitUntil: "domcontentloaded" });
    await shot(p, "notfound", vp); findings.push(await diagnose(p, "not-found", vp));
    await anon.close();

    for (const [who, label] of [["admin", "dashboard-admin"], ["driver", "dashboard-driver"], ["pending", "pending"]]) {
      const c = await browser.newContext(opts);
      await c.addCookies(ck[who]);
      const pg = await c.newPage();
      pg.setDefaultNavigationTimeout(NAV_TIMEOUT);
      await pg.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await shot(pg, label, vp); findings.push(await diagnose(pg, label, vp));

      if (who === "admin") {
        await pg.goto(`${BASE}/users`, { waitUntil: "domcontentloaded" });
        await shot(pg, "staff", vp); findings.push(await diagnose(pg, "staff", vp));

        const create = pg.locator('button:has-text("Create staff")').first();
        if (await create.count() && await create.isVisible()) {
          await create.click(); await pg.waitForTimeout(350);
          await shot(pg, "staff-create", vp);
          findings.push(await diagnose(pg, "staff create dialog", vp));
          await pg.keyboard.press("Escape"); await pg.waitForTimeout(200);
        }

        const reset = pg.locator('button:has-text("Set PIN"), button:has-text("Reset PIN")').first();
        if (await reset.count() && await reset.isVisible()) {
          await reset.click(); await pg.waitForTimeout(350);
          await shot(pg, "staff-pin-dialog", vp);
          findings.push(await diagnose(pg, "staff pin dialog", vp));
          await pg.keyboard.press("Escape"); await pg.waitForTimeout(200);
        }

        // First staff member's detail page, if there is one.
        const first = pg.locator('a[href^="/users/"]').first();
        if (await first.count()) {
          const href = await first.getAttribute("href");
          if (href && href !== "/users") {
            await pg.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded" });
            await shot(pg, "staff-detail", vp);
            findings.push(await diagnose(pg, "staff detail", vp));
          }
        }

        // Phase 6 screens.
        await pg.goto(`${BASE}/products`, { waitUntil: "domcontentloaded" });
        await shot(pg, "products", vp); findings.push(await diagnose(pg, "products", vp));

        const addProduct = pg.locator('button:has-text("Add product")').first();
        if (await addProduct.count() && await addProduct.isVisible()) {
          await addProduct.click(); await pg.waitForTimeout(400);
          await shot(pg, "product-create", vp);
          findings.push(await diagnose(pg, "product create dialog", vp));
          await pg.keyboard.press("Escape"); await pg.waitForTimeout(200);
        }

        const firstProduct = pg.locator('a[href^="/products/"]').first();
        if (await firstProduct.count()) {
          const href = await firstProduct.getAttribute("href");
          if (href && href !== "/products") {
            await pg.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded" });
            await shot(pg, "product-detail", vp);
            findings.push(await diagnose(pg, "product detail", vp));

            const adjust = pg.locator('button:has-text("Adjust stock")').first();
            if (await adjust.count() && await adjust.isVisible()) {
              await adjust.click(); await pg.waitForTimeout(400);
              await shot(pg, "stock-adjust", vp);
              findings.push(await diagnose(pg, "stock adjust dialog", vp));
              await pg.keyboard.press("Escape"); await pg.waitForTimeout(200);
            }
          }
        }

        // The collection dialog is the one form on these screens, so it
        // gets the same treatment as the product and stock dialogs.
        await pg.goto(`${BASE}/payments`, { waitUntil: "domcontentloaded" });
        const collect = pg.locator('button:has-text("Record collection")').first();
        if (await collect.count() && await collect.isVisible()) {
          await collect.click(); await pg.waitForTimeout(400);
          await shot(pg, "collection-dialog", vp);
          findings.push(await diagnose(pg, "collection dialog", vp));
          await pg.keyboard.press("Escape"); await pg.waitForTimeout(200);
        }

        const firstCustomer = pg.locator('a[href^="/customers/"]').first();
        if (await firstCustomer.count()) {
          const href = await firstCustomer.getAttribute("href");
          if (href && href !== "/customers") {
            await pg.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded" });
            await shot(pg, "customer-detail", vp);
            findings.push(await diagnose(pg, "customer detail", vp));
          }
        }

        for (const [path, name] of [
          ["/categories", "categories"],
          ["/inventory", "inventory"],
          ["/inventory/movements", "movements"],
          ["/products?stock=low_stock", "products-low-stock"],
          ["/warehouses", "warehouses"],
          ["/purchasing", "purchasing"],
          ["/vans", "vans"],
          ["/loads", "loads"],
          ["/returns", "returns"],
          ["/reconciliation", "reconciliation"],
          ["/customers", "customers"],
          ["/sales", "sales"],
          ["/credit", "credit"],
          ["/payments", "collections"],
          ["/reports", "reports"],
          ["/settings", "settings"],
          ["/permissions", "permissions"], ["/audit", "audit"], ["/account", "account"],
        ]) {
          await pg.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
          await shot(pg, name, vp); findings.push(await diagnose(pg, name, vp));
        }
      }
      if (who === "driver") {
        for (const [path, name] of [["/users", "forbidden"], ["/audit", "forbidden-audit"]]) {
          await pg.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
          await shot(pg, name, vp); findings.push(await diagnose(pg, name, vp));
        }
        // The driver's own round, which is the workflow that has to be
        // usable one-handed in a van. Note these render for the
        // throwaway audit driver, who has no round of their own: a
        // driver only ever sees their own sales, loads and returns, so
        // these shots show the empty state, not the populated one. The
        // populated view is what signing in as the demo driver gives.
        for (const [path, name] of [
          ["/driver", "driver-round"], ["/driver/sell", "driver-sell"],
          ["/driver/collect", "driver-collect"], ["/driver/return", "driver-return"],
          ["/driver/reconcile", "driver-reconcile"], ["/driver/queue", "driver-queue"],
          ["/loads", "driver-loads"], ["/sales", "driver-sales"],
          ["/payments", "driver-collections"], ["/returns", "driver-returns"],
          ["/reconciliation", "driver-reconciliation"], ["/vans", "driver-vans"],
        ]) {
          await pg.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
          await shot(pg, name, vp); findings.push(await diagnose(pg, name, vp));
        }
      }
      if (vp.touch && who === "admin") {
        // The bottom bar is hidden from 1024px up, where the sidebar takes
        // over, so the control exists in the DOM but is not shown.
        const more = pg.locator('button[aria-label="More navigation"]');
        if (await more.count() && await more.isVisible()) {
          await more.click(); await pg.waitForTimeout(250);
          await shot(pg, "more-sheet", vp); findings.push(await diagnose(pg, "more-sheet", vp));
        }
      }
      await c.close();
    }
  }
} finally {
  await browser.close();
  for (const id of created) await admin.auth.admin.deleteUser(id);
  console.log(`removed ${created.length} test users\n`);
}

let any = false;
for (const f of findings) if (f.problems.length) { any = true; console.log(`  ${f.label}`); for (const x of f.problems) console.log(`     - ${x}`); }
if (!any) console.log("  no layout problems detected across " + findings.length + " renders");
else console.log(`\n  ${findings.filter(f=>f.problems.length).length} of ${findings.length} renders have findings`);
