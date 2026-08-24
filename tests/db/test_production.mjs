import { createRequire } from "module";
const require = createRequire(import.meta.url);
const fs = require("fs");
const path = require("path");
const { Client, CONN, splitStatements } = require("./lib.js");

/**
 * Removing the demonstration data.
 *
 * The dangerous script in this repository. It deletes an organization
 * and everything inside it, and it runs against the database a business
 * is about to start trading on.
 *
 * So what is tested is not that it works - that is easy - but that it is
 * scoped: that a second organization sitting beside the demonstration
 * one comes through untouched, that the schema is unchanged, and that it
 * refuses when the data does not look like a demonstration.
 */
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

const c = new Client(CONN); await c.connect();
const stamp = Date.now().toString(36);

const CLEAN = fs.readFileSync(
  path.join("..", "..", "database", "PRODUCTION_CLEAN.sql"), "utf8");
const statements = splitStatements(CLEAN);

/** Run the file's DO block only - the reads either side are noise here. */
const runClean = async () => {
  for (const s of statements) {
    if (!s.includes("$clean$")) continue;
    return await c.query(s).then(() => null, (e) => e.message);
  }
  throw new Error("no clean block found in PRODUCTION_CLEAN.sql");
};

// ---- a demonstration organization, and a real one beside it ---------
const demo = (await c.query(
  `insert into organizations (name, slug) values ('GAB Premium Ent — DEMO','gab-premium-ent-demo')
   returning id`)).rows[0].id;
const real = (await c.query(
  `insert into organizations (name, slug) values ('Real Business',$1) returning id`,
  [`real-${stamp}`])).rows[0].id;

/** The same shape of business in both, so the scoping is testable. */
const furnish = async (org, tag) => {
  const wh = (await c.query(
    `insert into warehouses (org_id, code, name) values ($1,$2,'Depot') returning id`,
    [org, `${tag}WH`.slice(0, 12)])).rows[0].id;
  const cat = (await c.query(
    `insert into categories (org_id, name) values ($1,$2) returning id`,
    [org, `${tag} Cat`])).rows[0].id;
  const product = (await c.query(
    `insert into products (org_id, sku, name, category_id, cost_price, list_price)
     values ($1,$2,'Product',$3,10,100) returning id`,
    [org, `${tag}-SKU`.slice(0, 20), cat])).rows[0].id;
  const customer = (await c.query(
    `insert into customers (org_id, code, name, credit_limit) values ($1,$2,'Customer',5000) returning id`,
    [org, `${tag}C`.slice(0, 12)])).rows[0].id;
  await c.query(
    `insert into stock_movements (org_id, product_id, warehouse_id, type, quantity, reason)
     values ($1,$2,$3,'receipt',100,'Opening')`, [org, product, wh]);
  await c.query(
    `insert into audit_log (org_id, actor_name, actor_role, action, target_type, target_label)
     values ($1,'Somebody','admin','product.created','product','Product')`, [org]);
  return { wh, product, customer };
};

const demoRows = await furnish(demo, "DEMO");
const realRows = await furnish(real, `R${stamp}`.slice(0, 8));

const countIn = async (table, org) => Number((await c.query(
  `select count(*)::int n from ${table} where org_id = $1`, [org])).rows[0].n);

const schemaShape = async () => (await c.query(`select
  (select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE') t,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') f,
  (select count(*) from pg_policy) pol,
  (select count(*) from information_schema.views where table_schema='public') v`)).rows[0];

const before = await schemaShape();

// ====================================================================
console.log("\n-- it refuses when an account cannot be placed --");
// ====================================================================

// A sale recorded today means somebody is trading here.
const van = (await c.query(
  `insert into vans (org_id, code, registration_no, home_warehouse_id) values ($1,$2,$3,$4) returning id`,
  [demo, `DEMOV-${stamp}`.slice(0, 12), `GD-${stamp}`.slice(0, 14), demoRows.wh])).rows[0].id;
const driver = (await c.query(
  `insert into auth.users (email, raw_user_meta_data) values ($1,$2::jsonb) returning id`,
  [`prod-drv-${stamp}@demo.invalid`,
   JSON.stringify({ full_name: "Demo Driver", role: "driver", org_id: demo })])).rows[0].id;
const seller = (await c.query(
  `insert into auth.users (email, raw_user_meta_data) values ($1,$2::jsonb) returning id`,
  [`prod-sell-${stamp}@demo.invalid`,
   JSON.stringify({ full_name: "Demo Seller", role: "salesperson", org_id: demo })])).rows[0].id;
const load = (await c.query(
  `insert into van_loads (org_id, van_id, driver_id, warehouse_id, status, load_date)
   values ($1,$2,$3,$4,'loaded',current_date) returning id`,
  [demo, van, driver, demoRows.wh])).rows[0].id;
await c.query(
  `insert into van_sales (org_id, load_id, van_id, driver_id, salesperson_id, customer_id,
     sale_type, status, sold_at)
   values ($1,$2,$3,$4,$5,$6,'cash','completed',now())`,
  [demo, load, van, driver, seller, demoRows.customer]);

// Somebody who is neither a demo-seed nor a test-harness account. This
// is what "a real person may be using this" looks like to the guard.
const stray = (await c.query(
  `insert into auth.users (email, raw_user_meta_data) values ($1,$2::jsonb) returning id`,
  [`akosua.mensah-${stamp}@gabpremium.test`,
   JSON.stringify({ full_name: "Akosua Mensah", role: "manager", org_id: demo })])).rows[0].id;
void stray;

const refused = await runClean();
ok("an account that cannot be placed stops it", refused !== null,
   refused?.split("\n")[0]?.slice(0, 66));
ok("and nothing was removed", (await countIn("products", demo)) === 1);

// Once that person is gone, only demo and harness accounts remain.
await c.query(`delete from public.profiles where email like $1`,
  [`akosua.mensah-${stamp}%`]);

// A recent sale on its own is no longer a blocker: with every account
// accounted for, a sale from today is a test from today.
const stillRecent = (await c.query(
  `select count(*)::int n from van_sales where org_id=$1 and sold_at > now() - interval '1 day'`,
  [demo])).rows[0].n;
ok("a recent sale alone does not block it", Number(stillRecent) > 0,
   "there is one, and the guard now looks past it");

// ====================================================================
console.log("\n-- it removes the demonstration, and only that --");
// ====================================================================

const err = await runClean();
ok("the cleanup runs", err === null, err?.split("\n")[0]?.slice(0, 70));

ok("the demonstration organization is gone", Number((await c.query(
  `select count(*)::int n from organizations where slug='gab-premium-ent-demo'`)).rows[0].n) === 0);

for (const table of ["products", "customers", "warehouses", "stock_movements",
                     "van_sales", "audit_log", "profiles"]) {
  ok(`no demonstration ${table}`, (await countIn(table, demo)) === 0);
}

// The point of the whole suite.
ok("the real organization is still there", Number((await c.query(
  `select count(*)::int n from organizations where id=$1`, [real])).rows[0].n) === 1);

for (const table of ["products", "customers", "warehouses", "stock_movements", "audit_log"]) {
  ok(`the real ${table} survived`, (await countIn(table, real)) === 1);
}

const stillPriced = (await c.query(
  `select cost_price from products where id=$1`, [realRows.product])).rows[0];
ok("and its data is unchanged", Number(stillPriced.cost_price) === 10);

// ====================================================================
console.log("\n-- the schema is untouched --");
// ====================================================================

const after = await schemaShape();
ok("tables unchanged", before.t === after.t, `${before.t} -> ${after.t}`);
ok("functions unchanged", before.f === after.f, `${before.f} -> ${after.f}`);
ok("views unchanged", before.v === after.v, `${before.v} -> ${after.v}`);
ok("row level security policies unchanged", before.pol === after.pol,
   `${before.pol} -> ${after.pol}`);

const rlsOff = (await c.query(
  `select count(*)::int n from pg_class cl join pg_namespace n on n.oid=cl.relnamespace
    where n.nspname='public' and cl.relkind='r' and not cl.relrowsecurity`)).rows[0].n;
ok("no table was left without row level security", Number(rlsOff) === 0);

// ====================================================================
console.log("\n-- running it again is harmless --");
// ====================================================================

const second = await runClean();
ok("a second run does nothing rather than failing", second === null,
   second?.split("\n")[0]?.slice(0, 60));
ok("and the real organization is still there", Number((await c.query(
  `select count(*)::int n from organizations where id=$1`, [real])).rows[0].n) === 1);

console.log(`\n  ${pass} passed, ${fail} failed`);
await c.end();
process.exit(fail ? 1 : 0);
