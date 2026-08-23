import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Client, CONN } = require("./lib.js");

/**
 * Batches and expiry, at the database.
 *
 * The rules being asserted are the ones a wholesaler cannot get wrong:
 * an out-of-date delivery is refused at the door, expired stock does
 * not leave on a van, and what goes out goes out oldest-first. None of
 * them are enforceable in an interface, so none of them are tested
 * through one.
 */
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

const stamp = Date.now().toString(36);
const c = new Client(CONN); await c.connect();
const orgA = (await c.query("select id from organizations where slug='default'")).rows[0].id;
const orgB = (await c.query(
  `insert into organizations (name, slug) values ('Other Co',$1) returning id`,
  [`other-exp-${stamp}`])).rows[0].id;

const mk = async (name, role, org = orgA) => (await c.query(
  `insert into auth.users (email, raw_user_meta_data) values ($1,$2::jsonb) returning id`,
  [`${name}-${stamp}@exp.test`, JSON.stringify({ full_name: name, role, org_id: org })])).rows[0].id;

const as = async (who, sql, params) => {
  await c.query("begin");
  await c.query("select set_config('request.jwt.claims',$1,true)",
    [JSON.stringify({ sub: who, role: "authenticated" })]);
  await c.query("set local role authenticated");
  try { return { ok: true, rows: (await c.query(sql, params)).rows }; }
  catch (e) { return { ok: false, error: e.message }; }
  finally { await c.query("rollback"); }
};

const warehouse = await mk("expwh", "warehouse");
const driver = await mk("expdrv", "driver");
const rival = await mk("exprival", "warehouse", orgB);

// ---- a product that expires, and one that does not -----------------
const wh = (await c.query(
  `insert into warehouses (org_id, code, name) values ($1,$2,'Expiry Depot') returning id`,
  [orgA, `EXPWH-${stamp}`.slice(0, 12)])).rows[0].id;
const cat = (await c.query(
  `insert into categories (org_id, name) values ($1,$2) returning id`,
  [orgA, `Expiry Cat ${stamp}`])).rows[0].id;
const supplier = (await c.query(
  `insert into suppliers (org_id, code, name) values ($1,$2,'Expiry Supplier') returning id`,
  [orgA, `EXPS-${stamp}`.slice(0, 12)])).rows[0].id;

const perishable = (await c.query(
  `insert into products (org_id, sku, name, category_id, unit_of_measure,
     cost_price, list_price, tax_rate, track_batches, track_expiry, shelf_life_days)
   values ($1,$2,'Fresh Milk 1L',$3,'case',10,20,0,true,true,90) returning id`,
  [orgA, `EXP-MILK-${stamp}`.slice(0, 20), cat])).rows[0].id;
const crate = (await c.query(
  `insert into products (org_id, sku, name, category_id, unit_of_measure,
     cost_price, list_price, tax_rate)
   values ($1,$2,'Plastic Crate',$3,'piece',10,20,0) returning id`,
  [orgA, `EXP-CRATE-${stamp}`.slice(0, 20), cat])).rows[0].id;

console.log("=== not everything expires ===");
let r = await c.query(`select track_batches, track_expiry from products where id=$1`, [crate]);
ok("a product tracks nothing by default",
   r.rows[0].track_batches === false && r.rows[0].track_expiry === false);

r = await as(warehouse,
  `insert into products (org_id, sku, name, category_id, unit_of_measure, cost_price, list_price, track_expiry)
   values ($1,$2,'Bad Config',$3,'case',1,2,true) returning id`,
  [orgA, `EXP-BAD-${stamp}`.slice(0, 20), cat]);
ok("expiry cannot be tracked without batches", !r.ok, r.error?.slice(0, 48));

// ---- receiving ------------------------------------------------------
// One order per line: a purchase order allows a product only once, and
// these are separate deliveries anyway.
const line = async (product, qty) => {
  const po = (await c.query(
    `insert into purchase_orders (org_id, supplier_id, warehouse_id, status, order_date)
     values ($1,$2,$3,'submitted',current_date) returning id`, [orgA, supplier, wh])).rows[0].id;
  return (await c.query(
    `insert into purchase_order_items (org_id, po_id, product_id, quantity, unit_cost, tax_rate)
     values ($1,$2,$3,$4,10,0) returning id`, [orgA, po, product, qty])).rows[0].id;
};

const milkLine1 = await line(perishable, 100);
const milkLine2 = await line(perishable, 60);
const milkLine3 = await line(perishable, 40);
const crateLine = await line(crate, 50);

console.log("\n=== receiving a delivery ===");
r = await as(warehouse, `select receive_purchase_batch($1, 50) b`, [milkLine1]);
ok("a batch-tracked line refuses to be received without a batch number",
   !r.ok, r.error?.slice(0, 52));

r = await as(warehouse,
  `select receive_purchase_batch($1, 50, 'B-NOEXP') b`, [milkLine1]);
ok("and refuses without the expiry date", !r.ok, r.error?.slice(0, 52));

r = await as(warehouse,
  `select receive_purchase_batch($1, 50, 'B-OLD', current_date - 1) b`, [milkLine1]);
ok("an already out-of-date delivery is refused at the door",
   !r.ok, r.error?.slice(0, 60));

// Received for real, oldest first so FEFO has something to prove.
await c.query(`select receive_purchase_batch($1, 50, 'B-SOON', current_date + 5)`, [milkLine1]);
await c.query(`select receive_purchase_batch($1, 60, 'B-LATER', current_date + 200)`, [milkLine2]);
ok("a batch is created by receiving",
   Number((await c.query(`select count(*)::int n from product_batches where product_id=$1`, [perishable])).rows[0].n) === 2);

r = await c.query(
  `select qty_received, qty_remaining, expires_on from product_batches
    where product_id=$1 and batch_number='B-SOON'`, [perishable]);
ok("it records what arrived", r.rows[0].qty_received === 50 && r.rows[0].qty_remaining === 50);

const onHand = async (product) => Number((await c.query(
  `select coalesce(qty_on_hand,0) q from inventory where product_id=$1 and warehouse_id=$2`,
  [product, wh])).rows[0]?.q ?? 0);
ok("and the stock actually arrived in the warehouse", (await onHand(perishable)) === 110,
   `${await onHand(perishable)} units`);

console.log("\n=== a product that does not expire is unaffected ===");
await c.query(`select receive_purchase_batch($1, 50)`, [crateLine]);
ok("it receives with no batch at all", (await onHand(crate)) === 50, `${await onHand(crate)} units`);
ok("and creates no batch record",
   Number((await c.query(`select count(*)::int n from product_batches where product_id=$1`, [crate])).rows[0].n) === 0);

console.log("\n=== the same batch delivered twice adds up ===");
await c.query(`select receive_purchase_batch($1, 40, 'B-SOON', current_date + 5)`, [milkLine3]);
r = await c.query(
  `select qty_received, qty_remaining from product_batches
    where product_id=$1 and batch_number='B-SOON'`, [perishable]);
ok("it is one batch, not two", r.rows[0].qty_received === 90, `${r.rows[0].qty_received} received`);

console.log("\n=== how long each batch has left ===");
r = await c.query(
  `select batch_number, status, days_to_expiry from batch_expiry_status
    where product_id=$1 order by expires_on`, [perishable]);
const byBatch = Object.fromEntries(r.rows.map((x) => [x.batch_number, x]));
ok("a batch inside the warning period reads as expiring",
   byBatch["B-SOON"].status === "expiring", `${byBatch["B-SOON"].days_to_expiry} days`);
ok("one well beyond it reads as good",
   byBatch["B-LATER"].status === "good", `${byBatch["B-LATER"].days_to_expiry} days`);

await c.query(`update organizations set expiry_warning_days = 7 where id=$1`, [orgA]);
r = await c.query(
  `select status from batch_expiry_status where product_id=$1 and batch_number='B-LATER'`, [perishable]);
ok("the warning period is the organization's own setting", r.rows[0].status === "good");
await c.query(`update organizations set expiry_warning_days = 365 where id=$1`, [orgA]);
r = await c.query(
  `select status from batch_expiry_status where product_id=$1 and batch_number='B-LATER'`, [perishable]);
ok("widening it brings more stock into view", r.rows[0].status === "expiring");
await c.query(`update organizations set expiry_warning_days = 30 where id=$1`, [orgA]);

console.log("\n=== first expire, first out ===");
const van = (await c.query(
  `insert into vans (org_id, code, registration_no, home_warehouse_id)
   values ($1,$2,$3,$4) returning id`,
  [orgA, `EXPV-${stamp}`.slice(0, 12), `GT-${stamp}`.slice(0, 14), wh])).rows[0].id;
// A van needs a driver and somebody crewed to sell before it can be
// dispatched at all.
const expSeller = await mk("expsell", "salesperson");
await c.query(
  `insert into van_assignments (org_id, van_id, member_id, crew_role) values ($1,$2,$3,'driver')`,
  [orgA, van, driver]);
await c.query(
  `insert into van_assignments (org_id, van_id, member_id, crew_role) values ($1,$2,$3,'salesperson')`,
  [orgA, van, expSeller]);

const load = (await c.query(
  `insert into van_loads (org_id, van_id, driver_id, warehouse_id, status, load_date,
     driver_confirmed_at, opening_float)
   values ($1,$2,$3,$4,'loaded',current_date, now(), 0) returning id, load_number`,
  [orgA, van, driver, wh])).rows[0];
await c.query(
  `insert into van_load_items (org_id, load_id, product_id, qty_loaded, unit_price, unit_cost)
   values ($1,$2,$3,100,20,10)`, [orgA, load.id, perishable]);

await c.query(`select dispatch_van_load($1)`, [load.id]);

r = await c.query(
  `select batch_number, qty_remaining from product_batches
    where product_id=$1 order by expires_on`, [perishable]);
const after = Object.fromEntries(r.rows.map((x) => [x.batch_number, x.qty_remaining]));
ok("the batch expiring soonest is emptied first", after["B-SOON"] === 0, `B-SOON: ${after["B-SOON"]}`);
ok("and the rest comes from the later one", after["B-LATER"] === 50, `B-LATER: ${after["B-LATER"]}`);

console.log("\n=== expired stock does not leave the yard ===");
const expLine = await line(perishable, 30);
await c.query(`select receive_purchase_batch($1, 30, 'B-WILLEXPIRE', current_date + 1)`, [expLine]);
// Walk it past its date, as a day would.
await c.query(
  `update product_batches set expires_on = current_date - 2 where batch_number='B-WILLEXPIRE'`);

// A second van: one van may hold only one open load, and the first is
// out on the road.
const van2 = (await c.query(
  `insert into vans (org_id, code, registration_no, home_warehouse_id)
   values ($1,$2,$3,$4) returning id`,
  [orgA, `EXPV2-${stamp}`.slice(0, 12), `GT2-${stamp}`.slice(0, 14), wh])).rows[0].id;

const expDriver2 = await mk("expdrv2", "driver");
const expSeller2 = await mk("expsell2", "salesperson");
await c.query(
  `insert into van_assignments (org_id, van_id, member_id, crew_role) values ($1,$2,$3,'driver')`,
  [orgA, van2, expDriver2]);
await c.query(
  `insert into van_assignments (org_id, van_id, member_id, crew_role) values ($1,$2,$3,'salesperson')`,
  [orgA, van2, expSeller2]);

const load2 = (await c.query(
  `insert into van_loads (org_id, van_id, driver_id, warehouse_id, status, load_date,
     driver_confirmed_at, opening_float)
   values ($1,$2,$3,$4,'loaded',current_date, now(), 0) returning id, load_number`,
  [orgA, van2, expDriver2, wh])).rows[0];
await c.query(
  `insert into van_load_items (org_id, load_id, product_id, qty_loaded, unit_price, unit_cost)
   values ($1,$2,$3,10,20,10)`, [orgA, load2.id, perishable]);

const stockBefore = await onHand(perishable);
try {
  await c.query(`select dispatch_van_load($1)`, [load2.id]);
  ok("dispatch is refused while an expired batch is in the warehouse", false, "it went out");
} catch (e) {
  ok("dispatch is refused while an expired batch is in the warehouse", true,
     e.message.slice(0, 58));
}
ok("and no stock moved on the refused dispatch", (await onHand(perishable)) === stockBefore,
   `${stockBefore} -> ${await onHand(perishable)}`);
ok("the load is still loaded, not half dispatched",
   (await c.query(`select status from van_loads where id=$1`, [load2.id])).rows[0].status === "loaded");

// Clear the expired batch, as a warehouse would write it off.
await c.query(`update product_batches set qty_remaining = 0 where batch_number='B-WILLEXPIRE'`);
try {
  await c.query(`select dispatch_van_load($1)`, [load2.id]);
  ok("once it is written off the load goes out", true);
} catch (e) {
  ok("once it is written off the load goes out", false, e.message.slice(0, 50));
}

console.log("\n=== a product with no expiry is never blocked ===");
const van3 = (await c.query(
  `insert into vans (org_id, code, registration_no, home_warehouse_id)
   values ($1,$2,$3,$4) returning id`,
  [orgA, `EXPV3-${stamp}`.slice(0, 12), `GT3-${stamp}`.slice(0, 14), wh])).rows[0].id;
const expDriver3 = await mk("expdrv3", "driver");
const expSeller3 = await mk("expsell3", "salesperson");
await c.query(
  `insert into van_assignments (org_id, van_id, member_id, crew_role) values ($1,$2,$3,'driver')`,
  [orgA, van3, expDriver3]);
await c.query(
  `insert into van_assignments (org_id, van_id, member_id, crew_role) values ($1,$2,$3,'salesperson')`,
  [orgA, van3, expSeller3]);

const crateLoad = (await c.query(
  `insert into van_loads (org_id, van_id, driver_id, warehouse_id, status, load_date,
     driver_confirmed_at, opening_float)
   values ($1,$2,$3,$4,'loaded',current_date, now(), 0) returning id`,
  [orgA, van3, expDriver3, wh])).rows[0].id;
await c.query(
  `insert into van_load_items (org_id, load_id, product_id, qty_loaded, unit_price, unit_cost)
   values ($1,$2,$3,10,20,10)`, [orgA, crateLoad, crate]);
try {
  await c.query(`select dispatch_van_load($1)`, [crateLoad]);
  ok("a crate dispatches with no batch anywhere", true);
} catch (e) {
  ok("a crate dispatches with no batch anywhere", false, e.message.slice(0, 50));
}

console.log("\n=== who may see and change a batch ===");
r = await as(driver, `select batch_number, expires_on from product_batches where product_id=$1`, [perishable]);
ok("a driver can see what is about to go off", r.ok && r.rows.length > 0,
   r.ok ? `${r.rows.length} batches` : r.error?.slice(0, 40));

// Row level security filters an UPDATE rather than raising, so the
// assertion is that nothing changed - not merely that nothing errored.
const datesBefore = (await c.query(
  `select id, expires_on from product_batches where product_id=$1 order by id`, [perishable])).rows;
r = await as(driver,
  `update product_batches set expires_on = current_date + 999 where product_id=$1 returning id`, [perishable]);
const datesAfter = (await c.query(
  `select id, expires_on from product_batches where product_id=$1 order by id`, [perishable])).rows;
ok("a driver cannot move an expiry date",
   (!r.ok || r.rows.length === 0) &&
   JSON.stringify(datesBefore) === JSON.stringify(datesAfter),
   r.ok ? `${r.rows.length} rows touched, dates unchanged` : r.error?.slice(0, 40));

r = await as(rival, `select batch_number from product_batches where product_id=$1`, [perishable]);
ok("another organization sees no batches at all", r.ok && r.rows.length === 0,
   r.ok ? `${r.rows.length} rows` : r.error?.slice(0, 40));

r = await as(driver, `select receive_purchase_batch($1, 5, 'B-DRIVER', current_date + 90) b`, [milkLine1]);
ok("a driver cannot book goods in", !r.ok, r.error?.slice(0, 46));

console.log("\n=== the office summary ===");
r = await c.query(`select * from expiry_summary where org_id=$1`, [orgA]);
ok("the dashboard summary reports on this organization", r.rows.length === 1);
ok("and counts batches still holding stock", Number(r.rows[0].good_batches ?? 0) >= 1,
   JSON.stringify(r.rows[0]));

console.log(`\n  ${pass} passed, ${fail} failed`);
await c.end();
process.exit(fail ? 1 : 0);
