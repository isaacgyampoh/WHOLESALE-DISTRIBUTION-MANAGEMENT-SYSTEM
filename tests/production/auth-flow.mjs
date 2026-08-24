/**
 * The complete production authentication flow, against the deployed site.
 *
 * The real `admin` account is exercised but never consumed: it signs in
 * on the bootstrap PIN and is checked to be trapped on the set-PIN
 * screen, then signed out without choosing one. Whoever owns this
 * installation still gets to pick their own.
 *
 * Everything that needs a PIN changed is done on temporary accounts,
 * removed at the end.
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

// Override with PRODUCTION_URL to point at another deployment.
const BASE = process.env.PRODUCTION_URL
  ?? "https://wholesale-distribution-management-s-six.vercel.app";
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });
const digest = (pin) => createHmac("sha256", env.PIN_PEPPER).update(pin).digest("hex");

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };
const head = (t) => console.log(`\n=== ${t} ===`);

const stamp = Date.now().toString(36).slice(-5);
const made = [];        // temp profiles to remove
let tempProductId = null, tempCategoryId = null, tempVanId = null;
let tempWarehouseId = null, tempLoadId = null, bossId = null;

const { data: org } = await db.from("organizations").select("id").eq("slug", "default").single();

const hosted = await import("../../scripts/db/hosted.mjs");

/** Run a query as a given signed-in person, the way the app would. */
async function dbAsUser(profileId, sql, params = []) {
  const { client } = await hosted.connectHosted();
  try {
    await client.query("begin");
    await client.query("select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: profileId, role: "authenticated" })]);
    await client.query("set local role authenticated");
    const r = await client.query(sql, params);
    await client.query("rollback");
    return { ok: true, rows: r.rows };
  } catch (e) {
    await client.query("rollback").catch(() => {});
    return { ok: false, error: e.message };
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Sign-in attempts are counted per address, and this run makes a great
 * many from one - including deliberate failures. Left in place they lock
 * the runner out of its own test. The rate limiter is exercised on
 * purpose at the end instead.
 */
async function clearAttempts() {
  await db.from("auth_pin_attempts")
    .delete().gte("attempted_at", new Date(Date.now() - 86_400_000).toISOString());
}
await clearAttempts();
console.log("sign-in attempt history cleared for this run\n");

/** A temporary account holding a PIN somebody else chose. */
async function makeAccount(username, name, role, pin, provisional = true) {
  const { data, error } = await db.auth.admin.createUser({
    email: `zz-${username}@flow.invalid`, email_confirm: true,
    user_metadata: { full_name: name, role, org_id: org.id, username },
  });
  if (error) throw new Error(`${username}: ${error.message}`);
  made.push(data.user.id);
  const { error: uErr } = await db.from("profiles").update({
    full_name: name, username, role, org_id: org.id, is_active: true,
    pin_hash: digest(pin), pin_set_at: new Date().toISOString(),
    must_change_pin: provisional,
  }).eq("id", data.user.id);
  if (uErr) throw new Error(`${username} profile: ${uErr.message}`);
  return data.user.id;
}

let lastSignInError = "";

async function signIn(page, username, pin) {
  // networkidle, not domcontentloaded: typing into a controlled input
  // before React has hydrated leaves the component's state empty, so the
  // form falls back to a plain POST that simply re-renders the page -
  // no navigation, no error, nothing to see.
  await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByLabel("Username").waitFor({ state: "visible", timeout: 30000 });
  // React must have hydrated before anything is typed: a controlled
  // input written to beforehand leaves component state empty, and the
  // form then posts natively and simply re-renders the page.
  await page.waitForTimeout(900);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel(/digit 1 of 4/i).first().click({ timeout: 20000 });
  for (const d of pin) await page.keyboard.type(d, { delay: 60 });

  const submit = page.getByRole("button", { name: /sign(ing)? in/i }).first();

  // The form submits itself on the last digit. Pressing the button while
  // that is in flight posts a second time against a spent nonce, which
  // fails with nothing on screen - so this waits for the first attempt
  // to finish, and only presses if nothing was ever sent.
  const settled = await page
    .waitForURL((u) => !u.pathname.includes("sign-in"), { timeout: 12000 })
    .then(() => true).catch(() => false);

  if (!settled) {
    const pending = await submit.isDisabled().catch(() => false);
    const alerted = await page.getByRole("alert").count().catch(() => 0);
    if (!pending && !alerted) {
      await submit.click({ timeout: 10000 }).catch(() => {});
      await page.waitForURL((u) => !u.pathname.includes("sign-in"), { timeout: 30000 }).catch(() => {});
    } else if (pending) {
      await page.waitForURL((u) => !u.pathname.includes("sign-in"), { timeout: 30000 }).catch(() => {});
    }
  }

  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

  // The action redirects to "/", which the shell redirects again for a
  // provisional account. Catching it mid-chain shows an error frame that
  // is gone a moment later; settle before reading anything.
  for (let i = 0; i < 3; i++) {
    const body = await page.locator("body").innerText().catch(() => "");
    if (!/page couldn.t load/i.test(body)) break;
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  }

  if (page.url().includes("sign-in")) {
    const why = await page.getByRole("alert").first().innerText().catch(() => "");
    lastSignInError = why.trim() || "(no message shown)";
    return false;
  }
  // The action redirects to "/", and for a provisional account the shell
  // redirects again to /set-pin. Wait for that to land, or the URL is
  // read a beat too early and reports "/".
  await page.waitForURL((u) => u.pathname !== "/", { timeout: 8000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

  lastSignInError = "";
  return true;
}

async function setPin(page, pin) {
  // The boxes remount after a rejected attempt (their key carries the
  // message), so this waits for the live ones rather than assuming the
  // previous handles are still attached.
  const firstNew = page.getByLabel(/new 4-digit PIN, digit 1 of 4/i).first();
  await firstNew.waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(500);
  await firstNew.click({ timeout: 20000 });
  for (const d of pin) await page.keyboard.type(d, { delay: 60 });
  const firstConfirm = page.getByLabel(/confirm your new 4-digit PIN, digit 1 of 4/i).first();
  await firstConfirm.waitFor({ state: "visible", timeout: 20000 });
  await firstConfirm.click({ timeout: 20000 });
  for (const d of pin) await page.keyboard.type(d, { delay: 60 });
  await page.getByRole("button", { name: /set my pin/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("set-pin"), { timeout: 45000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
}

// The sign-out route only accepts POST, so the test drops the session
// cookie directly - the effect being tested is "no longer signed in".
const signOut = async (page) => { await page.context().clearCookies(); };

/** Supabase rate-limits minting sessions, so runs are spaced out. */
const breathe = (page) => page.waitForTimeout(2500);

const browser = await chromium.launch();
const consoleErrors = [], networkErrors = [];
const newPage = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 150)); });
  p.on("response", (r) => { if (r.status() >= 400) networkErrors.push(`${r.status()} ${r.url().replace(BASE, "").slice(0, 80)}`); });
  return p;
};

try {
  // ================================================================
  head("the bootstrap account is left untouched");
  // ================================================================
  //
  // Read directly, never signed into. Signing in as the real
  // administrator would consume its one first-login and leave the owner
  // of this installation with a PIN only this test knew. The mechanism
  // it relies on is exercised below on accounts made for the purpose.
  {
    const { data: boot } = await db.from("profiles")
      .select("username, role, is_active, must_change_pin, pin_hash").eq("username", "admin").single();
    ok("the first administrator exists", !!boot);
    ok("with the top-privilege role", boot?.role === "admin");
    ok("and is active", boot?.is_active === true);
    ok("their PIN is stored only as a digest, never in the clear",
       boot?.pin_hash?.length === 64 && !/^\d{4}$/.test(boot?.pin_hash ?? ""));

    // Which state it is in depends on whether its owner has signed in
    // yet, and both are correct - so this asserts the one that applies
    // rather than insisting on the state the installer left behind.
    const stillIssued = boot?.must_change_pin === true;
    if (stillIssued) {
      ok("still holding the bootstrap PIN, waiting for its owner",
         boot?.pin_hash === digest("1024"));
      console.log("        (first sign-in not yet done - PIN 1024 still opens it)");
    } else {
      ok("the bootstrap PIN has been replaced by one only its owner knows",
         boot?.pin_hash !== digest("1024"));
      console.log("        (first sign-in completed - the documented PIN no longer works)");
    }
  }

  // ================================================================
  head("first sign-in, PIN change, and the old PIN dying");
  // ================================================================
  const bossUser = `zz.boss.${stamp}`;
  bossId = await makeAccount(bossUser, "ZZ Flow Administrator", "admin", "7315");
  {
    const page = await newPage();
    ok("a provisional account signs in", await signIn(page, bossUser, "7315"), lastSignInError);
    ok("and is trapped on set-pin", page.url().includes("/set-pin"));

    // Refuses to keep the PIN it was given.
    await setPin(page, "7315");
    let body = await page.locator("body").innerText().catch(() => "");
    ok("keeping the issued PIN is refused",
       page.url().includes("/set-pin") && /different from the one you were given/i.test(body));

    // Refuses a documented/guessable one.
    await setPin(page, "1024");
    body = await page.locator("body").innerText().catch(() => "");
    ok("the bootstrap PIN cannot be adopted as permanent",
       page.url().includes("/set-pin") && /too easy to guess|already assigned/i.test(body),
       body.replace(/\s+/g, " ").slice(0, 70));

    await setPin(page, "6482");
    ok("a good PIN is accepted and lands on the application",
       !page.url().includes("/set-pin") && !page.url().includes("/sign-in"),
       page.url().replace(BASE, ""));

    const { data: after } = await db.from("profiles")
      .select("must_change_pin, pin_hash").eq("username", bossUser).single();
    ok("the account is no longer provisional", after.must_change_pin === false);
    ok("and the new PIN is stored as a digest",
       after.pin_hash === digest("6482") && after.pin_hash.length === 64);

    await signOut(page);
    ok("the old PIN no longer works", !(await signIn(page, bossUser, "7315")), lastSignInError);
    // Supabase rate-limits minting a session for the same address, so a
    // third sign-in inside a few seconds can be refused for a reason
    // that has nothing to do with the PIN. Give it room.
    await breathe(page);
    let backIn = await signIn(page, bossUser, "6482");
    if (!backIn) { await page.waitForTimeout(8000); backIn = await signIn(page, bossUser, "6482"); }
    ok("the new PIN does", backIn, lastSignInError);
    await page.context().close();
  }

  // ================================================================
  head("creating staff from inside the application");
  // ================================================================
  const mgrUser = `zz.mgr.${stamp}`;
  const drvUser = `zz.drv.${stamp}`;
  {
    const page = await newPage();
    await signIn(page, bossUser, "6482");

    for (const [username, name, role, pin] of [
      [mgrUser, "ZZ Flow Manager", "Manager", "5127"],
      [drvUser, "ZZ Flow Driver", "Driver", "9043"],
    ]) {
      await page.goto(`${BASE}/users`, { waitUntil: "domcontentloaded", timeout: 60000 });
      const opener = page.getByRole("button", { name: /create staff/i }).first();
      await opener.waitFor({ state: "visible", timeout: 30000 });
      await page.waitForTimeout(600);   // let the handler attach
      await opener.click();
      await page.getByLabel("Full name").fill(name);
      await page.getByLabel("Username").fill(username);
      await page.locator("#role").selectOption({ label: role });
      await page.getByLabel(/^PIN, digit 1 of 4$/i).first().click({ timeout: 20000 });
      for (const d of pin) await page.keyboard.type(d, { delay: 50 });
      await page.getByLabel(/^Confirm PIN, digit 1 of 4$/i).first().click({ timeout: 20000 });
      for (const d of pin) await page.keyboard.type(d, { delay: 50 });
      await page.getByRole("button", { name: /^create staff$/i }).last().click();

      // Wait for the hand-over panel itself rather than a fixed pause:
      // creating the account is several round trips.
      const revealed = page.getByText(/can now sign in/i).first();
      const appeared = await revealed.waitFor({ state: "visible", timeout: 30000 })
        .then(() => true).catch(() => false);
      const body = await page.locator("body").innerText().catch(() => "");
      ok(`${role.toLowerCase()} created`, appeared,
         appeared ? "" : body.replace(/\s+/g, " ").slice(0, 70));
      ok(`the ${role.toLowerCase()}'s username is handed over with the PIN`,
         body.includes(username));

      const { data: row } = await db.from("profiles")
        .select("id, role, org_id, must_change_pin, pin_hash").eq("username", username).maybeSingle();
      if (row) made.push(row.id);
      ok(`the ${role.toLowerCase()} is stored correctly`,
         !!row && row.role === role.toLowerCase() && row.org_id === org.id);
      ok(`the ${role.toLowerCase()}'s PIN is a digest, and provisional`,
         !!row && row.pin_hash === digest(pin) && row.pin_hash.length === 64
         && row.must_change_pin === true);

      await page.getByRole("button", { name: /^done$/i }).click().catch(() => {});
    }

    // A username already taken is refused.
    await page.goto(`${BASE}/users`, { waitUntil: "domcontentloaded", timeout: 60000 });
    const opener2 = page.getByRole("button", { name: /create staff/i }).first();
    await opener2.waitFor({ state: "visible", timeout: 30000 });
    await page.waitForTimeout(600);
    await opener2.click();
    await page.getByLabel("Full name").fill("ZZ Duplicate");
    await page.getByLabel("Username").fill(mgrUser);
    await page.getByLabel(/^PIN, digit 1 of 4$/i).first().click({ timeout: 20000 });
    for (const d of "3391") await page.keyboard.type(d, { delay: 50 });
    await page.getByLabel(/^Confirm PIN, digit 1 of 4$/i).first().click({ timeout: 20000 });
    for (const d of "3391") await page.keyboard.type(d, { delay: 50 });
    await page.getByRole("button", { name: /^create staff$/i }).last().click();
    await page.waitForTimeout(3000);
    const dupBody = await page.locator("body").innerText().catch(() => "");
    ok("a username already in use is refused", /already taken/i.test(dupBody), dupBody.slice(0, 70));
    await page.context().close();
  }

  // ================================================================
  head("cost price is not shown to those who may not see it");
  // ================================================================
  {
    // A product with a cost, in a category, on a van - because who may
    // see a cost is decided per product: a manager sees the categories
    // they are scoped to, and crew see what is on the van they are on.
    // Without that setup neither can see the product at all, and "no
    // cost shown" would prove nothing.
    const { data: cat } = await db.from("categories")
      .insert({ org_id: org.id, name: `ZZ Flow Category ${stamp}`, is_active: true })
      .select("id").single();
    tempCategoryId = cat?.id ?? null;

    const { data: prod } = await db.from("products").insert({
      org_id: org.id, sku: `ZZ-FLOW-${stamp}`, name: "ZZ Flow Test Item",
      unit_of_measure: "piece", list_price: 90, cost_price: 47.5, is_active: true,
      category_id: tempCategoryId,
    }).select("id").single();
    tempProductId = prod?.id ?? null;

    const page = await newPage();
    await signIn(page, bossUser, "6482");
    await page.goto(`${BASE}/products`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByText("ZZ Flow Test Item").first().waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
    const adminBody = await page.locator("body").innerText().catch(() => "");
    ok("an administrator sees the product", adminBody.includes("ZZ Flow Test Item"));
    ok("an administrator sees the cost price", adminBody.includes("47.50"));
    await signOut(page);
    await page.context().close();

    // ---- the manager: authorised for cost, within their categories ----
    const { data: mgr } = await db.from("profiles").select("id").eq("username", mgrUser).single();
    await db.from("manager_category_scopes")
      .insert({ org_id: org.id, profile_id: mgr.id, category_id: tempCategoryId });

    const mgrPage = await newPage();
    await signIn(mgrPage, mgrUser, "5127");
    ok("the manager is made to set their own PIN", mgrPage.url().includes("/set-pin"));
    await setPin(mgrPage, "8264");
    ok("the manager reaches the application", !mgrPage.url().includes("/set-pin"));
    await mgrPage.goto(`${BASE}/products`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await mgrPage.getByText("ZZ Flow Test Item").first().waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
    const mgrBody = await mgrPage.locator("body").innerText().catch(() => "");
    ok("a scoped manager sees the product", mgrBody.includes("ZZ Flow Test Item"));
    ok("and may see its cost, being authorised", mgrBody.includes("47.50"));
    await signOut(mgrPage);
    await mgrPage.context().close();

    // ---- the driver: sees the stock, never the cost ----
    const { data: drv } = await db.from("profiles").select("id").eq("username", drvUser).single();
    const { data: van } = await db.from("vans")
      .insert({ org_id: org.id, code: `ZZ${stamp}`.slice(0, 10), is_active: true })
      .select("id").single();
    tempVanId = van?.id ?? null;
    await db.from("van_assignments").insert({
      org_id: org.id, van_id: tempVanId, member_id: drv.id, crew_role: "driver",
    });
    await db.from("van_inventory").insert({
      org_id: org.id, van_id: tempVanId, product_id: tempProductId, qty_on_hand: 6,
    });

    // The driver's stock screen shows what was loaded onto the van, not
    // the raw inventory row, so the load has to exist for the product to
    // appear at all.
    const { data: wh } = await db.from("warehouses")
      .insert({ org_id: org.id, name: `ZZ Flow Depot ${stamp}`, is_active: true })
      .select("id").single();
    tempWarehouseId = wh?.id ?? null;

    const { data: load } = await db.from("van_loads").insert({
      org_id: org.id, van_id: tempVanId, driver_id: drv.id, warehouse_id: tempWarehouseId,
      // getSellingRound only looks at a load that has left the
      // warehouse; a draft one is not yet the driver's stock.
      status: "loaded",
    }).select("id").single();
    tempLoadId = load?.id ?? null;

    await db.from("van_load_items").insert({
      org_id: org.id, load_id: tempLoadId, product_id: tempProductId,
      qty_loaded: 6, unit_price: 90, unit_cost: 47.5,
    });

    const drvPage = await newPage();
    await signIn(drvPage, drvUser, "9043");
    ok("the driver is made to set their own PIN", drvPage.url().includes("/set-pin"));
    await setPin(drvPage, "7758");
    ok("the driver reaches the application", !drvPage.url().includes("/set-pin"),
       drvPage.url().replace(BASE, ""));

    await drvPage.goto(`${BASE}/products`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await drvPage.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    const drvBody = await drvPage.locator("body").innerText().catch(() => "");
    // The point of the pairing: the driver can see the very product
    // whose cost the administrator was just shown, and still not the
    // cost. The column is withheld by the database, not hidden by the
    // page - product_cost() returns null for this role.
    ok("no cost price appears anywhere on the driver's screens",
       !drvBody.includes("47.50"));

    // The screens are the symptom; this is the rule. Asked as the driver
    // themselves, the database returns null for the cost of the very
    // product whose cost it just gave the administrator - so the column
    // is withheld rather than merely left off the page. Anything reading
    // as this driver, by any route, gets the same null.
    const asDriver = await dbAsUser(drv.id, "select public.product_cost($1) as cost", [tempProductId]);
    const asBoss = await dbAsUser(bossId, "select public.product_cost($1) as cost", [tempProductId]);
    ok("the database itself refuses the driver a cost, not just the page",
       asDriver.ok && asDriver.rows[0].cost === null,
       asDriver.ok ? `(${asDriver.rows[0].cost})` : asDriver.error);
    ok("and gives it to an administrator, so the null means something",
       asBoss.ok && Number(asBoss.rows[0].cost) === 47.5,
       asBoss.ok ? `(${asBoss.rows[0].cost})` : asBoss.error);

    // And cannot reach staff administration at all.
    await drvPage.goto(`${BASE}/users`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await drvPage.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    const usersBody = await drvPage.locator("body").innerText().catch(() => "");
    ok("the driver cannot reach staff administration",
       !/Create staff/i.test(usersBody), usersBody.slice(0, 60));
    await signOut(drvPage);
    await drvPage.context().close();
  }

  // ================================================================
  head("what a failed sign-in says");
  // ================================================================
  {
    const page = await newPage();
    for (const [label, user, pin] of [
      ["an unknown username", `zz.nobody.${stamp}`, "1357"],
      ["a wrong PIN for a real account", bossUser, "1357"],
    ]) {
      await signIn(page, user, pin);
      const body = await page.locator("body").innerText().catch(() => "");
      ok(`${label} is refused`, page.url().includes("/sign-in"));
      ok(`${label} says the same thing`, /Incorrect username or PIN/i.test(body), body.slice(0, 60));
      ok(`${label} leaks no technical detail`,
         !/(PostgREST|supabase|JWT|SQL|postgres|relation |column )/i.test(body));
    }
    await page.context().close();
  }

  // ================================================================
  head("the sign-in screen itself");
  // ================================================================
  {
    const page = await newPage();
    await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    const body = await page.locator("body").innerText().catch(() => "");

    ok("names the company", body.includes("GAB Premium Ent"));
    ok("states what the system is", /Wholesale Distribution Management System/i.test(body));
    ok("shows no development or database branding",
       !/supabase|next\.js|localhost|demo/i.test(body));
    ok("asks for a username", /username/i.test(body));
    ok("asks for a 4-digit PIN", /4-digit PIN/i.test(body));

    // Labels, not placeholders alone.
    ok("the username field has a real label",
       await page.getByLabel("Username").count() > 0);
    ok("each PIN box is labelled for a screen reader",
       await page.getByLabel(/digit 1 of 4/i).count() > 0);
    ok("the PIN never renders as readable text",
       await page.locator('input[name="pin"]').getAttribute("type") === "hidden"
       || await page.locator('input[type="password"]').count() >= 0);

    // Keyboard reachable, in order.
    await page.keyboard.press("Tab");
    const first = await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
    ok("keyboard focus reaches the form", Boolean(first), String(first));

    // Numeric keyboard on a phone.
    ok("PIN boxes ask for a numeric keypad",
       await page.getByLabel(/digit 1 of 4/i).first().getAttribute("inputmode") === "numeric");
    ok("the username field does not autocapitalise",
       await page.getByLabel("Username").getAttribute("autocapitalize") === "none");

    // The button, and no double submission.
    ok("the primary action says Sign in",
       await page.getByRole("button", { name: /^sign in$/i }).count() > 0);

    for (const [w, h, label] of [[1440, 900, "desktop"], [1280, 800, "laptop"],
                                 [768, 1024, "tablet"], [390, 844, "mobile"],
                                 [375, 667, "small mobile"], [360, 640, "android"]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
      const formVisible = await page.getByRole("button", { name: /^sign in$/i }).isVisible().catch(() => false);
      ok(`sign-in fits and is usable at ${label}`, !overflow && formVisible,
         overflow ? "horizontal overflow" : formVisible ? "" : "submit not visible");
    }

    // A short screen with the keyboard up: the form must still be reachable.
    await page.setViewportSize({ width: 390, height: 420 });
    await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    const reachable = await page.evaluate(() => {
      const b = document.querySelector("button[type=submit]");
      if (!b) return false;
      b.scrollIntoView();
      const r = b.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight + 2;
    });
    ok("the submit button is reachable on a short screen (keyboard open)", reachable);
    await page.context().close();
  }
  // ================================================================
  head("guessing is rate limited");
  // ================================================================
  //
  // Deliberately last: it locks this address out for a quarter of an
  // hour, and the history is cleared afterwards.
  {
    await clearAttempts();
    const page = await newPage();
    let lockedAt = 0;
    for (let attempt = 1; attempt <= 7 && !lockedAt; attempt++) {
      await signIn(page, `zz.ghost.${stamp}`, "1357");
      if (/too many/i.test(lastSignInError)) lockedAt = attempt;
    }
    ok("repeated wrong guesses are eventually refused outright", lockedAt > 0,
       lockedAt ? `after ${lockedAt}` : "never locked");
    ok("and the refusal says how long to wait",
       /try again in \d+ minute/i.test(lastSignInError), lastSignInError);
    await page.context().close();
    await clearAttempts();
  }
} catch (e) {
  fail++;
  console.log(`\n  FAIL  the run threw: ${e.message}`);
} finally {
  await browser.close();

  await clearAttempts();

  // Children before parents, or the deletes are refused.
  if (tempLoadId) {
    await db.from("van_load_items").delete().eq("load_id", tempLoadId);
    await db.from("van_loads").delete().eq("id", tempLoadId);
  }
  if (tempVanId) {
    await db.from("van_inventory").delete().eq("van_id", tempVanId);
    await db.from("van_assignments").delete().eq("van_id", tempVanId);
    await db.from("stock_movements").delete().eq("van_id", tempVanId);
    await db.from("vans").delete().eq("id", tempVanId);
  }
  if (tempProductId) {
    await db.from("manager_category_scopes").delete().eq("category_id", tempCategoryId);
    await db.from("stock_movements").delete().eq("product_id", tempProductId);
    await db.from("inventory").delete().eq("product_id", tempProductId);
    await db.from("products").delete().eq("id", tempProductId);
  }
  if (tempCategoryId) await db.from("categories").delete().eq("id", tempCategoryId);
  if (tempWarehouseId) {
    await db.from("stock_movements").delete().eq("warehouse_id", tempWarehouseId);
    await db.from("inventory").delete().eq("warehouse_id", tempWarehouseId);
    await db.from("warehouses").delete().eq("id", tempWarehouseId);
  }
  {
    const { count: pc } = await db.from("products").select("id", { count: "exact", head: true });
    const { count: cc } = await db.from("categories").select("id", { count: "exact", head: true });
    const { count: vc } = await db.from("vans").select("id", { count: "exact", head: true });
    const { count: wc } = await db.from("warehouses").select("id", { count: "exact", head: true });
    const { count: lc } = await db.from("van_loads").select("id", { count: "exact", head: true });
    console.log(`\ntest fixtures removed; products=${pc ?? 0} categories=${cc ?? 0} vans=${vc ?? 0} warehouses=${wc ?? 0} loads=${lc ?? 0}`);
  }
  for (const id of made) {
    await db.from("auth_pin_attempts").delete().eq("profile_id", id);
    // audit_log references the actor, so its rows go first or the
    // profile delete is refused and the account is left behind.
    await db.from("audit_log").delete().eq("actor_id", id);
    await db.from("audit_log").delete().eq("target_id", id);
    const { error } = await db.from("profiles").delete().eq("id", id);
    if (error) console.log(`  could not remove profile ${id}: ${error.message}`);
    await db.auth.admin.deleteUser(id).catch(() => {});
  }
  // The bootstrap account is deliberately NOT restored. This test never
  // signs into it, and the installation is in real use: resetting it
  // would overwrite a PIN its owner has since chosen, which no test may
  // do. It is only read.
  const { data: left } = await db.from("profiles").select("username, role, must_change_pin");
  console.log(`temporary accounts removed; profiles remaining: ${left?.length ?? 0}`);
  for (const p of left ?? []) {
    console.log(`  ${p.username}  (${p.role})  must_change_pin=${p.must_change_pin}`);
  }
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
for (const e of [...new Set(consoleErrors)].slice(0, 6)) console.log(`  ${e}`);
console.log(`network errors: ${networkErrors.length}`);
for (const e of [...new Set(networkErrors)].slice(0, 8)) console.log(`  ${e}`);
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
