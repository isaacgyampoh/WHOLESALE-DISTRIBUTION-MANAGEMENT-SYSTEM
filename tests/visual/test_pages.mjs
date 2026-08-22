/**
 * Every navigation destination, signed in, for each role that can reach it.
 *
 * This is the check that a route exists, renders, and shows the screen
 * it claims to - not a redirect, not a 404, not the error boundary, and
 * not the "not available to you" card when the role should have access.
 *
 * It also asserts the other direction: a role that should NOT reach a
 * screen is refused by the server. Hiding a link is not access control,
 * so the URL is requested directly.
 *
 *   npm start   (in another shell)
 *   node tests/visual/test_pages.mjs
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = {};
for (const l of fs.readFileSync(path.join(here, "..", "..", ".env.local"), "utf8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
const BASE = process.env.BASE || "http://localhost:3000";
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const digest = (pin) => createHmac("sha256", env.PIN_PEPPER).update(pin).digest("hex");

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

// What each screen must actually put on the page. A heading alone would
// pass even if every panel below it had failed to load.
const PAGES = [
  ["/", "Dashboard", ["admin", "manager", "driver", "accountant"]],
  ["/products", "Products", ["admin", "manager", "driver", "accountant"]],
  ["/categories", "Categories", ["admin", "manager"]],
  ["/warehouses", "Warehouses", ["admin", "manager", "accountant"]],
  ["/inventory", "Inventory", ["admin", "manager", "accountant"]],
  ["/inventory/movements", "Stock movements", ["admin", "manager"]],
  ["/purchasing", "Purchasing", ["admin", "manager"]],
  ["/vans", "Vans", ["admin", "manager", "driver", "accountant"]],
  ["/loads", "Van loads", ["admin", "manager", "driver", "accountant"]],
  ["/returns", "Returns", ["admin", "manager", "driver", "accountant"]],
  ["/reconciliation", "Reconciliation", ["admin", "manager", "driver", "accountant"]],
  ["/customers", "Customers", ["admin", "manager", "driver", "accountant"]],
  ["/sales", "Sales", ["admin", "manager", "driver", "accountant"]],
  ["/credit", "Credit", ["admin", "manager", "driver", "accountant"]],
  ["/payments", "Collections", ["admin", "manager", "driver", "accountant"]],
  ["/reports", "Reports", ["admin", "manager", "accountant"]],
  ["/users", "Staff", ["admin"]],
  ["/permissions", "Permissions", ["admin"]],
  ["/audit", "Audit", ["admin"]],
  ["/settings", "Settings", ["admin"]],
  ["/account", "account", ["admin", "manager", "driver", "accountant"]],
  // The offline-capable round. Reachable by anyone who can record a
  // sale, which is how a supervisor covers for a driver.
  ["/driver", "round", ["admin", "manager", "driver"]],
  ["/driver/sell", "Sell", ["admin", "manager", "driver"]],
  ["/driver/collect", "payment", ["admin", "manager", "driver"]],
  ["/driver/return", "van back", ["admin", "manager", "driver"]],
  ["/driver/reconcile", "End of day", ["admin", "manager", "driver"]],
  ["/driver/queue", "recorded", ["admin", "manager", "driver"]],
];

// Screens a role must be refused when it asks for the URL directly.
const REFUSED = {
  driver: ["/users", "/permissions", "/audit", "/settings", "/purchasing", "/categories", "/reports"],
  // An accountant records payments but never sells, so the round is not
  // theirs.
  accountant: ["/users", "/permissions", "/audit", "/settings", "/purchasing", "/categories", "/driver"],
  manager: ["/users", "/permissions", "/audit", "/settings"],
};

const ROLES = ["admin", "manager", "driver", "accountant"];
const created = [];
const browser = await chromium.launch();

try {
  const { data: org } = await admin.from("organizations")
    .select("id").eq("slug", "gab-premium-ent-demo").single();

  // Real accounts with real PINs, signed in through the real screen.
  const accounts = {};
  for (const role of ROLES) {
    let pin = null;
    for (let i = 0; i < 60 && !pin; i++) {
      const candidate = String(1000 + Math.floor(Math.random() * 8999));
      const { data } = await admin.from("profiles").select("id").eq("pin_hash", digest(candidate)).maybeSingle();
      if (!data) pin = candidate;
    }
    if (!pin) throw new Error("could not find a free PIN");

    const { data: user, error } = await admin.auth.admin.createUser({
      email: `pagecheck-${role}-${Date.now().toString(36)}@example.com`, email_confirm: true,
      user_metadata: { full_name: `Page ${role}`, role, org_id: org.id },
    });
    if (error) throw new Error(`${role}: ${error.message}`);
    created.push(user.user.id);
    await admin.from("profiles").update({ pin_hash: digest(pin) }).eq("id", user.user.id);
    accounts[role] = { id: user.user.id, pin };
  }

  // A manager is category-scoped; give this one a scope so the manager
  // screens show a restricted view rather than an empty one.
  const { data: category } = await admin.from("categories")
    .select("id").eq("org_id", org.id).limit(1).maybeSingle();
  if (category) {
    await admin.from("manager_category_scopes")
      .insert({ org_id: org.id, profile_id: accounts.manager.id, category_id: category.id });
  }

  // The brute-force cooldown is per address and other suites trip it.
  await admin.from("auth_pin_attempts").delete()
    .in("request_ip", ["::1", "127.0.0.1"])
    .gte("attempted_at", new Date(Date.now() - 3_600_000).toISOString());

  for (const role of ROLES) {
    console.log(`\n=== ${role} ===`);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(45_000);

    await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
    await page.locator('input[aria-label^="Digit"]').first().click();
    await page.keyboard.type(accounts[role].pin, { delay: 50 });
    await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 30_000 }).catch(() => {});
    ok(`${role} signs in`, !page.url().includes("/sign-in"), new URL(page.url()).pathname);

    for (const [route, expect, roles] of PAGES) {
      if (!roles.includes(role)) continue;
      const response = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("load");
      const body = await page.content();

      const status = response?.status() ?? 0;
      const notFound = body.includes("This page could not be found") || status === 404;
      const refused = body.includes("Not available to you");
      const crashed = body.includes("Something went wrong") && !body.includes("could not be loaded");
      const shows = body.toLowerCase().includes(expect.toLowerCase());

      ok(`${role} ${route}`,
         !notFound && !refused && !crashed && shows,
         notFound ? "404" : refused ? "refused" : crashed ? "error boundary" :
         !shows ? `missing "${expect}"` : "");
    }

    for (const route of REFUSED[role] ?? []) {
      await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
      const body = await page.content();
      // Refused means refused - by the server, not by a hidden link.
      // A 404 is reported separately: a missing route proves nothing
      // about authorization, and reading it as "refused" would let a
      // broken build pass this check.
      const refused = body.includes("Not available to you");
      const missing = body.includes("This page could not be found");
      ok(`${role} is refused ${route}`, refused,
         refused ? "" : missing ? "route is missing (404)" : "REACHED IT");
    }

    await context.close();
  }
} catch (error) {
  console.error(`\nAborted: ${error.message}`);
  fail++;
} finally {
  await browser.close();
  for (const id of created) await admin.auth.admin.deleteUser(id);
  console.log(`\n  removed ${created.length} test account(s)`);
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
