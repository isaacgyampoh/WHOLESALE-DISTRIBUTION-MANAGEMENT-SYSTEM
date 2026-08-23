import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Client, CONN } = require("./lib.js");

/**
 * How a sale was paid for.
 *
 * The rules here are the ones that decide whether a driver is short at
 * the end of the day. Mobile money never reaches the cash tin, so
 * counting it as cash makes an honest driver look light by exactly what
 * they took electronically. Everything below is about keeping the two
 * apart, and about refusing a payment that does not add up.
 */
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

const stamp = Date.now().toString(36);
const c = new Client(CONN); await c.connect();
const orgA = (await c.query("select id from organizations where slug='default'")).rows[0].id;

const mk = async (name, role) => (await c.query(
  `insert into auth.users (email, raw_user_meta_data) values ($1,$2::jsonb) returning id`,
  [`${name}-${stamp}@pay.test`, JSON.stringify({ full_name: name, role, org_id: orgA })])).rows[0].id;

const as = async (who, sql, params) => {
  await c.query("begin");
  await c.query("select set_config('request.jwt.claims',$1,true)",
    [JSON.stringify({ sub: who, role: "authenticated" })]);
  await c.query("set local role authenticated");
  try { return { ok: true, rows: (await c.query(sql, params)).rows }; }
  catch (e) { return { ok: false, error: e.message }; }
  finally { await c.query("rollback"); }
};

// The driver drives; the salesperson sells. Both are needed: a van
// with nobody crewed to sell cannot be dispatched.
const driver = await mk("paydrv", "driver");
const seller = await mk("paysell", "salesperson");

// ---- a van with a dispatched load ----------------------------------
const wh = (await c.query(
  `insert into warehouses (org_id, code, name) values ($1,$2,'Pay Depot') returning id`,
  [orgA, `PAYWH-${stamp}`.slice(0, 12)])).rows[0].id;
const cat = (await c.query(
  `insert into categories (org_id, name) values ($1,$2) returning id`,
  [orgA, `Pay Cat ${stamp}`])).rows[0].id;
const product = (await c.query(
  `insert into products (org_id, sku, name, category_id, unit_of_measure, cost_price, list_price, tax_rate)
   values ($1,$2,'Pay Product',$3,'case',10,100,0) returning id`,
  [orgA, `PAY-${stamp}`.slice(0, 20), cat])).rows[0].id;
const customer = (await c.query(
  `insert into customers (org_id, code, name, credit_limit) values ($1,$2,'Pay Customer',100000) returning id`,
  [orgA, `PAYC-${stamp}`.slice(0, 12)])).rows[0].id;
const van = (await c.query(
  `insert into vans (org_id, code, registration_no, home_warehouse_id) values ($1,$2,$3,$4) returning id`,
  [orgA, `PAYV-${stamp}`.slice(0, 12), `GT-${stamp}`.slice(0, 14), wh])).rows[0].id;
await c.query(
  `insert into van_assignments (org_id, van_id, member_id, crew_role) values ($1,$2,$3,'driver')`,
  [orgA, van, driver]);
await c.query(
  `insert into van_assignments (org_id, van_id, member_id, crew_role) values ($1,$2,$3,'salesperson')`,
  [orgA, van, seller]);

await c.query(
  `insert into stock_movements (org_id, product_id, warehouse_id, type, quantity, reason)
   values ($1,$2,$3,'receipt',500,'Opening')`, [orgA, product, wh]);

const load = (await c.query(
  `insert into van_loads (org_id, van_id, driver_id, warehouse_id, status, load_date,
     driver_confirmed_at, opening_float)
   values ($1,$2,$3,$4,'loaded',current_date, now(), 200) returning id, load_number`,
  [orgA, van, driver, wh])).rows[0];
await c.query(
  `insert into van_load_items (org_id, load_id, product_id, qty_loaded, unit_price, unit_cost)
   values ($1,$2,$3,200,100,10)`, [orgA, load.id, product]);
await c.query(`select dispatch_van_load($1)`, [load.id]);

/** A draft sale of `qty` at 100 each. */
const draftSale = async (qty, saleType = "cash") => {
  const sale = (await c.query(
    `insert into van_sales (org_id, load_id, van_id, driver_id, salesperson_id, customer_id,
       sale_type, status, sold_at)
     values ($1,$2,$3,$4,$5,$6,$7,'draft',now()) returning id, total`,
    [orgA, load.id, van, driver, seller, customer, saleType])).rows[0];
  await c.query(
    `insert into van_sale_items (org_id, sale_id, product_id, quantity, unit_price, tax_rate)
     values ($1,$2,$3,$4,100,0)`, [orgA, sale.id, product, qty]);
  return (await c.query(`select id, total from van_sales where id=$1`, [sale.id])).rows[0];
};

console.log("=== a sale paid entirely in cash ===");
let sale = await draftSale(2);          // 200
let r = await as(driver,
  `select record_sale_payments($1, $2::jsonb) t`,
  [sale.id, JSON.stringify([{ method: "cash", amount: 200 }])]);
ok("a driver can record how a sale was paid", r.ok, r.error?.slice(0, 50));
ok("and it returns what was taken", r.ok && Number(r.rows[0].t) === 200, r.ok ? r.rows[0].t : "");

console.log("\n=== split between cash and mobile money ===");
sale = await draftSale(5);              // 500
await c.query(`select record_sale_payments($1, $2::jsonb)`,
  [sale.id, JSON.stringify([
    { method: "cash", amount: 200 },
    { method: "mobile_money", amount: 300, reference: "MM-88213" },
  ])]);
r = await c.query(
  `select method, amount, reference from van_sale_payments where sale_id=$1 order by method`,
  [sale.id]);
ok("both halves are recorded", r.rows.length === 2, `${r.rows.length} rows`);
ok("the cash half is kept apart",
   r.rows.find((x) => x.method === "cash")?.amount === "200.00");
ok("so is the mobile money half",
   r.rows.find((x) => x.method === "mobile_money")?.amount === "300.00");
ok("and the momo reference is kept",
   r.rows.find((x) => x.method === "mobile_money")?.reference === "MM-88213");

console.log("\n=== payment that does not add up is refused ===");
sale = await draftSale(2);              // 200
r = await as(driver, `select record_sale_payments($1, $2::jsonb) t`,
  [sale.id, JSON.stringify([{ method: "cash", amount: 250 }])]);
ok("more than the sale is worth is refused", !r.ok, r.error?.slice(0, 52));

r = await as(driver, `select record_sale_payments($1, $2::jsonb) t`,
  [sale.id, JSON.stringify([{ method: "cash", amount: 150 }])]);
ok("a cash sale that is short is refused", !r.ok, r.error?.slice(0, 56));

r = await as(driver, `select record_sale_payments($1, $2::jsonb) t`,
  [sale.id, JSON.stringify([{ method: "cash", amount: 0 }])]);
ok("a zero payment is refused", !r.ok, r.error?.slice(0, 46));

r = await as(driver, `select record_sale_payments($1, $2::jsonb) t`,
  [sale.id, JSON.stringify([{ method: "cash", amount: -50 }])]);
ok("a negative payment is refused", !r.ok, r.error?.slice(0, 46));

console.log("\n=== a credit sale may be part paid ===");
sale = await draftSale(5, "credit");    // 500
r = await as(driver, `select record_sale_payments($1, $2::jsonb) t`,
  [sale.id, JSON.stringify([{ method: "mobile_money", amount: 200 }])]);
ok("a deposit against credit is allowed", r.ok && Number(r.rows[0].t) === 200,
   r.ok ? String(r.rows[0].t) : r.error?.slice(0, 46));

console.log("\n=== recording it again replaces rather than doubles ===");
sale = await draftSale(3);              // 300
await c.query(`select record_sale_payments($1, $2::jsonb)`,
  [sale.id, JSON.stringify([{ method: "cash", amount: 300 }])]);
await c.query(`select record_sale_payments($1, $2::jsonb)`,
  [sale.id, JSON.stringify([{ method: "mobile_money", amount: 300 }])]);
r = await c.query(
  `select count(*)::int n, coalesce(sum(amount),0) s from van_sale_payments where sale_id=$1`,
  [sale.id]);
ok("a corrected breakdown replaces the first",
   r.rows[0].n === 1 && Number(r.rows[0].s) === 300, `${r.rows[0].n} row(s), ${r.rows[0].s}`);

console.log("\n=== a completed sale cannot have its payment rewritten ===");
sale = await draftSale(2);
await c.query(`select record_sale_payments($1, $2::jsonb)`,
  [sale.id, JSON.stringify([{ method: "cash", amount: 200 }])]);
await c.query(`select complete_van_sale($1, 200)`, [sale.id]);
r = await as(driver, `select record_sale_payments($1, $2::jsonb) t`,
  [sale.id, JSON.stringify([{ method: "mobile_money", amount: 200 }])]);
ok("payment on a completed sale is refused", !r.ok, r.error?.slice(0, 46));

console.log("\n=== a driver cannot write the breakdown directly ===");
r = await as(driver,
  `insert into van_sale_payments (org_id, sale_id, method, amount)
   values ($1,$2,'cash',9999) returning id`, [orgA, sale.id]);
ok("inserting a payment by hand is refused", !r.ok, r.error?.slice(0, 46));
r = await as(driver, `select method, amount from van_sale_payments where sale_id=$1`, [sale.id]);
ok("but a driver can see how their sale was paid", r.ok && r.rows.length > 0,
   r.ok ? `${r.rows.length} row(s)` : r.error?.slice(0, 40));

console.log("\n=== end of day counts cash and momo apart ===");
// A fresh round so the figures are only what this section made.
const van2 = (await c.query(
  `insert into vans (org_id, code, registration_no, home_warehouse_id) values ($1,$2,$3,$4) returning id`,
  [orgA, `PAYV2-${stamp}`.slice(0, 12), `GT2-${stamp}`.slice(0, 14), wh])).rows[0].id;
const driver2 = await mk("paydrv2", "driver");
const seller2 = await mk("paysell2", "salesperson");
await c.query(
  `insert into van_assignments (org_id, van_id, member_id, crew_role) values ($1,$2,$3,'driver')`,
  [orgA, van2, driver2]);
await c.query(
  `insert into van_assignments (org_id, van_id, member_id, crew_role) values ($1,$2,$3,'salesperson')`,
  [orgA, van2, seller2]);
const load2 = (await c.query(
  `insert into van_loads (org_id, van_id, driver_id, warehouse_id, status, load_date,
     driver_confirmed_at, opening_float)
   values ($1,$2,$3,$4,'loaded',current_date, now(), 100) returning id`,
  [orgA, van2, driver, wh])).rows[0].id;
await c.query(
  `insert into van_load_items (org_id, load_id, product_id, qty_loaded, unit_price, unit_cost)
   values ($1,$2,$3,50,100,10)`, [orgA, load2, product]);
await c.query(`select dispatch_van_load($1)`, [load2]);

const saleOn = async (loadId, qty, payments) => {
  const s = (await c.query(
    `insert into van_sales (org_id, load_id, van_id, driver_id, salesperson_id, customer_id,
       sale_type, status, sold_at)
     values ($1,$2,$3,$4,$5,$6,'cash','draft',now()) returning id`,
    [orgA, loadId, van2, driver2, seller2, customer])).rows[0];
  await c.query(
    `insert into van_sale_items (org_id, sale_id, product_id, quantity, unit_price, tax_rate)
     values ($1,$2,$3,$4,100,0)`, [orgA, s.id, product, qty]);
  const total = Number((await c.query(`select total from van_sales where id=$1`, [s.id])).rows[0].total);
  await c.query(`select record_sale_payments($1, $2::jsonb)`, [s.id, JSON.stringify(payments)]);
  await c.query(`select complete_van_sale($1, $2)`, [s.id, total]);
  return s.id;
};

await saleOn(load2, 3, [{ method: "cash", amount: 300 }]);
await saleOn(load2, 4, [{ method: "mobile_money", amount: 400 }]);
await saleOn(load2, 5, [{ method: "cash", amount: 200 }, { method: "mobile_money", amount: 300 }]);

r = await c.query(`select cash_taken, momo_taken, total_taken from load_takings where load_id=$1`, [load2]);
ok("the round's cash is counted on its own", Number(r.rows[0].cash_taken) === 500,
   `cash ${r.rows[0].cash_taken}`);
ok("and the mobile money on its own", Number(r.rows[0].momo_taken) === 700,
   `momo ${r.rows[0].momo_taken}`);
ok("and together they are the takings", Number(r.rows[0].total_taken) === 1200,
   `total ${r.rows[0].total_taken}`);

const recon = (await c.query(`select * from build_reconciliation($1)`, [load2])).rows[0];
ok("expected cash is the float plus the cash taken",
   Number(recon.expected_cash) === 600, `${recon.expected_cash} (100 float + 500 cash)`);
ok("mobile money is expected separately, and not in the tin",
   Number(recon.expected_momo) === 700, `${recon.expected_momo}`);

await c.query(
  `update van_reconciliations set actual_cash = 600, actual_momo = 650 where id=$1`, [recon.id]);
r = await c.query(
  `select cash_variance, momo_variance from van_reconciliations where id=$1`, [recon.id]);
ok("cash balancing is reported on its own", Number(r.rows[0].cash_variance) === 0,
   `${r.rows[0].cash_variance}`);
ok("a mobile money shortfall is visible instead of hidden in the cash",
   Number(r.rows[0].momo_variance) === -50, `${r.rows[0].momo_variance}`);

console.log("\n=== a round recorded before this change still reconciles ===");
// No breakdown rows at all: the figures fall back to being treated as
// cash, which is what they were assumed to be at the time.
const van3 = (await c.query(
  `insert into vans (org_id, code, registration_no, home_warehouse_id) values ($1,$2,$3,$4) returning id`,
  [orgA, `PAYV3-${stamp}`.slice(0, 12), `GT3-${stamp}`.slice(0, 14), wh])).rows[0].id;
const driver3 = await mk("paydrv3", "driver");
const seller3 = await mk("paysell3", "salesperson");
await c.query(
  `insert into van_assignments (org_id, van_id, member_id, crew_role) values ($1,$2,$3,'driver')`,
  [orgA, van3, driver3]);
await c.query(
  `insert into van_assignments (org_id, van_id, member_id, crew_role) values ($1,$2,$3,'salesperson')`,
  [orgA, van3, seller3]);
const load3 = (await c.query(
  `insert into van_loads (org_id, van_id, driver_id, warehouse_id, status, load_date,
     driver_confirmed_at, opening_float)
   values ($1,$2,$3,$4,'loaded',current_date, now(), 50) returning id`,
  [orgA, van3, driver, wh])).rows[0].id;
await c.query(
  `insert into van_load_items (org_id, load_id, product_id, qty_loaded, unit_price, unit_cost)
   values ($1,$2,$3,20,100,10)`, [orgA, load3, product]);
await c.query(`select dispatch_van_load($1)`, [load3]);

const legacy = (await c.query(
  `insert into van_sales (org_id, load_id, van_id, driver_id, salesperson_id, customer_id,
     sale_type, status, sold_at)
   values ($1,$2,$3,$4,$5,$6,'cash','draft',now()) returning id`,
  [orgA, load3, van3, driver3, seller3, customer])).rows[0].id;
await c.query(
  `insert into van_sale_items (org_id, sale_id, product_id, quantity, unit_price, tax_rate)
   values ($1,$2,$3,2,100,0)`, [orgA, legacy, product]);
await c.query(`select complete_van_sale($1, 200)`, [legacy]);

const legacyRecon = (await c.query(`select * from build_reconciliation($1)`, [load3])).rows[0];
ok("an older sale is still expected as cash",
   Number(legacyRecon.expected_cash) === 250, `${legacyRecon.expected_cash} (50 float + 200)`);
ok("and reports no mobile money", Number(legacyRecon.expected_momo) === 0,
   `${legacyRecon.expected_momo}`);

console.log(`\n  ${pass} passed, ${fail} failed`);
await c.end();
process.exit(fail ? 1 : 0);
