/**
 * Hosted Supabase integration gate.
 *
 * Exercises the real platform path - GoTrue for authentication,
 * PostgREST for data access - rather than a direct PostgreSQL
 * connection. Local tests already prove the schema; this proves the
 * hosting.
 *
 *   node verify.mjs [--preflight-only] [--keep]
 *
 * No secret is ever printed. Test data lives in its own organizations,
 * prefixed HTEST-, and is removed unless --keep is passed.
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnv, reportEnvPresence, describeProject, isPlaceholder } from "./env.mjs";
import { assessProject, printAssessment, TEST_PREFIX } from "./safety.mjs";

const PREFLIGHT_ONLY = process.argv.includes("--preflight-only");
const KEEP = process.argv.includes("--keep");

let pass = 0, fail = 0;
const results = [];
const ok = (name, condition, detail = "") => {
  condition ? pass++ : fail++;
  results.push({ name, condition, detail });
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  return condition;
};
const section = (t) => console.log(`\n=== ${t} ===`);

let env;
try {
  env = loadEnv();
} catch (error) {
  // A missing config file is a setup step, not a crash.
  console.error(`\n${error.message}\n`);
  process.exit(1);
}

section("Step 3 - environment");
console.log(`  project host: ${describeProject(env)}`);
const missing = reportEnvPresence(env);
if (missing.length) {
  console.error(`\nCannot continue: ${missing.join(", ")} not set.`);
  process.exit(1);
}
const hasServiceRole = !isPlaceholder(env.SUPABASE_SERVICE_ROLE_KEY);
if (!hasServiceRole) {
  console.error(
    "\nSUPABASE_SERVICE_ROLE_KEY is required: this suite provisions and " +
      "removes its own test users and organizations.",
  );
  process.exit(1);
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
/** A fresh, isolated browser-equivalent client. */
const anonClient = () =>
  createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

// ---------------------------------------------------------------- preflight
section("Step 2 - schema reachable through PostgREST");
{
  const { error } = await admin.from("organizations").select("id").limit(1);
  ok("service role can reach organizations", !error, error ? `-> ${error.message}` : "");

  const expected = [
    "profiles", "products", "customers", "warehouses", "inventory",
    "stock_movements", "vans", "van_loads", "van_sales", "van_returns",
    "van_reconciliations", "credit_transactions", "manager_category_scopes",
  ];
  let found = 0;
  for (const t of expected) {
    const { error: e } = await admin.from(t).select("*", { count: "exact", head: true });
    if (!e) found++;
    else console.log(`    missing or unreadable: ${t} -> ${e.message}`);
  }
  ok("all expected tables exposed", found === expected.length, `(${found}/${expected.length})`);

  const views = [
    "stock_summary", "customer_balances", "invoice_ageing", "customer_statement",
    "customer_credit_position", "van_stock_summary", "van_load_summary",
    "reconciliation_variances",
  ];
  let vfound = 0;
  for (const v of views) {
    const { error: e } = await admin.from(v).select("*", { count: "exact", head: true });
    if (!e) vfound++;
    else console.log(`    missing or unreadable view: ${v} -> ${e.message}`);
  }
  ok("all reporting views exposed", vfound === views.length, `(${vfound}/${views.length})`);
}

section("Step 8 - production data safety gate");
const assessment = await assessProject(admin);
const safe = printAssessment(assessment);
if (!safe) {
  console.error(
    "\nRefusing to run write tests: this project holds records that are " +
      "neither demo seed nor prior test data.\nRe-run against a development " +
      "project, or clear the data deliberately first.",
  );
  process.exit(2);
}
if (PREFLIGHT_ONLY) {
  console.log("\nPreflight only. Stopping before any write.");
  process.exit(fail ? 1 : 0);
}

// -------------------------------------------------------------- provisioning
const stamp = Date.now().toString(36);
const slugA = `${TEST_PREFIX}a-${stamp}`.toLowerCase();
const slugB = `${TEST_PREFIX}b-${stamp}`.toLowerCase();
const created = { users: [], orgs: [] };

async function makeOrg(name, slug) {
  const { data, error } = await admin
    .from("organizations").insert({ name, slug }).select("id").single();
  if (error) throw new Error(`could not create organization: ${error.message}`);
  created.orgs.push(data.id);
  return data.id;
}

async function makeUser(email, password, role, orgId, fullName) {
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: fullName, role, org_id: orgId },
  });
  if (error) throw new Error(`could not create user: ${error.message}`);
  created.users.push(data.user.id);
  return data.user.id;
}

/** Sign in through GoTrue exactly as the browser does. */
async function signIn(email, password) {
  const c = anonClient();
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  return { client: c, session: data?.session ?? null, user: data?.user ?? null, error };
}

const PW = `Htest-${stamp}-Aa1!`;
let orgA, orgB, adminA, mgrA, driverA, adminB;

try {
  section("Step 4 - authentication");
  orgA = await makeOrg(`${TEST_PREFIX}Org A`, slugA);
  orgB = await makeOrg(`${TEST_PREFIX}Org B`, slugB);
  ok("two isolated test organizations created", Boolean(orgA && orgB));

  adminA = await makeUser(`htest-admin-a-${stamp}@example.com`, PW, "admin", orgA, "Admin A");
  mgrA  = await makeUser(`htest-mgr-a-${stamp}@example.com`, PW, "manager", orgA, "Manager A");
  driverA = await makeUser(`htest-drv-a-${stamp}@example.com`, PW, "driver", orgA, "Driver A");
  adminB = await makeUser(`htest-admin-b-${stamp}@example.com`, PW, "admin", orgB, "Admin B");
  ok("four test users created via Auth admin API", created.users.length === 4);

  // The auth.users trigger should have produced a profile per user.
  const { data: profiles } = await admin
    .from("profiles").select("id, role, org_id").in("id", created.users);
  ok("signup trigger created a profile for each", (profiles ?? []).length === 4,
     `(${(profiles ?? []).length}/4)`);
  ok("org_id taken from user metadata, not the browser",
     (profiles ?? []).filter((p) => p.org_id === orgA).length === 3 &&
     (profiles ?? []).filter((p) => p.org_id === orgB).length === 1);

  const signedIn = await signIn(`htest-admin-a-${stamp}@example.com`, PW);
  ok("user can authenticate", !signedIn.error && Boolean(signedIn.session),
     signedIn.error ? `-> ${signedIn.error.message}` : "");
  ok("session carries an access token", Boolean(signedIn.session?.access_token));
  ok("session carries a refresh token", Boolean(signedIn.session?.refresh_token));

  const { data: whoami } = await signedIn.client.auth.getUser();
  ok("authenticated request resolves the correct user", whoami?.user?.id === adminA);

  const { data: myProfile } = await signedIn.client
    .from("profiles").select("role, org_id").eq("id", adminA).single();
  ok("profile and organization resolve for the caller",
     myProfile?.org_id === orgA && myProfile?.role === "admin",
     `(role=${myProfile?.role})`);

  const badLogin = await signIn(`htest-admin-a-${stamp}@example.com`, "wrong-password");
  ok("wrong password rejected", Boolean(badLogin.error));

  section("Step 4 - unauthenticated access is refused");
  {
    const c = anonClient();
    for (const t of ["products", "customers", "profiles", "van_sales"]) {
      const { data, error } = await c.from(t).select("*").limit(1);
      ok(`anon cannot read ${t}`, Boolean(error) || (data ?? []).length === 0,
         error ? `-> ${error.message.slice(0, 44)}` : "(empty)");
    }
  }

  section("Step 6 - anonymous cannot call privileged functions");
  {
    const c = anonClient();
    const zero = "00000000-0000-0000-0000-000000000000";
    for (const [fn, args] of [
      ["dispatch_van_load", { p_load_id: zero }],
      ["approve_reconciliation", { p_recon_id: zero }],
      ["approve_van_return", { p_return_id: zero }],
      ["record_credit_payment", { p_customer_id: zero, p_amount: 100 }],
      ["complete_van_sale", { p_sale_id: zero }],
    ]) {
      const { error } = await c.rpc(fn, args);
      // Anything other than a privilege/auth refusal means the guard was
      // reached and passed - the bypass fixed in migration 0015.
      const refused =
        Boolean(error) &&
        /permission denied|Authentication required|Permission denied|not find the function/i.test(error.message);
      ok(`anon rpc ${fn} refused`, refused,
         error ? `-> ${error.message.slice(0, 46)}` : "-> CALL SUCCEEDED");
    }
  }

  section("Step 5 - tenant isolation through PostgREST");
  {
    const a = await signIn(`htest-admin-a-${stamp}@example.com`, PW);
    const b = await signIn(`htest-admin-b-${stamp}@example.com`, PW);

    // Give each organization one product via the service role.
    await admin.from("categories").insert({ org_id: orgA, name: `${TEST_PREFIX}Cat A` });
    await admin.from("categories").insert({ org_id: orgB, name: `${TEST_PREFIX}Cat B` });
    await admin.from("products").insert({
      org_id: orgA, sku: `${TEST_PREFIX}A-1`, name: "Org A widget",
      cost_price: 10, list_price: 20,
    });
    await admin.from("products").insert({
      org_id: orgB, sku: `${TEST_PREFIX}B-1`, name: "Org B widget",
      cost_price: 10, list_price: 20,
    });

    const { data: aSees } = await a.client.from("products").select("sku").eq("org_id", orgB);
    ok("org A cannot read org B products", (aSees ?? []).length === 0, `(${(aSees ?? []).length} rows)`);

    const { data: bSees } = await b.client.from("products").select("sku").eq("org_id", orgA);
    ok("org B cannot read org A products", (bSees ?? []).length === 0, `(${(bSees ?? []).length} rows)`);

    const { data: aOwn } = await a.client.from("products").select("sku").eq("org_id", orgA);
    ok("org A can read its own products", (aOwn ?? []).length >= 1, `(${(aOwn ?? []).length} rows)`);

    const { data: upd, error: updErr } = await a.client
      .from("products").update({ name: "hijacked" }).eq("org_id", orgB).select();
    ok("org A cannot update org B products",
       Boolean(updErr) || (upd ?? []).length === 0,
       updErr ? `-> ${updErr.message.slice(0, 40)}` : `(${(upd ?? []).length} rows)`);

    const { error: insErr } = await a.client
      .from("products").insert({ org_id: orgB, sku: `${TEST_PREFIX}SMUGGLE`, name: "x" });
    ok("org A cannot insert into org B", Boolean(insErr),
       insErr ? `-> ${insErr.message.slice(0, 40)}` : "-> INSERT SUCCEEDED");

    for (const t of ["customers", "van_sales", "credit_transactions", "van_reconciliations"]) {
      const { data } = await a.client.from(t).select("id").eq("org_id", orgB);
      ok(`org A cannot read org B ${t}`, (data ?? []).length === 0);
    }
  }

  section("Step 5 - driver and category manager restrictions");
  {
    const d = await signIn(`htest-drv-a-${stamp}@example.com`, PW);
    ok("driver can authenticate", Boolean(d.session));

    const { data: drvProducts } = await d.client.from("products").select("sku");
    // A driver with no van load sees no products at all.
    ok("driver sees only stock on their van", (drvProducts ?? []).length === 0,
       `(${(drvProducts ?? []).length} products)`);

    const { error: whErr } = await d.client.from("stock_movements").insert({
      org_id: orgA, product_id: "00000000-0000-0000-0000-000000000000",
      warehouse_id: "00000000-0000-0000-0000-000000000000", type: "receipt", quantity: 1,
    });
    ok("driver cannot post warehouse stock", Boolean(whErr),
       whErr ? `-> ${whErr.message.slice(0, 40)}` : "-> INSERT SUCCEEDED");

    const { data: promoted, error: promErr } = await d.client
      .from("profiles").update({ role: "admin" }).eq("id", driverA).select();
    ok("driver cannot promote self",
       Boolean(promErr) || (promoted ?? []).length === 0,
       promErr ? `-> ${promErr.message.slice(0, 40)}` : `(${(promoted ?? []).length} rows)`);

    const m = await signIn(`htest-mgr-a-${stamp}@example.com`, PW);
    const { data: mgrProducts } = await m.client.from("products").select("sku");
    // Manager has no category scopes granted, so sees nothing.
    ok("unscoped manager sees no products", (mgrProducts ?? []).length === 0,
       `(${(mgrProducts ?? []).length} products)`);

    const catA = await admin.from("categories").select("id").eq("org_id", orgA)
      .like("name", `${TEST_PREFIX}%`).single();
    await admin.from("products").update({ category_id: catA.data.id })
      .eq("org_id", orgA).like("sku", `${TEST_PREFIX}%`);
    await admin.from("manager_category_scopes")
      .insert({ org_id: orgA, profile_id: mgrA, category_id: catA.data.id });

    const m2 = await signIn(`htest-mgr-a-${stamp}@example.com`, PW);
    const { data: scoped } = await m2.client.from("products").select("sku");
    ok("scoped manager sees granted category", (scoped ?? []).length >= 1,
       `(${(scoped ?? []).length} products)`);

    const { error: scopeErr } = await m2.client.from("manager_category_scopes")
      .insert({ org_id: orgA, profile_id: mgrA, category_id: catA.data.id });
    ok("manager cannot widen own scope", Boolean(scopeErr),
       scopeErr ? `-> ${scopeErr.message.slice(0, 40)}` : "-> INSERT SUCCEEDED");
  }

  section("Step 6 - privileged functions enforce authorization when signed in");
  {
    const d = await signIn(`htest-drv-a-${stamp}@example.com`, PW);
    const zero = "00000000-0000-0000-0000-000000000000";
    const { error: e1 } = await d.client.rpc("approve_reconciliation", { p_recon_id: zero });
    ok("driver cannot approve a reconciliation",
       Boolean(e1) && /Permission denied/i.test(e1.message),
       e1 ? `-> ${e1.message.slice(0, 46)}` : "-> CALL SUCCEEDED");

    const { error: e2 } = await d.client.rpc("dispatch_van_load", { p_load_id: zero });
    ok("driver cannot dispatch a van load",
       Boolean(e2) && /Permission denied/i.test(e2.message),
       e2 ? `-> ${e2.message.slice(0, 46)}` : "-> CALL SUCCEEDED");
  }

  section("Step 7 - end-to-end business workflow");
  await runWorkflow();

  section("Step 4 - sign out invalidates the session");
  {
    const s = await signIn(`htest-admin-a-${stamp}@example.com`, PW);
    const before = await s.client.from("products").select("sku").limit(1);
    ok("reads work while signed in", !before.error);
    await s.client.auth.signOut();
    const { data: after } = await s.client.from("products").select("sku").limit(1);
    ok("reads return nothing after sign out", (after ?? []).length === 0);
    const { data: sess } = await s.client.auth.getSession();
    ok("local session cleared", !sess?.session);
  }
} catch (error) {
  console.error(`\nRun aborted: ${error.message}`);
  fail++;
} finally {
  if (!KEEP) await cleanup();
}

// ------------------------------------------------------------------ workflow
async function runWorkflow() {
  const wh = (await admin.from("warehouses").insert({
    org_id: orgA, code: `${TEST_PREFIX}WH`, name: "Test depot",
  }).select("id").single()).data;

  const prod = (await admin.from("products").select("id, cost_price, list_price")
    .eq("org_id", orgA).like("sku", `${TEST_PREFIX}%`).limit(1).single()).data;

  const cust = (await admin.from("customers").insert({
    org_id: orgA, code: `${TEST_PREFIX}CUS`, name: "Test customer",
    credit_limit: 100000, payment_terms_days: 30,
  }).select("id").single()).data;

  const van = (await admin.from("vans").insert({
    org_id: orgA, code: `${TEST_PREFIX}VAN`, registration_no: `${TEST_PREFIX}REG`,
    home_warehouse_id: wh.id,
  }).select("id").single()).data;

  await admin.from("van_assignments").insert({
    org_id: orgA, van_id: van.id, driver_id: driverA,
  });

  // Opening stock through the ledger, never by setting a quantity.
  await admin.from("stock_movements").insert({
    org_id: orgA, product_id: prod.id, warehouse_id: wh.id,
    type: "receipt", quantity: 200, reason: "Hosted test opening stock",
  });
  const inv = (await admin.from("inventory").select("qty_on_hand")
    .eq("product_id", prod.id).eq("warehouse_id", wh.id).single()).data;
  ok("warehouse stock derived from ledger", inv?.qty_on_hand === 200, `(${inv?.qty_on_hand})`);

  const load = (await admin.from("van_loads").insert({
    org_id: orgA, van_id: van.id, driver_id: driverA, warehouse_id: wh.id,
    status: "loaded", opening_float: 500,
  }).select("id, load_number").single()).data;

  await admin.from("van_load_items").insert({
    org_id: orgA, load_id: load.id, product_id: prod.id, qty_loaded: 100,
    unit_price: prod.list_price, unit_cost: prod.cost_price,
  });

  // The driver signs for the goods, then the warehouse dispatches.
  const drv = await signIn(`htest-drv-a-${stamp}@example.com`, PW);
  await drv.client.from("van_loads")
    .update({ driver_confirmed_at: new Date().toISOString() }).eq("id", load.id);

  const adm = await signIn(`htest-admin-a-${stamp}@example.com`, PW);
  const { error: dispatchErr } = await adm.client.rpc("dispatch_van_load", { p_load_id: load.id });
  ok("van dispatched through rpc", !dispatchErr,
     dispatchErr ? `-> ${dispatchErr.message.slice(0, 50)}` : `(${load.load_number})`);

  const vanStock = (await admin.from("van_inventory").select("qty_on_hand")
    .eq("van_id", van.id).eq("product_id", prod.id).single()).data;
  ok("stock moved onto the van", vanStock?.qty_on_hand === 100, `(van=${vanStock?.qty_on_hand})`);

  const whAfter = (await admin.from("inventory").select("qty_on_hand")
    .eq("product_id", prod.id).eq("warehouse_id", wh.id).single()).data;
  ok("warehouse reduced by the load", whAfter?.qty_on_hand === 100, `(wh=${whAfter?.qty_on_hand})`);

  // Cash sale, created by the driver.
  const cash = (await drv.client.from("van_sales").insert({
    org_id: orgA, load_id: load.id, van_id: van.id, driver_id: driverA,
    customer_id: cust.id, sale_type: "cash",
  }).select("id, sale_number").single()).data;
  ok("driver created a cash sale", Boolean(cash?.id), cash ? `(${cash.sale_number})` : "");

  if (cash) {
    await drv.client.from("van_sale_items").insert({
      org_id: orgA, sale_id: cash.id, product_id: prod.id,
      quantity: 10, unit_price: prod.list_price, tax_rate: 15,
    });
    const total = (await admin.from("van_sales").select("total").eq("id", cash.id).single()).data;
    const { error: cashErr } = await drv.client.rpc("complete_van_sale", {
      p_sale_id: cash.id, p_amount_paid: total.total,
    });
    ok("cash sale completed", !cashErr, cashErr ? `-> ${cashErr.message.slice(0, 46)}` : "");

    const afterSale = (await admin.from("van_inventory").select("qty_on_hand")
      .eq("van_id", van.id).eq("product_id", prod.id).single()).data;
    ok("van stock reduced by the sale", afterSale?.qty_on_hand === 90, `(van=${afterSale?.qty_on_hand})`);
  }

  // Credit sale and the receivable it creates.
  const credit = (await drv.client.from("van_sales").insert({
    org_id: orgA, load_id: load.id, van_id: van.id, driver_id: driverA,
    customer_id: cust.id, sale_type: "credit",
  }).select("id").single()).data;

  if (credit) {
    await drv.client.from("van_sale_items").insert({
      org_id: orgA, sale_id: credit.id, product_id: prod.id,
      quantity: 5, unit_price: prod.list_price, tax_rate: 15,
    });
    const { error: creditErr } = await drv.client.rpc("complete_van_sale", { p_sale_id: credit.id });
    ok("credit sale completed", !creditErr, creditErr ? `-> ${creditErr.message.slice(0, 46)}` : "");

    const { data: ledger } = await admin.from("credit_transactions")
      .select("type, amount").eq("reference_id", credit.id);
    ok("receivable posted to the credit ledger",
       (ledger ?? []).length === 1 && ledger[0].type === "charge",
       `(${ledger?.[0]?.amount ?? "none"})`);

    const { error: payErr } = await drv.client.rpc("record_credit_payment", {
      p_customer_id: cust.id, p_amount: 100, p_method: "cash", p_notes: "Hosted test collection",
    });
    ok("driver recorded a collection", !payErr, payErr ? `-> ${payErr.message.slice(0, 46)}` : "");

    const { data: pos } = await admin.from("customer_credit_position")
      .select("ledger_balance").eq("customer_id", cust.id).single();
    ok("customer balance reflects sale and payment", Number(pos?.ledger_balance) > 0,
       `(${pos?.ledger_balance})`);
  }

  // Return the remaining stock with a shortage.
  const onVan = (await admin.from("van_inventory").select("qty_on_hand")
    .eq("van_id", van.id).eq("product_id", prod.id).single()).data.qty_on_hand;

  const ret = (await drv.client.from("van_returns").insert({
    org_id: orgA, load_id: load.id, van_id: van.id, driver_id: driverA,
    warehouse_id: wh.id, status: "submitted",
  }).select("id").single()).data;
  ok("driver submitted a return", Boolean(ret?.id));

  if (ret) {
    await admin.from("van_return_items").insert({
      org_id: orgA, return_id: ret.id, product_id: prod.id,
      qty_expected: onVan, qty_returned_good: onVan - 3, qty_damaged: 2,
      damage_reason: "Hosted test damage",
    });

    const { error: retErr } = await adm.client.rpc("approve_van_return", { p_return_id: ret.id });
    ok("manager approved the return", !retErr, retErr ? `-> ${retErr.message.slice(0, 46)}` : "");

    const { data: dmg } = await admin.from("stock_movements")
      .select("type, quantity").eq("reference_id", ret.id).in("type", ["damage", "shortage"]);
    ok("damage and shortage posted to the ledger", (dmg ?? []).length === 2,
       `(${(dmg ?? []).map((m) => `${m.type}:${m.quantity}`).join(", ")})`);
  }

  // Reconcile.
  const { data: recon, error: reconErr } = await adm.client
    .rpc("build_reconciliation", { p_load_id: load.id });
  ok("reconciliation built from the ledger", !reconErr && Boolean(recon),
     reconErr ? `-> ${reconErr.message.slice(0, 46)}` : "");

  const reconRow = Array.isArray(recon) ? recon[0] : recon;
  if (reconRow) {
    const expected = Number(reconRow.expected_cash);
    await admin.from("van_reconciliations").update({
      actual_cash: expected - 50, status: "submitted",
      submitted_at: new Date().toISOString(), explanation: "Hosted test short",
    }).eq("id", reconRow.id);

    const { data: v } = await admin.from("van_reconciliations")
      .select("cash_variance").eq("id", reconRow.id).single();
    ok("cash variance computed", Number(v?.cash_variance) === -50, `(${v?.cash_variance})`);

    // The driver must not be able to sign off their own variance.
    const { error: selfErr } = await drv.client
      .rpc("approve_reconciliation", { p_recon_id: reconRow.id });
    ok("driver cannot approve own reconciliation", Boolean(selfErr),
       selfErr ? `-> ${selfErr.message.slice(0, 46)}` : "-> APPROVED");

    const { error: apprErr } = await adm.client
      .rpc("approve_reconciliation", { p_recon_id: reconRow.id, p_note: "Checked" });
    ok("manager approved the reconciliation", !apprErr,
       apprErr ? `-> ${apprErr.message.slice(0, 46)}` : "");

    const { data: closed } = await admin.from("van_loads")
      .select("status").eq("id", load.id).single();
    ok("load closed as reconciled", closed?.status === "reconciled", `(${closed?.status})`);
  }
}

// ------------------------------------------------------------------- cleanup
async function cleanup() {
  section("Cleanup");
  try {
    for (const id of created.users) await admin.auth.admin.deleteUser(id);
    // Business rows cascade from the organization where the schema allows;
    // the rest are removed explicitly, newest dependency first.
    for (const orgId of created.orgs) {
      for (const t of [
        "van_reconciliations", "van_return_items", "van_returns",
        "van_sale_items", "van_sales", "credit_transactions",
        "van_load_items", "van_loads", "van_assignments", "van_inventory",
        "vans", "stock_movements", "inventory", "manager_category_scopes",
        "products", "categories", "customers", "warehouses", "suppliers",
        "profiles",
      ]) {
        await admin.from(t).delete().eq("org_id", orgId);
      }
      await admin.from("organizations").delete().eq("id", orgId);
    }
    console.log(`  removed ${created.users.length} users and ${created.orgs.length} organizations`);
  } catch (e) {
    console.log(`  cleanup incomplete: ${e.message}`);
    console.log(`  test organizations are prefixed ${TEST_PREFIX} if manual removal is needed`);
  }
}

console.log(`\n${"=".repeat(58)}`);
console.log(`  HOSTED GATE: ${pass} passed, ${fail} failed`);
console.log(`${"=".repeat(58)}`);
process.exit(fail ? 1 : 0);
