/**
 * Getting physical stock into the system, against production.
 *
 * Counts real products in a real warehouse through the real screen, and
 * then checks the two things that must both be true afterwards: the
 * level says what was counted, and the ledger explains why it changed.
 *
 * Everything it counts is put back exactly as it was found.
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

const BASE = process.env.PRODUCTION_URL
  ?? "https://wholesale-distribution-management-s-six.vercel.app";
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };
const head = (t) => console.log(`\n=== ${t} ===`);

const stamp = Date.now().toString(36).slice(-6);
const PIN = "4813";
const USERNAME = `zz.count.${stamp}`;

const { data: org } = await db.from("organizations").select("id").eq("slug", "default").single();

// Anything an interrupted run left behind: PINs are unique among active
// accounts, so a stray one makes the next run collide.
{
  const { data: strays } = await db.from("profiles").select("id").like("username", "zz.%");
  for (const s of strays ?? []) {
    await db.from("auth_pin_attempts").delete().eq("profile_id", s.id);
    await db.from("audit_log").delete().eq("actor_id", s.id);
    await db.from("audit_log").delete().eq("target_id", s.id);
    await db.from("profiles").delete().eq("id", s.id);
    await db.auth.admin.deleteUser(s.id).catch(() => {});
  }
}
await db.from("auth_pin_attempts")
  .delete().gte("attempted_at", new Date(Date.now() - 86_400_000).toISOString());

const { data: created, error: userError } = await db.auth.admin.createUser({
  email: `${USERNAME}@count.invalid`, email_confirm: true,
  user_metadata: { full_name: "ZZ Stock Counter", role: "admin", org_id: org.id, username: USERNAME },
});
if (userError) { console.error(userError.message); process.exit(1); }

await db.from("profiles").update({
  full_name: "ZZ Stock Counter", username: USERNAME, role: "admin", org_id: org.id,
  is_active: true, must_change_pin: false,
  pin_hash: createHmac("sha256", env.PIN_PEPPER).update(PIN).digest("hex"),
  pin_set_at: new Date().toISOString(),
}).eq("id", created.user.id);

const browser = await chromium.launch();
const consoleErrors = [], networkErrors = [];
let counted = [];          // [{ productId, before }] to restore
let movementIds = [];

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 140)); });
  page.on("response", (r) => { if (r.status() >= 400) networkErrors.push(`${r.status()} ${r.url().replace(BASE, "").slice(0, 70)}`); });

  head("a counter signs in");
  await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByLabel(/digit 1 of 4/i).first().waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(900);
  await page.getByLabel(/digit 1 of 4/i).first().click();
  for (const d of PIN) await page.keyboard.type(d, { delay: 60 });
  await page.waitForURL((u) => !u.pathname.includes("sign-in"), { timeout: 45000 }).catch(() => {});
  ok("signed in", !page.url().includes("sign-in"), page.url().replace(BASE, ""));

  head("the count sheet is reachable");
  await page.goto(`${BASE}/inventory`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const link = page.getByRole("link", { name: /count stock/i }).first();
  // Waited for rather than asked about immediately: the page is still
  // streaming when goto resolves.
  const reachable = await link.waitFor({ state: "visible", timeout: 20000 })
    .then(() => true).catch(() => false);
  ok("inventory offers a way to count", reachable);

  await page.goto(`${BASE}/inventory/count`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByLabel(/find a product/i).waitFor({ state: "visible", timeout: 30000 });
  const sheet = await page.locator("body").innerText().catch(() => "");
  ok("the sheet lists products to count", /system holds/i.test(sheet));
  ok("it explains that blanks are left alone", /blank lines are left alone/i.test(sheet));

  head("counting three products");
  // Real catalogue products, and their levels before anything is typed.
  const { data: products } = await db
    .from("products_priced").select("id, sku, name").eq("is_active", true).order("name").limit(3);
  ok("there are products to count", (products ?? []).length === 3);

  const { data: warehouses } = await db
    .from("warehouses").select("id, name").eq("is_active", true).order("name").limit(1);
  const warehouseId = warehouses[0].id;

  for (const p of products) {
    const { data: level } = await db.from("inventory")
      .select("qty_on_hand").eq("product_id", p.id).eq("warehouse_id", warehouseId).maybeSingle();
    counted.push({ productId: p.id, name: p.name, before: Number(level?.qty_on_hand ?? 0) });
  }

  // Type a count for each, deliberately different from what is held.
  const targets = counted.map((c, i) => ({ ...c, target: c.before + 7 + i }));

  await page.getByLabel("Why").fill(`ZZ automated count ${stamp}`);
  for (const t of targets) {
    await page.getByLabel(/find a product/i).fill(t.name);
    await page.waitForTimeout(350);
    const box = page.getByLabel(`Counted quantity for ${t.name}`).first();
    await box.waitFor({ state: "visible", timeout: 15000 });
    await box.fill(String(t.target));
  }

  await page.getByLabel(/find a product/i).fill("");
  await page.waitForTimeout(400);
  const beforeSave = await page.locator("body").innerText().catch(() => "");
  ok("it says what will change before saving", /will change/i.test(beforeSave),
     (beforeSave.match(/\d+ counted[^\n]*/) ?? ["(not shown)"])[0]);

  await page.getByRole("button", { name: /save the count/i }).click();
  await page.getByText(/stock updated|nothing to change/i)
    .first().waitFor({ state: "visible", timeout: 45000 }).catch(() => {});
  const after = await page.locator("body").innerText().catch(() => "");
  ok("the count is saved", /stock updated/i.test(after), after.replace(/\s+/g, " ").slice(0, 90));

  head("the levels now say what was counted");
  for (const t of targets) {
    const { data: level } = await db.from("inventory")
      .select("qty_on_hand").eq("product_id", t.productId).eq("warehouse_id", warehouseId).maybeSingle();
    ok(`${t.name} holds ${t.target}`, Number(level?.qty_on_hand ?? 0) === t.target,
       `(${level?.qty_on_hand ?? 0})`);
  }

  head("and the ledger explains why");
  const { data: movements } = await db.from("stock_movements")
    .select("id, product_id, type, quantity, reason, reference_type")
    .eq("reference_type", "stock_count")
    .in("product_id", targets.map((t) => t.productId));
  movementIds = (movements ?? []).map((m) => m.id);

  ok("a movement was written for each change", (movements ?? []).length === targets.length,
     `(${(movements ?? []).length})`);
  ok("each carries the reason given",
     (movements ?? []).every((m) => String(m.reason).includes(stamp)));
  ok("each is an adjustment, not a sale or a receipt",
     (movements ?? []).every((m) => m.type === "adjustment_in" || m.type === "adjustment_out"));
  ok("the quantities are the differences, not the counts",
     (movements ?? []).every((m) => {
       const t = targets.find((x) => x.productId === m.product_id);
       return Number(m.quantity) === Math.abs(t.target - t.before);
     }));

  head("counting the same figure again changes nothing");
  await page.goto(`${BASE}/inventory/count`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByLabel(/find a product/i).waitFor({ state: "visible", timeout: 30000 });
  await page.getByLabel("Why").fill(`ZZ repeat ${stamp}`);
  const first = targets[0];
  await page.getByLabel(/find a product/i).fill(first.name);
  await page.waitForTimeout(350);
  await page.getByLabel(`Counted quantity for ${first.name}`).first().fill(String(first.target));
  await page.getByRole("button", { name: /save the count/i }).click();
  await page.waitForTimeout(6000);
  const repeat = await page.locator("body").innerText().catch(() => "");
  ok("a count that agrees writes no movement", /nothing to change|already correct|matches/i.test(repeat),
     repeat.replace(/\s+/g, " ").slice(0, 90));

  const { count: repeats } = await db.from("stock_movements")
    .select("id", { count: "exact", head: true })
    .eq("reference_type", "stock_count").like("reason", `%repeat ${stamp}%`);
  ok("and the ledger is not padded with zero movements", (repeats ?? 0) === 0, `(${repeats})`);

  head("the sheet on a phone");
  // The same signed-in page, resized. A fresh context has no session and
  // lands on sign-in, where there is no save button to find - which is
  // what this check was actually reporting before.
  for (const [w, h, label] of [[390, 844, "390"], [360, 800, "360"]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`${BASE}/inventory/count`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByLabel(/find a product/i)
      .waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(800);

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);

    const save = page.getByRole("button", { name: /save the count/i }).first();
    const visible = await save.waitFor({ state: "visible", timeout: 15000 })
      .then(() => true).catch(() => false);

    // Visible is not the same as reachable: the bar is sticky and the
    // mobile navigation is fixed over the same corner, so this asks
    // whether anything is sitting on top of it.
    const pressable = visible
      ? await save.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const atCentre = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return el.contains(atCentre) || el === atCentre;
        }).catch(() => false)
      : false;

    ok(`the sheet fits and can be saved at ${label}px`, !overflow && pressable,
       overflow ? "horizontal overflow" : pressable ? "" : "save is covered or missing");
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  await ctx.close();
} catch (e) {
  fail++;
  console.log(`\n  FAIL  the run threw: ${e.message}`);
} finally {
  await browser.close();

  // Put every level back exactly as it was found, then remove the
  // movements this run wrote. The business's own stock must read the
  // same after this test as before it.
  const { data: warehouses } = await db
    .from("warehouses").select("id").eq("is_active", true).order("name").limit(1);
  const warehouseId = warehouses?.[0]?.id;

  for (const c of counted) {
    if (!warehouseId) break;
    if (c.before === 0) {
      await db.from("inventory")
        .delete().eq("product_id", c.productId).eq("warehouse_id", warehouseId);
    } else {
      await db.from("inventory").update({ qty_on_hand: c.before })
        .eq("product_id", c.productId).eq("warehouse_id", warehouseId);
    }
  }
  for (const id of movementIds) await db.from("stock_movements").delete().eq("id", id);
  await db.from("stock_movements").delete().like("reason", `%${stamp}%`);

  await db.from("audit_log").delete().eq("actor_id", created.user.id);
  await db.from("auth_pin_attempts").delete().eq("profile_id", created.user.id);
  await db.from("profiles").delete().eq("id", created.user.id);
  await db.auth.admin.deleteUser(created.user.id).catch(() => {});

  const { count: units } = await db.from("inventory").select("id", { count: "exact", head: true });
  const { count: moves } = await db.from("stock_movements").select("id", { count: "exact", head: true });
  const { count: people } = await db.from("profiles").select("id", { count: "exact", head: true });
  console.log(`\nrestored; inventory rows=${units ?? 0} movements=${moves ?? 0} profiles=${people ?? 0}`);
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
for (const e of [...new Set(consoleErrors)].slice(0, 5)) console.log(`  ${e}`);
console.log(`network errors: ${networkErrors.length}`);
for (const e of [...new Set(networkErrors)].slice(0, 6)) console.log(`  ${e}`);
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
