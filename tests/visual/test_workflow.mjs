/**
 * End-to-end against the hosted project, driven through the browser.
 *
 * Covers the two things that could not be exercised before: signing in
 * with a PIN through the real screen, and an administrative action
 * reaching both the stock ledger and the audit trail.
 *
 *   npm start   (in another shell)
 *   node tests/visual/test_workflow.mjs
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

const stamp = Date.now().toString(36);
let userId = null;
let PIN = null;

// A PIN nobody else holds.
for (let i = 0; i < 40 && !PIN; i++) {
  const candidate = String(1000 + Math.floor(Math.random() * 8999));
  const { data } = await admin.from("profiles").select("id").eq("pin_hash", digest(candidate)).maybeSingle();
  if (!data) PIN = candidate;
}
if (!PIN) { console.error("could not find a free PIN"); process.exit(1); }

const browser = await chromium.launch();
try {
  const { data: org } = await admin.from("organizations")
    .select("id").eq("slug", "gab-premium-ent-demo").single();

  const { data: created, error } = await admin.auth.admin.createUser({
    email: `htest-flow-${stamp}@example.com`, email_confirm: true,
    user_metadata: { full_name: "Flow Tester", role: "admin", org_id: org.id },
  });
  if (error) throw new Error(error.message);
  userId = created.user.id;
  await admin.from("profiles").update({ pin_hash: digest(PIN) }).eq("id", userId);

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(60_000);

  // The visual audit deliberately submits a wrong PIN at every viewport,
  // which trips the brute-force cooldown for this address. That is the
  // control working; clear the test-generated attempts so this run is
  // not blocked by noise the harness made.
  const { count: cleared } = await admin
    .from("auth_pin_attempts")
    .delete({ count: "exact" })
    .in("request_ip", ["::1", "127.0.0.1"])
    .gte("attempted_at", new Date(Date.now() - 60 * 60_000).toISOString());
  if (cleared) console.log(`cleared ${cleared} local sign-in attempt(s) left by the visual audit\n`);

  console.log("=== signing in with a PIN, through the real screen ===");
  await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
  const boxes = page.locator('input[aria-label^="Digit"]');
  ok("the PIN screen is shown", (await boxes.count()) === 4);

  // Focus the first box and type: the component advances focus itself,
  // so pressing each key against the first box would just overwrite it.
  await boxes.first().click();
  await page.keyboard.type(PIN, { delay: 60 });
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 30_000 }).catch(() => {});
  ok("a correct PIN signs in", !page.url().includes("/sign-in"), `(now at ${new URL(page.url()).pathname})`);
  ok("the dashboard greets the signed-in person",
     (await page.content()).includes("Flow Tester") || /Good day/.test(await page.content()));

  console.log("\n=== the catalogue shows real data ===");
  await page.goto(`${BASE}/products`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load");
  const body = await page.content();
  ok("demo products are listed", body.includes("Demo Sparkling Water"), "");
  ok("stock state is shown", /In stock|Low stock|Out of stock/.test(body));

  console.log("\n=== adjusting stock writes to the ledger and the audit trail ===");
  const { data: product } = await admin.from("products")
    .select("id, sku, name").eq("org_id", org.id).like("sku", "%SKU-101").maybeSingle();
  ok("found a product to adjust", Boolean(product), product ? product.sku : "");

  const before = (await admin.from("inventory").select("qty_on_hand")
    .eq("product_id", product.id)).data ?? [];
  const beforeQty = before.reduce((s, r) => s + Number(r.qty_on_hand ?? 0), 0);

  await page.goto(`${BASE}/products/${product.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load");
  await page.getByRole("button", { name: "Adjust stock" }).click();
  await page.waitForTimeout(400);

  const reason = `Verification run ${stamp}`;
  await page.locator("#quantity").fill("7");
  await page.locator("#reason").fill(reason);

  // A warehouse must be on offer, or the form cannot be completed at all
  // and every assertion below would fail for the wrong reason.
  const warehouseOptions = await page.locator("#warehouseId option").allTextContents();
  ok("the form offers a warehouse to adjust", warehouseOptions.length > 0,
     warehouseOptions.join(", ") || "(none)");

  await page.getByRole("button", { name: "Save adjustment" }).click();

  // Waited for by its text, not by a fixed sleep: the round trip writes
  // a movement, revalidates the page and re-renders, and how long that
  // takes is not something this test should be guessing at.
  const confirmed = await page.getByText("recorded in the stock ledger")
    .waitFor({ timeout: 20_000 }).then(() => true).catch(() => false);
  const confirmation = String(await page.locator('[role="dialog"]').textContent().catch(() => "")).replace(/\s+/g, " ");
  ok("the screen confirms the adjustment", confirmed, confirmation.slice(0, 80));

  const after = (await admin.from("inventory").select("qty_on_hand")
    .eq("product_id", product.id)).data ?? [];
  const afterQty = after.reduce((s, r) => s + Number(r.qty_on_hand ?? 0), 0);
  ok("stock increased by exactly the amount entered", afterQty === beforeQty + 7,
     `(${beforeQty} -> ${afterQty})`);

  const { data: movement } = await admin.from("stock_movements")
    .select("type, quantity, reason").eq("reason", reason).maybeSingle();
  ok("a movement was written to the ledger", Boolean(movement),
     movement ? `${movement.type} x${movement.quantity}` : "none found");
  ok("the reason was recorded", movement?.reason === reason);

  const { data: entry } = await admin.from("audit_log")
    .select("action, actor_name, target_label, after")
    .eq("action", "stock.adjusted").order("occurred_at", { ascending: false }).limit(1).maybeSingle();
  ok("the audit trail recorded the adjustment", Boolean(entry),
     entry ? `${entry.action} by ${entry.actor_name}` : "none found");
  ok("the audit entry names the product", String(entry?.target_label ?? "").includes(product.sku));
  ok("the audit entry holds no secret",
     !JSON.stringify(entry?.after ?? {}).match(/pin|hash|secret/i),
     JSON.stringify(entry?.after ?? {}));

  console.log("\n=== signing out ===");
  await page.goto(`${BASE}/products`, { waitUntil: "domcontentloaded" });
  await page.locator('form[action="/auth/sign-out"] button').click();
  await page.waitForTimeout(1500);
  ok("sign out returns to the PIN screen", page.url().includes("/sign-in"),
     new URL(page.url()).pathname);

  await context.close();
} catch (error) {
  console.error(`\nAborted: ${error.message}`);
  fail++;
} finally {
  await browser.close();
  if (userId) await admin.auth.admin.deleteUser(userId);
  console.log("\n  test account removed");
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
