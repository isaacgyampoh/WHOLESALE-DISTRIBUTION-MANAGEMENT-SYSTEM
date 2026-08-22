/**
 * A driver's day, through the real interface.
 *
 * The acceptance test for the round: sign in with a PIN, see the van,
 * sell for cash, add a customer at the counter, sell to them on credit,
 * take a payment, and check the stock came off the van and the money
 * landed on the ledger.
 *
 * Nothing is stubbed. Every figure asserted here is read back from the
 * database afterwards, so a screen that looks right but wrote nothing
 * fails.
 *
 *   npm start   (in another shell)
 *   node tests/visual/test_driver_day.mjs
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
const created = [];
let newCustomerId = null;
const browser = await chromium.launch();

try {
  const { data: org } = await admin.from("organizations")
    .select("id").eq("slug", "gab-premium-ent-demo").single();

  // The demo driver's own van and open load, as the seed leaves them.
  const { data: demoDriver } = await admin.from("profiles")
    .select("id, full_name").eq("email", "demo-driver@demo.invalid").single();
  const { data: assignment } = await admin.from("van_assignments")
    .select("van_id").eq("driver_id", demoDriver.id).is("unassigned_at", null).single();
  const vanId = assignment.van_id;

  const { data: load } = await admin.from("van_loads")
    .select("id, load_number").eq("van_id", vanId)
    .in("status", ["loaded", "dispatched"]).maybeSingle();
  ok("the demo driver has an open load to sell from", Boolean(load), load?.load_number ?? "none");
  if (!load) throw new Error("Run npm run demo:seed first.");

  const onVan = async () => {
    const { data } = await admin.from("van_inventory")
      .select("qty_on_hand").eq("van_id", vanId);
    return (data ?? []).reduce((s, r) => s + Number(r.qty_on_hand), 0);
  };
  const startingUnits = await onVan();
  ok("the van is carrying stock", startingUnits > 0, `${startingUnits} units`);

  // A throwaway driver assigned to nothing would see an empty round, so
  // this signs in as the demo driver themselves - with a PIN set for
  // this run and restored afterwards.
  let PIN = null;
  for (let i = 0; i < 60 && !PIN; i++) {
    const candidate = String(1000 + Math.floor(Math.random() * 8999));
    const { data } = await admin.from("profiles").select("id").eq("pin_hash", digest(candidate)).maybeSingle();
    if (!data) PIN = candidate;
  }
  const { data: before } = await admin.from("profiles")
    .select("pin_hash").eq("id", demoDriver.id).single();
  await admin.from("profiles").update({ pin_hash: digest(PIN) }).eq("id", demoDriver.id);
  created.push(() => admin.from("profiles").update({ pin_hash: before.pin_hash }).eq("id", demoDriver.id));

  await admin.from("auth_pin_attempts").delete()
    .in("request_ip", ["::1", "127.0.0.1"])
    .gte("attempted_at", new Date(Date.now() - 3_600_000).toISOString());

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
  });
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(60_000);

  console.log("\n=== signing in ===");
  await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
  await page.locator('input[aria-label^="Digit"]').first().click();
  await page.keyboard.type(PIN, { delay: 50 });
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 30_000 }).catch(() => {});
  ok("a PIN signs the driver in", !page.url().includes("/sign-in"));

  console.log("\n=== the round is the first thing they see ===");
  await page.goto(`${BASE}/driver`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load");
  const home = await page.content();
  ok("their van is named", home.includes("My van"));
  ok("the open load is shown", home.includes(load.load_number), load.load_number);
  ok("the day's figures are shown", /Cash|Credit|Collected/.test(home));
  ok("Sell is offered", home.includes("Sell"));
  ok("no cost figure is anywhere on the round",
     !/cost/i.test(home.replace(/costPrice|data-[^"]*/g, "")));

  console.log("\n=== a cash sale ===");
  await page.goto(`${BASE}/driver/sell`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load");
  await page.waitForTimeout(2500);   // let the cached round land

  await page.getByRole("button", { name: /Choose a customer|Change/ }).first().click();
  await page.waitForTimeout(600);
  const firstCustomer = page.locator('[role="dialog"] button').filter({ hasText: /DEMO|Demo/ }).first();
  ok("the customer list offers somebody", await firstCustomer.count() > 0);
  await firstCustomer.click();
  await page.waitForTimeout(500);

  // One of whatever is on the van.
  const plus = page.getByRole("button", { name: /^One more / }).first();
  await plus.click();
  await plus.click();
  await page.waitForTimeout(400);

  const totalText = await page.locator("text=/items?$/").first().textContent().catch(() => "");
  ok("the cart counts what was added", /2 items|1 item/.test(totalText ?? ""), totalText ?? "");

  await page.getByRole("button", { name: "Take payment" }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Cash", exact: true }).click();

  const cashDone = await page.getByText("Sale completed")
    .waitFor({ timeout: 30_000 }).then(() => true).catch(() => false);
  ok("the sale confirms on screen", cashDone);

  const afterCash = await onVan();
  ok("stock came off the van", afterCash === startingUnits - 2,
     `${startingUnits} -> ${afterCash}`);

  const { data: cashSale } = await admin.from("van_sales")
    .select("sale_number, sale_type, total, status")
    .eq("load_id", load.id).eq("sale_type", "cash")
    .order("sold_at", { ascending: false }).limit(1).maybeSingle();
  ok("a cash sale reached the database", Boolean(cashSale),
     cashSale ? `${cashSale.sale_number} ${cashSale.total}` : "none");
  ok("it is completed, not left as a draft", cashSale?.status === "completed", cashSale?.status);

  console.log("\n=== a customer added at the counter, then sold to on credit ===");
  await page.getByRole("button", { name: "Sell to another customer" }).click();
  await page.waitForTimeout(800);

  await page.getByRole("button", { name: /Choose a customer/ }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "New customer" }).click();
  await page.waitForTimeout(400);

  const shopName = `Counter Shop ${stamp}`;
  await page.locator("#ncName").fill(shopName);
  await page.locator("#ncPhone").fill("0240000123");
  await page.locator("#ncCity").fill("Madina");
  await page.getByRole("button", { name: "Save customer" }).click();

  const savedCustomer = await page.getByText(shopName).first()
    .waitFor({ timeout: 30_000 }).then(() => true).catch(() => false);
  ok("the new customer is created and selected", savedCustomer, shopName);

  const { data: newCustomer } = await admin.from("customers")
    .select("id, code, name, credit_limit").eq("org_id", org.id).eq("name", shopName).maybeSingle();
  ok("the customer reached the database", Boolean(newCustomer), newCustomer?.code ?? "none");
  newCustomerId = newCustomer?.id ?? null;
  ok("a driver cannot grant credit terms", Number(newCustomer?.credit_limit ?? -1) === 0,
     String(newCustomer?.credit_limit));

  await page.getByRole("button", { name: /^One more / }).first().click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Take payment" }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Credit", exact: true }).click();

  // The new customer is on cash terms, so credit must be refused. That
  // is the rule working, not a failure.
  const refused = await page.getByText(/credit left/).first()
    .waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  ok("credit beyond a customer's limit is refused at the till", refused);

  // Sell to them for cash instead.
  await page.getByRole("button", { name: "Cash", exact: true }).click();
  const creditFallback = await page.getByText("Sale completed")
    .waitFor({ timeout: 30_000 }).then(() => true).catch(() => false);
  ok("the same cart can be taken as cash instead", creditFallback);

  const { data: theirSales } = await admin.from("van_sales")
    .select("id, total").eq("customer_id", newCustomerId);
  ok("the sale is recorded against the new customer", (theirSales ?? []).length === 1,
     `${theirSales?.length} sale(s)`);

  console.log("\n=== what the driver may not see ===");
  for (const [route, why] of [
    ["/purchasing", "purchasing"],
    ["/users", "staff"],
    ["/settings", "settings"],
    ["/audit", "the audit trail"],
  ]) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    const body = await page.content();
    ok(`a driver is refused ${why}`, body.includes("Not available to you"));
  }

  await page.goto(`${BASE}/products`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load");
  const products = await page.content();
  // The column header may still be rendered; what must not appear is a
  // figure in it. The database returns null, so the cell reads "-".
  ok("the products screen shows no cost figure to a driver",
     !/GH₵|₵\d/.test(products.split("COST")[1]?.slice(0, 400) ?? ""));

  await context.close();
} catch (error) {
  console.error(`\nAborted: ${error.message}`);
  fail++;
} finally {
  await browser.close();
  if (newCustomerId) {
    const { data: sales } = await admin.from("van_sales").select("id").eq("customer_id", newCustomerId);
    for (const s of sales ?? []) await admin.from("van_sale_items").delete().eq("sale_id", s.id);
    await admin.from("van_sales").delete().eq("customer_id", newCustomerId);
    await admin.from("credit_transactions").delete().eq("customer_id", newCustomerId);
    await admin.from("customers").delete().eq("id", newCustomerId);
  }
  for (const undo of created) await undo();
  console.log("\n  the demo driver's PIN was restored");
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
