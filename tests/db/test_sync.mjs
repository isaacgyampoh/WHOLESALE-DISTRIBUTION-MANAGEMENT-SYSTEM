import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Client, CONN } = require("./lib.js");

/**
 * Offline synchronisation, at the database.
 *
 * The claim being tested is the one the whole PWA rests on: a driver
 * can queue work with no signal, the queue can be uploaded twice, and
 * the business is left with exactly one of everything.
 */
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

const c = new Client(CONN); await c.connect();
const orgA = (await c.query("select id from organizations where slug='default'")).rows[0].id;
const orgB = (await c.query(
  `insert into organizations (name, slug) values ('Other Co','other-sync') returning id`)).rows[0].id;

const mk = async (name, role, org = orgA) => (await c.query(
  `insert into auth.users (email, raw_user_meta_data) values ($1,$2::jsonb) returning id`,
  [`${name}@sync.test`, JSON.stringify({ full_name: name, role, org_id: org })])).rows[0].id;

/** Run as a signed-in user over the Data API, in a transaction we keep. */
const as = async (id, sql, params) => {
  await c.query("begin");
  await c.query(`select set_config('request.jwt.claims',$1,true)`,
    [JSON.stringify({ sub: id, role: "authenticated" })]);
  await c.query("set local role authenticated");
  try { return { ok: true, rows: (await c.query(sql, params)).rows }; }
  catch (e) { return { ok: false, error: e.message }; }
  finally { await c.query("commit"); }
};

const driver = await mk("syncdriver", "driver");
const other = await mk("syncother", "driver");
const rival = await mk("syncrival", "driver", orgB);

// ---- a van with a dispatched load, which is what a driver sells from
const wh = (await c.query(
  `insert into warehouses (org_id, code, name) values ($1,'SYNCWH','Sync Depot') returning id`,
  [orgA])).rows[0].id;
const cat = (await c.query(
  `insert into categories (org_id, name) values ($1,'Sync Cat') returning id`, [orgA])).rows[0].id;
const product = (await c.query(
  `insert into products (org_id, sku, name, category_id, unit_of_measure, cost_price, list_price, tax_rate)
   values ($1,'SYNC-1','Sync Product',$2,'case',10,20,0) returning id`, [orgA, cat])).rows[0].id;
const customer = (await c.query(
  `insert into customers (org_id, code, name, credit_limit) values ($1,'SYNCC','Sync Customer',100000) returning id`,
  [orgA])).rows[0].id;
const van = (await c.query(
  `insert into vans (org_id, code, registration_no, home_warehouse_id)
   values ($1,'SYNCVAN','GT-SYNC',$2) returning id`, [orgA, wh])).rows[0].id;
await c.query(
  `insert into van_assignments (org_id, van_id, member_id, crew_role) values ($1,$2,$3,'driver')`,
  [orgA, van, driver]);
// The person who syncs is a salesperson: a driver cannot record a sale,
// offline or otherwise.
const syncSeller = await mk("syncsell", "salesperson");
await c.query(
  `insert into van_assignments (org_id, van_id, member_id, crew_role) values ($1,$2,$3,'salesperson')`,
  [orgA, van, syncSeller]);

// Stock into the warehouse through the ledger, then onto the van.
await c.query(
  `insert into stock_movements (org_id, product_id, warehouse_id, type, quantity, reason)
   values ($1,$2,$3,'receipt',500,'Opening')`, [orgA, product, wh]);

const load = (await c.query(
  `insert into van_loads (org_id, van_id, driver_id, warehouse_id, status, load_date, driver_confirmed_at, opening_float)
   values ($1,$2,$3,$4,'loaded',current_date, now(), 100) returning id, load_number`,
  [orgA, van, driver, wh])).rows[0];
await c.query(
  `insert into van_load_items (org_id, load_id, product_id, qty_loaded, unit_price, unit_cost)
   values ($1,$2,$3,200,20,10)`, [orgA, load.id, product]);
await c.query(`select dispatch_van_load($1)`, [load.id]);

const onVan = async () => Number((await c.query(
  `select coalesce(qty_on_hand,0) q from van_inventory where van_id=$1 and product_id=$2`,
  [van, product])).rows[0]?.q ?? 0);

ok("the van is carrying its load", (await onVan()) === 200, `${await onVan()} units`);

// ------------------------------------------------------------------
console.log("\n=== a queued sale applies once ===");
const key1 = (await c.query("select gen_random_uuid() id")).rows[0].id;
const salePayload = JSON.stringify({
  load_id: load.id, customer_id: customer, sale_type: "cash",
  amount_paid: null,
  lines: [{ product_id: product, quantity: 5, unit_price: 20, tax_rate: 0 }],
});

let r = await as(driver,
  `select sync_submit($1,'device-A','van_sale',$2::jsonb, now()) result`, [key1, salePayload]);
ok("a driver may submit their own queued sale", r.ok, r.error ?? "");
const first = r.ok ? r.rows[0].result : {};
ok("it is applied", first.status === "applied", JSON.stringify(first).slice(0, 80));
ok("the van is 5 lighter", (await onVan()) === 195, `${await onVan()} units`);

// ------------------------------------------------------------------
console.log("\n=== the same key again changes nothing ===");
r = await as(driver,
  `select sync_submit($1,'device-A','van_sale',$2::jsonb, now()) result`, [key1, salePayload]);
const replay = r.ok ? r.rows[0].result : {};
ok("the retry is reported as a replay", replay.replayed === true, JSON.stringify(replay).slice(0, 60));
ok("it returns the original outcome",
   replay.result?.sale_number === first.result?.sale_number,
   `${replay.result?.sale_number} vs ${first.result?.sale_number}`);
ok("no second sale was written",
   Number((await c.query(`select count(*)::int n from van_sales where load_id=$1`, [load.id])).rows[0].n) === 1);
ok("the van is still 5 lighter, not 10", (await onVan()) === 195, `${await onVan()} units`);

// ------------------------------------------------------------------
console.log("\n=== twenty queued operations, uploaded twice ===");
const keys = [];
for (let i = 0; i < 20; i++) {
  const k = (await c.query("select gen_random_uuid() id")).rows[0].id;
  keys.push(k);
  await as(driver, `select sync_submit($1,'device-A','van_sale',$2::jsonb, now()) result`,
    [k, JSON.stringify({
      load_id: load.id, customer_id: customer, sale_type: "cash",
      lines: [{ product_id: product, quantity: 1, unit_price: 20, tax_rate: 0 }],
    })]);
}
const afterFirstUpload = await onVan();
ok("all twenty applied", afterFirstUpload === 175, `${afterFirstUpload} units (expected 175)`);

// The whole queue is replayed, exactly as a retry after a dropped
// connection would.
for (const k of keys) {
  await as(driver, `select sync_submit($1,'device-A','van_sale',$2::jsonb, now()) result`,
    [k, JSON.stringify({
      load_id: load.id, customer_id: customer, sale_type: "cash",
      lines: [{ product_id: product, quantity: 1, unit_price: 20, tax_rate: 0 }],
    })]);
}
ok("replaying all twenty changes no stock", (await onVan()) === afterFirstUpload,
   `${await onVan()} units`);
ok("there are 21 sales, not 41",
   Number((await c.query(`select count(*)::int n from van_sales where load_id=$1`, [load.id])).rows[0].n) === 21);

// ------------------------------------------------------------------
console.log("\n=== conflicts are recorded, not applied ===");
const overKey = (await c.query("select gen_random_uuid() id")).rows[0].id;
r = await as(driver, `select sync_submit($1,'device-A','van_sale',$2::jsonb, now()) result`,
  [overKey, JSON.stringify({
    load_id: load.id, customer_id: customer, sale_type: "cash",
    lines: [{ product_id: product, quantity: 9999, unit_price: 20, tax_rate: 0 }],
  })]);
const conflict = r.ok ? r.rows[0].result : {};
ok("selling more than the van holds is a conflict", conflict.status === "conflict",
   String(conflict.error).slice(0, 50));
ok("and no stock moved", (await onVan()) === afterFirstUpload, `${await onVan()} units`);
ok("the conflict is kept for the driver to see",
   Number((await c.query(`select count(*)::int n from sync_operations where status='conflict'`)).rows[0].n) >= 1);

// ------------------------------------------------------------------
console.log("\n=== the queue is not a way around authorization ===");
r = await as(other, `select sync_submit($1,'device-B','van_sale',$2::jsonb, now()) result`,
  [key1, salePayload]);
ok("another driver cannot replay someone else's key", !r.ok, r.error?.slice(0, 46));

r = await as(rival, `select sync_submit($1,'device-C','van_sale',$2::jsonb, now()) result`,
  [(await c.query("select gen_random_uuid() id")).rows[0].id, salePayload]);
const cross = r.ok ? r.rows[0].result : {};
ok("a driver in another organization cannot sell from this load",
   !r.ok || cross.status !== "applied", r.error ?? String(cross.error).slice(0, 44));

// An inactive account must not be able to drain a queue after being
// switched off mid-round.
await c.query(`update profiles set is_active=false where id=$1`, [other]);
r = await as(other, `select sync_submit($1,'device-B','collection',$2::jsonb, now()) result`,
  [(await c.query("select gen_random_uuid() id")).rows[0].id,
   JSON.stringify({ customer_id: customer, amount: 10, method: "cash" })]);
ok("a deactivated driver's queue is refused", !r.ok, r.error?.slice(0, 46));
await c.query(`update profiles set is_active=true where id=$1`, [other]);

// ------------------------------------------------------------------
console.log("\n=== collections queued offline ===");
const collKey = (await c.query("select gen_random_uuid() id")).rows[0].id;
const before = Number((await c.query(
  `select coalesce(sum(amount),0) s from credit_transactions where customer_id=$1`, [customer])).rows[0].s);
await as(driver, `select sync_submit($1,'device-A','collection',$2::jsonb, now()) result`,
  [collKey, JSON.stringify({ customer_id: customer, amount: 250, method: "mobile_money", notes: "Roadside" })]);
const afterColl = Number((await c.query(
  `select coalesce(sum(amount),0) s from credit_transactions where customer_id=$1`, [customer])).rows[0].s);
ok("a collection reduces the balance by its amount", Math.abs((before - afterColl) - 250) < 0.01,
   `${before} -> ${afterColl}`);

await as(driver, `select sync_submit($1,'device-A','collection',$2::jsonb, now()) result`,
  [collKey, JSON.stringify({ customer_id: customer, amount: 250, method: "mobile_money", notes: "Roadside" })]);
const afterReplay = Number((await c.query(
  `select coalesce(sum(amount),0) s from credit_transactions where customer_id=$1`, [customer])).rows[0].s);
ok("replaying it does not take the money twice", afterReplay === afterColl, `${afterReplay}`);

// ------------------------------------------------------------------
console.log("\n=== the queue holds no credentials ===");
const stored = (await c.query(`select payload::text p from sync_operations`)).rows.map((x) => x.p).join(" ");
ok("no PIN in any payload", !/\bpin\b/i.test(stored));
ok("no hash in any payload", !/hash|pepper|secret|token|service_role/i.test(stored));

// ------------------------------------------------------------------
console.log("\n=== sync history cannot be rewritten ===");
r = await as(driver, `update sync_operations set status='applied' where id=$1 returning id`, [overKey]);
ok("a driver cannot flip a conflict to applied", !r.ok, r.error?.slice(0, 46));
r = await as(driver, `delete from sync_operations where id=$1 returning id`, [overKey]);
ok("a driver cannot delete their failures", !r.ok, r.error?.slice(0, 46));

// ------------------------------------------------------------------
console.log("\n=== what a device caches ===");
r = await as(driver, `select sync_bootstrap() b`);
const boot = r.ok ? r.rows[0].b : {};
ok("the driver's van is included", boot.van?.code === "SYNCVAN", boot.van?.code);
ok("the open load is included", boot.load?.load_number === load.load_number, boot.load?.load_number);
ok("van stock is included", Array.isArray(boot.stock) && boot.stock.length > 0,
   `${boot.stock?.length} line(s)`);
ok("active customers are included", Array.isArray(boot.customers) && boot.customers.length > 0,
   `${boot.customers?.length}`);
ok("the snapshot carries no cost price", !JSON.stringify(boot).includes('"cost_price"'));
ok("the snapshot carries no credential", !/pin|hash|token|secret/i.test(JSON.stringify(boot)));

r = await as(rival, `select sync_bootstrap() b`);
const rivalBoot = r.ok ? r.rows[0].b : {};
ok("another organization's driver sees none of this van",
   !rivalBoot.van, JSON.stringify(rivalBoot.van ?? null));

console.log(`\n  ${pass} passed, ${fail} failed`);
await c.end();
process.exit(fail ? 1 : 0);
