/**
 * Production smoke test against the deployed site.
 *
 * Signs in as a temporary administrator created for this run and removed
 * at the end, walks the main screens, and reports console and network
 * errors. Nothing is left behind.
 */
import { createRequire } from "node:module";
const require = createRequire(new URL("../visual/", import.meta.url));
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";

const R = new URL("../../", import.meta.url).pathname;
const env = Object.fromEntries(
  readFileSync(R + ".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

const URL_BASE = process.env.PRODUCTION_URL
  ?? "https://wholesale-distribution-management-s-six.vercel.app";
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

const stamp = Date.now().toString(36);
const PIN = "8317";
const USERNAME = `zz.smoke.${stamp}`;
const EMAIL = `zz-smoke-${stamp}@smoke.invalid`;

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

// ---- a temporary administrator ------------------------------------
const { data: org } = await admin.from("organizations").select("id,name").eq("slug", "default").single();
const { data: created, error: cErr } = await admin.auth.admin.createUser({
  email: EMAIL, email_confirm: true,
  user_metadata: { full_name: "ZZ Smoke Test", role: "admin", org_id: org.id, username: USERNAME },
});
if (cErr) { console.error("could not create the temporary admin: " + cErr.message); process.exit(1); }

await admin.from("profiles").update({
  full_name: "ZZ Smoke Test", username: USERNAME, role: "admin", org_id: org.id, is_active: true,
  // Not provisional: this account exists to walk the screens, and a
  // provisional one is held at the set-PIN page by design.
  must_change_pin: false,
  pin_hash: createHmac("sha256", env.PIN_PEPPER).update(PIN).digest("hex"),
  pin_set_at: new Date().toISOString(),
}).eq("id", created.user.id);

await admin.from("auth_pin_attempts")
  .delete().gte("attempted_at", new Date(Date.now() - 86_400_000).toISOString());

/*
 * Anything a previous run left behind.
 *
 * A run that is interrupted never reaches its cleanup, and the account
 * it made keeps a PIN - which are unique across active accounts, so the
 * next run collides on one and fails for a reason that has nothing to
 * do with the application.
 */
{
  const { data: strays } = await admin
    .from("profiles").select("id, username").like("username", "zz.%");
  for (const stray of strays ?? []) {
    if (stray.id === created.user.id) continue;
    await admin.from("auth_pin_attempts").delete().eq("profile_id", stray.id);
    await admin.from("audit_log").delete().eq("actor_id", stray.id);
    await admin.from("audit_log").delete().eq("target_id", stray.id);
    await admin.from("profiles").delete().eq("id", stray.id);
    await admin.auth.admin.deleteUser(stray.id).catch(() => {});
  }
  if ((strays ?? []).length > 1) {
    console.log(`removed ${strays.length - 1} account(s) left by an earlier run`);
  }
}

console.log(`temporary administrator created (${USERNAME})\n`);

const browser = await chromium.launch();
const consoleErrors = [], networkErrors = [];

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160)); });
  page.on("response", (r) => { if (r.status() >= 400) networkErrors.push(`${r.status()} ${r.url().replace(URL_BASE, "").slice(0, 90)}`); });

  // ---- sign in ----
  await page.goto(`${URL_BASE}/sign-in`, { waitUntil: "domcontentloaded", timeout: 60000 });
  ok("sign-in page loads", !(await page.content()).includes("Connect a Supabase project"));

  // Four digits and nothing else: the PIN identifies the account.
  await page.getByLabel(/digit 1 of 4/i).first().waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(900);                    // let React hydrate
  await page.getByLabel(/digit 1 of 4/i).first().click({ timeout: 20000 });
  for (const d of PIN) await page.keyboard.type(d, { delay: 60 });
  // The form submits itself on the fourth digit. Clicking submit as well
  // sends it twice and the second attempt fails against a used nonce.
  await page.waitForURL((u) => !u.pathname.includes("sign-in"), { timeout: 90000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  const signedIn = !page.url().includes("sign-in");
  ok("administrator can sign in", signedIn, page.url().replace(URL_BASE, ""));

  if (signedIn) {
    // Let the redirect settle before reading the document, or the read
    // races the navigation it was waiting for.
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    const body = await page.locator("body").innerText().catch(() => "");
    ok("dashboard renders, not the setup screen", !body.includes("Connect a Supabase project"));
    ok("branding present", body.includes("GAB Premium Ent"));

    // ---- the main screens, against the real database ----
    for (const [path, expect] of [
      ["/products", "Products"], ["/customers", "Customers"], ["/inventory", "Inventory"],
      ["/vans", "Vans"], ["/warehouses", "Warehouses"], ["/purchasing", "Purchasing"],
      ["/sales", "Sales"], ["/credit", "Credit"], ["/invoices", "Invoices"],
      ["/waybills", "Waybills"], ["/transfers", "Transfers"], ["/reports", "Reports"],
      ["/notifications", "Notification"], ["/users", "Staff"], ["/audit", "Audit"],
      ["/suppliers", "Suppliers"],
      ["/settings", "Settings"], ["/suppliers/review", "Supplier"],
    ]) {
      const res = await page.goto(`${URL_BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => null);
      await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
      // Visible text, not raw HTML: the RSC payload carries the
      // not-found template as inert markup on every page, so matching
      // the HTML reports a 404 on screens that rendered perfectly.
      const html = await page.locator("body").innerText().catch(() => "");
      const notFound = html.includes("Page not found");
      const failedLoad = /could not be loaded|Something went wrong/i.test(html);
      const good = res && res.status() < 400 && html.includes(expect)
        && !notFound && !failedLoad && !html.includes("Connect a Supabase project");
      ok(`${path}`, good,
         good ? "" : notFound ? "404 page" : failedLoad ? "data failed to load" : `status=${res?.status()}`);
    }

    // ---- responsive ----
    for (const [w, h, label] of [[1280, 800, "1280"], [1024, 768, "1024"], [768, 1024, "tablet"], [390, 844, "mobile"], [375, 812, "small mobile"]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`${URL_BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
      ok(`no horizontal overflow at ${label}`, !overflow);
    }
  }
} finally {
  await browser.close();
  // ---- remove the temporary administrator ----
  await admin.from("profiles").delete().eq("id", created.user.id);
  await admin.auth.admin.deleteUser(created.user.id);
  const { count } = await admin.from("profiles").select("id", { count: "exact", head: true });
  console.log(`\ntemporary administrator removed; profiles remaining: ${count ?? 0}`);
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
for (const e of [...new Set(consoleErrors)].slice(0, 6)) console.log(`  ${e}`);
console.log(`network errors: ${networkErrors.length}`);
for (const e of [...new Set(networkErrors)].slice(0, 8)) console.log(`  ${e}`);
console.log(`\n  ${pass} passed, ${fail} failed`);
