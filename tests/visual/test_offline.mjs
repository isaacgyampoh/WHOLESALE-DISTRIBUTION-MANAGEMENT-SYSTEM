/**
 * The driver PWA, offline for real.
 *
 * Playwright's `context.setOffline(true)` cuts the browser's network at
 * the same layer a dead cell does: fetch rejects, navigator.onLine goes
 * false, and the service worker is what keeps the app openable. Nothing
 * here inspects the service worker's source - it is exercised.
 *
 * The claim being tested: a driver records a round with no signal,
 * nothing is lost, and when the queue uploads twice the business is
 * left with exactly one of everything.
 *
 *   npm start   (in another shell)
 *   node tests/visual/test_offline.mjs
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

/**
 * Evaluate in the page, retrying if a navigation replaced the document
 * underneath us. Offline the app re-renders as the service worker
 * answers, and losing the execution context is a race in the harness,
 * not a defect in what is being tested.
 */
async function evalIn(page, fn, arg, attempts = 15) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      // Offline the app re-renders as the service worker answers and as
      // failed requests settle. Waiting for the document to be complete
      // before each attempt makes the retry cheap rather than a spin.
      await page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
      return await page.evaluate(fn, arg);
    } catch (error) {
      lastError = error;
      if (!/context was destroyed|Execution context/i.test(error.message)) throw error;
      await page.waitForTimeout(1200);
    }
  }
  throw lastError;
}

const created = [];
let vanId = null, loadId = null;
const browser = await chromium.launch();

try {
  const { data: org } = await admin.from("organizations")
    .select("id").eq("slug", "gab-premium-ent-demo").single();

  // ---- a driver with a van and a dispatched load of their own -------
  let PIN = null;
  for (let i = 0; i < 60 && !PIN; i++) {
    const candidate = String(1000 + Math.floor(Math.random() * 8999));
    const { data } = await admin.from("profiles").select("id").eq("pin_hash", digest(candidate)).maybeSingle();
    if (!data) PIN = candidate;
  }
  const stamp = Date.now().toString(36);
  const { data: user, error: userError } = await admin.auth.admin.createUser({
    email: `offline-${stamp}@example.com`, email_confirm: true,
    user_metadata: { full_name: "Offline Tester", role: "driver", org_id: org.id },
  });
  if (userError) throw new Error(userError.message);
  created.push(user.user.id);
  await admin.from("profiles").update({ pin_hash: digest(PIN) }).eq("id", user.user.id);

  const { data: warehouse } = await admin.from("warehouses")
    .select("id").eq("org_id", org.id).limit(1).single();
  const { data: products } = await admin.from("products")
    .select("id, list_price, cost_price").eq("org_id", org.id).limit(2);
  const { data: van } = await admin.from("vans")
    .insert({ org_id: org.id, code: `OFF-${stamp}`.slice(0, 12), registration_no: `GT-${stamp}`.slice(0, 14), home_warehouse_id: warehouse.id })
    .select("id").single();
  vanId = van.id;
  await admin.from("van_assignments")
    .insert({ org_id: org.id, van_id: van.id, driver_id: user.user.id });

  // Stock in, then onto the van through the real dispatch function.
  for (const p of products) {
    await admin.from("stock_movements").insert({
      org_id: org.id, product_id: p.id, warehouse_id: warehouse.id,
      type: "receipt", quantity: 400, reason: "Offline test opening",
    });
  }
  const { data: load } = await admin.from("van_loads").insert({
    org_id: org.id, van_id: van.id, driver_id: user.user.id, warehouse_id: warehouse.id,
    status: "draft", load_date: new Date().toISOString().slice(0, 10),
    driver_confirmed_at: new Date().toISOString(), opening_float: 100,
  }).select("id, load_number").single();
  loadId = load.id;
  for (const p of products) {
    await admin.from("van_load_items").insert({
      org_id: org.id, load_id: load.id, product_id: p.id,
      qty_loaded: 200, unit_price: p.list_price, unit_cost: p.cost_price,
    });
  }
  await admin.from("van_loads").update({ status: "loaded" }).eq("id", load.id);
  const { error: dispatchError } = await admin.rpc("dispatch_van_load", { p_load_id: load.id });
  if (dispatchError) throw new Error(`dispatch: ${dispatchError.message}`);

  const onVan = async () => {
    const { data } = await admin.from("van_inventory")
      .select("qty_on_hand").eq("van_id", van.id);
    return (data ?? []).reduce((s, r) => s + Number(r.qty_on_hand), 0);
  };
  const startingStock = await onVan();
  ok("the test van is loaded", startingStock === 400, `${startingStock} units`);

  await admin.from("auth_pin_attempts").delete()
    .in("request_ip", ["::1", "127.0.0.1"])
    .gte("attempted_at", new Date(Date.now() - 3_600_000).toISOString());

  // ---- sign in and let the device cache its round ------------------
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true, isMobile: true,
  });
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(45_000);

  await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
  await page.locator('input[aria-label^="Digit"]').first().click();
  await page.keyboard.type(PIN, { delay: 50 });
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 30_000 }).catch(() => {});
  ok("the driver signs in with a PIN", !page.url().includes("/sign-in"));

  await page.goto(`${BASE}/driver`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load");
  ok("the round shows their van", (await page.content()).includes(`OFF-${stamp}`.slice(0, 12)));

  console.log("\n=== the service worker takes control ===");
  const controlled = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return "unsupported";
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    return reg ? "ready" : "none";
  });
  ok("a service worker is registered and active", controlled === "ready", controlled);

  // Is the sync engine actually installed on this database? 0022 adds
  // it, and the hosted project only has it once the SQL has been run.
  // Everything that does not need the server is still exercised below;
  // the parts that do are reported as skipped rather than as passes.
  const { error: bootstrapError } = await admin.rpc("sync_bootstrap");
  const syncInstalled = !bootstrapError || !/does not exist|schema cache/i.test(bootstrapError.message);
  if (!syncInstalled) {
    console.log("\n  ! Migration 0022 is not on this database, so the server");
    console.log("    half of sync cannot be exercised. Run:");
    console.log("      database/UPGRADE_0022_OFFLINE_SYNC.sql");
    console.log("    The offline shell, the queue and idempotency are still tested.\n");
  }

  // Give the snapshot a moment to land in IndexedDB.
  await page.goto(`${BASE}/driver/sell`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  // Without the server function there is nothing to cache, so the test
  // supplies the same shape the function would have returned. What is
  // being tested from here is the device, not the query.
  if (!syncInstalled) {
    await evalIn(page, async ({ loadId, loadNumber, vanCode, products, customerId }) => {
      const open = indexedDB.open("gab-offline", 1);
      const db = await new Promise((res) => { open.onsuccess = () => res(open.result); });
      await new Promise((res) => {
        const tx = db.transaction("meta", "readwrite");
        const req = tx.objectStore("meta").put({
          key: "snapshot",
          value: {
            cached_at: new Date().toISOString(),
            van: { id: "test", code: vanCode, registration_no: vanCode },
            load: { id: loadId, load_number: loadNumber, status: "dispatched", opening_float: 100 },
            stock: products.map((p) => ({
              product_id: p.id, sku: p.sku ?? "SKU", name: p.name ?? "Product", qty_on_hand: 200,
            })),
            prices: products.map((p) => ({ product_id: p.id, unit_price: 10, tax_rate: 0 })),
            customers: [{
              id: customerId, code: "C1", name: "Test Customer", phone: null,
              balance: 0, credit_available: 100000,
            }],
          },
          savedAt: new Date().toISOString(),
        });
        req.onsuccess = () => res(true);
      });
    }, {
      loadId: load.id, loadNumber: load.load_number,
      vanCode: `OFF-${stamp}`.slice(0, 12),
      products,
      customerId: (await admin.from("customers").select("id").eq("org_id", org.id).limit(1).single()).data.id,
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
  }

  const cached = await evalIn(page, async () => {
    const open = indexedDB.open("gab-offline", 1);
    const db = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    const tx = db.transaction("meta", "readonly");
    const req = tx.objectStore("meta").get("snapshot");
    const row = await new Promise((res) => { req.onsuccess = () => res(req.result); req.onerror = () => res(null); });
    return row?.value ?? null;
  });
  ok("the van's round is cached on the device", Boolean(cached?.load), cached?.load?.load_number ?? "none");
  ok("cached stock is present", (cached?.stock ?? []).length > 0, `${cached?.stock?.length} line(s)`);
  ok("cached customers are present", (cached?.customers ?? []).length > 0, `${cached?.customers?.length}`);
  ok("the cache holds no credential", !/pin|hash|token|secret/i.test(JSON.stringify(cached ?? {})));

  const customerId = cached.customers[0].id;
  const productId = cached.stock[0].product_id;

  // The app warms the driver's screens into the cache while there is a
  // signal. Wait for that to finish before cutting the network: a real
  // driver has minutes of coverage at the depot, and going offline
  // mid-warm would test the harness rather than the application.
  const warmed = await page.waitForFunction(async () => {
    const names = await caches.keys();
    const shell = names.find((n) => n.startsWith("gab-shell"));
    if (!shell) return false;
    const cache = await caches.open(shell);
    const keys = (await cache.keys()).map((r) => new URL(r.url).pathname);
    return ["/driver", "/driver/sell", "/driver/collect",
            "/driver/return", "/driver/reconcile", "/driver/queue"]
      .every((route) => keys.includes(route));
  }, null, { timeout: 30_000 }).then(() => true).catch(() => false);
  ok("the driver's screens are cached before the signal goes", warmed);

  // ---- cut the network ---------------------------------------------
  console.log("\n=== offline ===");
  await context.setOffline(true);

  const navOffline = await evalIn(page, () => navigator.onLine);
  ok("the browser reports itself offline", navOffline === false);

  await page.goto(`${BASE}/driver/sell`, { waitUntil: "domcontentloaded" }).catch(() => {});
  const offlineBody = await page.content();
  ok("the app still opens with no network",
     !offlineBody.includes("ERR_INTERNET_DISCONNECTED") && offlineBody.includes("Sell"),
     offlineBody.includes("Sell") ? "the sell screen rendered" : "did not render");
  ok("the driver is told they are offline", /Working offline|No signal/.test(offlineBody));

  // ---- queue twenty sales and a collection, all offline -------------
  // Stay on the sell screen, which the service worker already served
  // from cache above. Navigating again while offline restarts the
  // client router against data it cannot fetch, and the reload that
  // follows is what was destroying the execution context.
  await page.waitForTimeout(2000);

  const QUEUED = 20;
  const queueResult = await evalIn(page, async ({ loadId, customerId, productId, count }) => {
    const open = indexedDB.open("gab-offline", 1);
    const db = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    const uuid = () => crypto.randomUUID();
    const put = (item) => new Promise((res, rej) => {
      const tx = db.transaction("queue", "readwrite");
      const req = tx.objectStore("queue").put(item);
      req.onsuccess = () => res(true);
      req.onerror = () => rej(req.error);
    });
    const now = new Date().toISOString();
    for (let i = 0; i < count; i++) {
      await put({
        id: uuid(), operation: "van_sale",
        payload: {
          load_id: loadId, customer_id: customerId, sale_type: "cash",
          amount_paid: null,
          lines: [{ product_id: productId, quantity: 1, unit_price: 10, tax_rate: 0 }],
        },
        summary: `Offline sale ${i + 1}`, status: "pending", attempts: 0,
        occurredAt: now, updatedAt: now,
      });
    }
    await put({
      id: uuid(), operation: "collection",
      payload: { customer_id: customerId, amount: 25, method: "cash", notes: "Offline collection" },
      summary: "Offline collection", status: "pending", attempts: 0,
      occurredAt: now, updatedAt: now,
    });
    const all = await new Promise((res) => {
      const tx = db.transaction("queue", "readonly");
      const req = tx.objectStore("queue").getAll();
      req.onsuccess = () => res(req.result);
    });
    return all.length;
  }, { loadId: load.id, customerId, productId, count: QUEUED });

  ok(`${QUEUED} sales and a collection are queued on the device`,
     queueResult === QUEUED + 1, `${queueResult} items`);

  await page.goto(`${BASE}/driver/queue`, { waitUntil: "domcontentloaded" }).catch(() => {});
  // The screen renders from the cached shell, then hydrates and reads
  // IndexedDB. Offline that is slower than a fixed delay should assume,
  // so it is waited for by what it must end up showing.
  const listed = await page
    .getByText("Waiting to send")
    .first()
    .waitFor({ timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  ok("the queue screen lists them while offline", listed,
     listed ? "" : "queue screen did not render offline");

  const duringOffline = await onVan();
  ok("nothing reached the server while offline", duringOffline === startingStock,
     `${duringOffline} units`);

  // ---- back in coverage --------------------------------------------
  console.log("\n=== reconnecting ===");
  await context.setOffline(false);
  await page.goto(`${BASE}/driver/queue`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  // Press Send everything, and wait for the queue to actually drain
  // rather than for a fixed interval.
  await page.getByRole("button", { name: "Send everything" }).click();
  const drained = await page.waitForFunction(async () => {
    const open = indexedDB.open("gab-offline", 1);
    const db = await new Promise((res) => { open.onsuccess = () => res(open.result); });
    const all = await new Promise((res) => {
      const tx = db.transaction("queue", "readonly");
      const req = tx.objectStore("queue").getAll();
      req.onsuccess = () => res(req.result);
    });
    return all.length > 0 && all.every((i) => i.status === "synced");
  }, null, { timeout: 240_000 }).then(() => true).catch(() => false);

  const queueState = await evalIn(page, async () => {
    const open = indexedDB.open("gab-offline", 1);
    const db = await new Promise((res) => { open.onsuccess = () => res(open.result); });
    const all = await new Promise((res) => {
      const tx = db.transaction("queue", "readonly");
      const req = tx.objectStore("queue").getAll();
      req.onsuccess = () => res(req.result);
    });
    const counts = {};
    for (const i of all) counts[i.status] = (counts[i.status] ?? 0) + 1;
    return { counts, firstError: all.find((i) => i.error)?.error ?? null };
  });
  ok("every queued operation reports as sent", drained,
     drained ? "" : `${JSON.stringify(queueState.counts)} ${queueState.firstError ?? ""}`);

  if (!syncInstalled) {
    console.log("  SKIP  server-side sync assertions (migration 0022 not installed)");
    console.log(`\n  ${pass} passed, ${fail} failed`);
    await context.close();
    await browser.close();
    for (const id of created) await admin.auth.admin.deleteUser(id);
    process.exit(fail ? 1 : 0);
  }

  const afterSync = await onVan();
  ok(`the van is ${QUEUED} lighter`, afterSync === startingStock - QUEUED,
     `${startingStock} -> ${afterSync}`);

  const { count: saleCount } = await admin
    .from("van_sales").select("id", { count: "exact", head: true }).eq("load_id", load.id);
  ok(`exactly ${QUEUED} sales reached the server`, saleCount === QUEUED, `${saleCount}`);

  const { data: collections } = await admin
    .from("credit_transactions").select("amount")
    .eq("customer_id", customerId).eq("type", "payment")
    .gte("occurred_at", new Date(Date.now() - 600_000).toISOString());
  ok("the collection reached the server", (collections ?? []).length >= 1,
     `${collections?.length} in the last 10 minutes`);

  // ---- the same queue, uploaded again ------------------------------
  console.log("\n=== uploading the same queue a second time ===");
  await evalIn(page, async () => {
    const open = indexedDB.open("gab-offline", 1);
    const db = await new Promise((res) => { open.onsuccess = () => res(open.result); });
    const all = await new Promise((res) => {
      const tx = db.transaction("queue", "readonly");
      const req = tx.objectStore("queue").getAll();
      req.onsuccess = () => res(req.result);
    });
    // Exactly what a phone that lost its connection mid-upload looks
    // like: the work was applied, the device never heard so.
    for (const item of all) {
      await new Promise((res) => {
        const tx = db.transaction("queue", "readwrite");
        const req = tx.objectStore("queue").put({ ...item, status: "pending" });
        req.onsuccess = () => res(true);
      });
    }
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Send everything" }).click();
  await page.waitForFunction(async () => {
    const open = indexedDB.open("gab-offline", 1);
    const db = await new Promise((res) => { open.onsuccess = () => res(open.result); });
    const all = await new Promise((res) => {
      const tx = db.transaction("queue", "readonly");
      const req = tx.objectStore("queue").getAll();
      req.onsuccess = () => res(req.result);
    });
    return all.length > 0 && all.every((i) => i.status === "synced");
  }, null, { timeout: 240_000 }).catch(() => {});

  const afterReplay = await onVan();
  ok("replaying the whole queue moves no stock", afterReplay === afterSync,
     `${afterSync} -> ${afterReplay}`);

  const { count: replayCount } = await admin
    .from("van_sales").select("id", { count: "exact", head: true }).eq("load_id", load.id);
  ok(`there are still ${QUEUED} sales, not ${QUEUED * 2}`, replayCount === QUEUED, `${replayCount}`);

  const { data: collectionsAfter } = await admin
    .from("credit_transactions").select("amount")
    .eq("customer_id", customerId).eq("type", "payment")
    .gte("occurred_at", new Date(Date.now() - 600_000).toISOString());
  ok("the collection was not taken twice",
     (collectionsAfter ?? []).length === (collections ?? []).length,
     `${collectionsAfter?.length}`);

  // ---- the sync history the office can audit ------------------------
  const { count: opCount } = await admin
    .from("sync_operations").select("id", { count: "exact", head: true })
    .eq("profile_id", user.user.id);
  ok("every operation is recorded once in the sync history",
     opCount === QUEUED + 1, `${opCount} rows`);

  const { data: ops } = await admin
    .from("sync_operations").select("payload").eq("profile_id", user.user.id).limit(50);
  ok("the sync history holds no credential",
     !/pin|hash|pepper|secret|token/i.test(JSON.stringify(ops ?? [])));

  await context.close();
} catch (error) {
  console.error(`\nAborted: ${error.message}`);
  fail++;
} finally {
  await browser.close();
  // Tear down in dependency order.
  if (loadId) {
    await admin.from("sync_operations").delete().in("profile_id", created);
    const { data: sales } = await admin.from("van_sales").select("id").eq("load_id", loadId);
    for (const s of sales ?? []) await admin.from("van_sale_items").delete().eq("sale_id", s.id);
    await admin.from("van_sales").delete().eq("load_id", loadId);
    await admin.from("van_load_items").delete().eq("load_id", loadId);
    await admin.from("van_loads").delete().eq("id", loadId);
  }
  if (vanId) {
    await admin.from("van_inventory").delete().eq("van_id", vanId);
    await admin.from("van_assignments").delete().eq("van_id", vanId);
    await admin.from("vans").delete().eq("id", vanId);
  }
  for (const id of created) await admin.auth.admin.deleteUser(id);
  console.log("\n  test van, load and account removed");
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
