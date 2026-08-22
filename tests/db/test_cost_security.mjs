import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Client, CONN } = require("./lib.js");

/**
 * Cost is management information.
 *
 * A driver could read what the business pays for its goods - straight
 * from the Data API, with nothing more than the anon key and their own
 * session - and the products screen rendered a Cost column to them.
 * Margin is the most commercially sensitive number a distributor has,
 * and a driver spends the day in front of the customers it is earned
 * from.
 *
 * Migration 0023 closed it. These assertions are what stop it opening
 * again: the first attempt at that migration used a column-level
 * REVOKE, which does not override a table-level GRANT, and looked
 * exactly like a fix while changing nothing.
 */
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

const c = new Client(CONN); await c.connect();
const org = (await c.query("select id from organizations where slug='default'")).rows[0].id;
// Stamped, so the suite can be run on its own against a database a
// previous run already touched.
const stamp = Date.now().toString(36);
const mk = async (name, role) => (await c.query(
  `insert into auth.users (email, raw_user_meta_data) values ($1,$2::jsonb) returning id`,
  [`${name}-${stamp}@cost.test`, JSON.stringify({ full_name: name, role, org_id: org })])).rows[0].id;

const driver = await mk("cadrv", "driver");
const rep = await mk("carep", "sales_rep");
const manager = await mk("camgr", "manager");
const admin = await mk("caadm", "admin");

// A manager is category-scoped; without a scope they see no products and
// an empty result would read as "masked" when it is really "no rows".
const cat = (await c.query(
  `select category_id from products where category_id is not null limit 1`)).rows[0]?.category_id;
if (cat) {
  await c.query(
    `insert into manager_category_scopes (org_id, profile_id, category_id) values ($1,$2,$3)
       on conflict do nothing`, [org, manager, cat]);
}

const as = async (who, sql) => {
  await c.query("begin");
  await c.query("select set_config('request.jwt.claims', $1, true)",
    [JSON.stringify({ sub: who, role: "authenticated" })]);
  await c.query("set local role authenticated");
  try { const r = await c.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, error: e.message }; }
  finally { await c.query("rollback"); }
};

// Seed one row in each procurement table so "no rows" cannot be
// mistaken for "refused" - row level security filters, it does not error.
const wh = (await c.query(`select id from warehouses limit 1`)).rows[0]?.id;
const sup = (await c.query(
  `insert into suppliers (org_id, code, name) values ($1,$2,'Cost Audit Supplier')
     on conflict do nothing returning id`, [org, `CA-${stamp}`.slice(0, 12)])).rows[0]?.id
  ?? (await c.query(`select id from suppliers where org_id=$1 limit 1`, [org])).rows[0]?.id;
if (sup && wh) {
  await c.query(
    `insert into purchase_orders (org_id, supplier_id, warehouse_id, status, order_date)
     values ($1,$2,$3,'draft',current_date) on conflict do nothing`, [org, sup, wh]);
}

const probes = [
  ["products.cost_price (raw column)", "select cost_price from products limit 1"],
  ["van_load_items.unit_cost",         "select unit_cost from van_load_items limit 1"],
  ["purchase_order_items.unit_cost",   "select unit_cost from purchase_order_items limit 1"],
];

console.log("=== the raw cost columns have no readers ===");
for (const [name, sql] of probes) {
  for (const [label, who] of [["driver", driver], ["sales_rep", rep], ["manager", manager], ["admin", admin]]) {
    const r = await as(who, sql);
    ok(`${label} cannot read ${name}`, !r.ok, r.ok ? "IT WAS READABLE" : "");
  }
}

console.log("\n=== procurement is not a sales role's business ===");
// Row level security filters rather than errors, so a count of zero is
// the assertion. "No error" would pass against an empty table.
for (const [name, sql] of [
  ["suppliers",       "select id from suppliers"],
  ["purchase_orders", "select id from purchase_orders"],
]) {
  const seeded = (await c.query(sql.replace("select id", "select count(*)::int n"))).rows[0].n;
  ok(`${name}: the test has rows to hide`, seeded > 0, `${seeded}`);
  for (const [label, who] of [["driver", driver], ["sales_rep", rep]]) {
    const r = await as(who, sql);
    ok(`${label} sees no ${name}`, r.ok && r.rows.length === 0,
       r.ok ? `${r.rows.length} rows` : r.error?.slice(0, 40));
  }
  for (const [label, who] of [["manager", manager], ["admin", admin]]) {
    const r = await as(who, sql);
    ok(`${label} still sees ${name}`, r.ok && r.rows.length > 0,
       r.ok ? `${r.rows.length} rows` : r.error?.slice(0, 40));
  }
}

console.log("\n=== the one door answers according to who knocks ===");
const masked = [
  ["products_priced.cost_price",  "select cost_price from products_priced where cost_price is not null"],
  ["stock_summary.cost_price",    "select cost_price from stock_summary where cost_price is not null"],
  ["stock_summary.stock_value",   "select stock_value from stock_summary where stock_value is not null"],
  ["van_stock_summary.cost_price","select cost_price from van_stock_summary where cost_price is not null"],
];
for (const [name, sql] of masked) {
  for (const [label, who] of [["driver", driver], ["sales_rep", rep]]) {
    const r = await as(who, sql);
    ok(`${label} gets null from ${name}`, r.ok && r.rows.length === 0,
       r.ok ? `${r.rows.length} rows` : r.error?.slice(0, 40));
  }
  for (const [label, who] of [["manager", manager], ["admin", admin]]) {
    const r = await as(who, sql);
    ok(`${label} still gets a figure from ${name}`, r.ok, r.error?.slice(0, 40));
  }
}

// The function itself, called directly, must answer the same way.
const anyProduct = (await c.query(`select id from products limit 1`)).rows[0]?.id;
for (const [label, who, expectNull] of [
  ["driver", driver, true], ["sales_rep", rep, true],
  ["manager", manager, false], ["admin", admin, false],
]) {
  const r = await as(who, `select public.product_cost('${anyProduct}') as cost`);
  const value = r.ok ? r.rows[0].cost : undefined;
  ok(`product_cost() returns ${expectNull ? "null" : "a figure"} to a ${label}`,
     r.ok && (expectNull ? value === null : value !== null), String(value));
}

console.log("\n=== the offline snapshot a phone carries holds no cost ===");
const boot = await as(driver, `select public.sync_bootstrap() b`);
ok("sync_bootstrap succeeds for a driver", boot.ok, boot.error?.slice(0, 50));
if (boot.ok) {
  const text = JSON.stringify(boot.rows[0].b);
  ok("no cost_price in the snapshot", !/cost_price/i.test(text));
  ok("no stock_value in the snapshot", !/stock_value/i.test(text));
  ok("no unit_cost in the snapshot", !/unit_cost/i.test(text));
}

console.log("\n=== a driver still has everything they need to sell ===");
for (const [name, sql] of [
  ["the product name and selling price", "select name, list_price from products limit 1"],
  ["what is on a van, by quantity",      "select product_name, qty_on_hand from van_stock_summary limit 1"],
  ["what a load was priced at",          "select qty_loaded, unit_price from van_load_items limit 1"],
]) {
  const r = await as(driver, sql);
  ok(`a driver can read ${name}`, r.ok, r.ok ? "" : r.error?.slice(0, 45));
}

console.log(`\n  ${pass} passed, ${fail} failed`);
await c.end();
process.exit(fail ? 1 : 0);
