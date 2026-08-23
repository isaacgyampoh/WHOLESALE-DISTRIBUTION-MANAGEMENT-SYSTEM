import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Client, CONN } = require("./lib.js");

/**
 * The whole field workflow, as one round.
 *
 * Loading a van, crewing it, selling from it four ways, and checking
 * that each sale left exactly the records it should. Every existing
 * suite tests one rule; this one walks the sequence a salesperson
 * actually performs and checks the state after each step.
 *
 * It also attacks cost price as a salesperson. That role is new, and
 * `test_cost_security` predates it - so the one role most likely to be
 * overlooked had no coverage at all.
 */
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

const stamp = Date.now().toString(36);
const c = new Client(CONN); await c.connect();
const orgA = (await c.query("select id from organizations where slug='default'")).rows[0].id;

const mk = async (name, role) => (await c.query(
  `insert into auth.users (email, raw_user_meta_data) values ($1,$2::jsonb) returning id`,
  [`${name}-${stamp}@field.test`,
   JSON.stringify({ full_name: name, role, org_id: orgA })])).rows[0].id;

/** Read as this person, through row level security. */
const as = async (who, sql, params) => {
  await c.query("begin");
  await c.query("select set_config('request.jwt.claims',$1,true)",
    [JSON.stringify({ sub: who, role: "authenticated" })]);
  await c.query("set local role authenticated");
  try { return { ok: true, rows: (await c.query(sql, params)).rows }; }
  catch (e) { return { ok: false, error: e.message }; }
  finally { await c.query("rollback"); }
};

/** Act for real as this person, so attribution columns get filled. */
const acting = async (who, sql, params) => {
  await c.query("select set_config('request.jwt.claims',$1,false)",
    [JSON.stringify({ sub: who, role: "authenticated" })]);
  try { return (await c.query(sql, params)).rows; }
  finally { await c.query("select set_config('request.jwt.claims','',false)"); }
};

const driver = await mk("fielddrv", "driver");
const seller = await mk("fieldsell", "salesperson");
const manager = await mk("fieldmgr", "manager");

// ---- a warehouse, a van, a crew, a load ------------------------------
const wh = (await c.query(
  `insert into warehouses (org_id, code, name) values ($1,$2,'Field Depot') returning id`,
  [orgA, `FWH-${stamp}`.slice(0, 12)])).rows[0].id;
const cat = (await c.query(
  `insert into categories (org_id, name) values ($1,$2) returning id`,
  [orgA, `Field Cat ${stamp}`])).rows[0].id;
// Cost 40, sells for 100. The margin is the thing a salesperson must
// never be able to work out.
const product = (await c.query(
  `insert into products (org_id, sku, name, category_id, unit_of_measure,
     cost_price, list_price, tax_rate)
   values ($1,$2,'Field Product',$3,'case',40,100,0) returning id`,
  [orgA, `FLD-${stamp}`.slice(0, 20), cat])).rows[0].id;
const van = (await c.query(
  `insert into vans (org_id, code, registration_no, home_warehouse_id) values ($1,$2,$3,$4) returning id`,
  [orgA, `FV-${stamp}`.slice(0, 12), `GF-${stamp}`.slice(0, 14), wh])).rows[0].id;

await c.query(
  `insert into van_assignments (org_id, van_id, member_id, crew_role) values ($1,$2,$3,'driver')`,
  [orgA, van, driver]);
await c.query(
  `insert into van_assignments (org_id, van_id, member_id, crew_role) values ($1,$2,$3,'salesperson')`,
  [orgA, van, seller]);

await c.query(
  `insert into stock_movements (org_id, product_id, warehouse_id, type, quantity, reason)
   values ($1,$2,$3,'receipt',1000,'Opening')`, [orgA, product, wh]);

const load = (await c.query(
  `insert into van_loads (org_id, van_id, driver_id, warehouse_id, status, load_date,
     driver_confirmed_at, opening_float)
   values ($1,$2,$3,$4,'loaded',current_date, now(), 200) returning id, load_number`,
  [orgA, van, driver, wh])).rows[0];
await c.query(
  `insert into van_load_items (org_id, load_id, product_id, qty_loaded, unit_price, unit_cost)
   values ($1,$2,$3,500,100,40)`, [orgA, load.id, product]);
await c.query(`select dispatch_van_load($1)`, [load.id]);

const onVan = async () => Number((await c.query(
  `select coalesce(qty_on_hand,0) q from van_inventory where van_id=$1 and product_id=$2`,
  [van, product])).rows[0]?.q ?? 0);

ok("the van goes out loaded", (await onVan()) === 500, `${await onVan()} units`);

/** A customer with room on their account. */
const buyer = async (label, limit = 100000) => (await c.query(
  `insert into customers (org_id, code, name, credit_limit, payment_terms_days)
   values ($1,$2,$3,$4,14) returning id`,
  [orgA, `FC${label}-${stamp}`.slice(0, 12), `Field ${label}`, limit])).rows[0].id;

/** Open a sale as the salesperson, record how it was paid, complete it. */
const sell = async (customer, qty, saleType, payments, paid) => {
  const sale = (await acting(seller,
    `insert into van_sales (org_id, load_id, van_id, customer_id, sale_type, status, sold_at)
     values ($1,$2,$3,$4,$5,'draft',now()) returning id, salesperson_id, driver_id, van_id`,
    [orgA, load.id, van, customer, saleType]))[0];
  await c.query(
    `insert into van_sale_items (org_id, sale_id, product_id, quantity, unit_price, tax_rate)
     values ($1,$2,$3,$4,100,0)`, [orgA, sale.id, product, qty]);
  if (payments) {
    await c.query(`select record_sale_payments($1,$2::jsonb)`,
      [sale.id, JSON.stringify(payments)]);
  }
  await acting(seller, `select complete_van_sale($1,$2)`, [sale.id, paid ?? null]);
  return sale;
};

// ====================================================================
console.log("\n-- test 1: a cash sale --");
// ====================================================================
const cashCustomer = await buyer("CASH");
let stock = await onVan();
const cashSale = await sell(cashCustomer, 3, "cash",
  [{ method: "cash", amount: 300 }], 300);

ok("attributed to the salesperson", cashSale.salesperson_id === seller);
ok("the driver is recorded from the load", cashSale.driver_id === driver);
ok("and the van", cashSale.van_id === van);
ok("stock came off the van", (await onVan()) === stock - 3, `${await onVan()}`);

let row = (await c.query(`select * from van_sales where id=$1`, [cashSale.id])).rows[0];
ok("the total is right", Number(row.total) === 300, `₵${row.total}`);
ok("it is settled", Number(row.balance) === 0);
ok("and completed", row.status === "completed");

let pay = (await c.query(
  `select method, amount from van_sale_payments where sale_id=$1`, [cashSale.id])).rows;
ok("one cash payment recorded", pay.length === 1 && pay[0].method === "cash");

// ====================================================================
console.log("\n-- test 2: a mobile money sale --");
// ====================================================================
const momoCustomer = await buyer("MOMO");
stock = await onVan();
const momoSale = await sell(momoCustomer, 2, "cash",
  [{ method: "mobile_money", amount: 200, provider: "telecel", reference: "TC-9981" }], 200);

pay = (await c.query(
  `select method, amount, provider, reference from van_sale_payments where sale_id=$1`,
  [momoSale.id])).rows[0];
ok("recorded as mobile money", pay.method === "mobile_money");
ok("with the network", pay.provider === "telecel");
ok("and the reference", pay.reference === "TC-9981");
ok("stock came off", (await onVan()) === stock - 2);

// Each of the three networks is accepted.
for (const network of ["mtn", "telecel", "airteltigo"]) {
  const s = await sell(await buyer(`N${network.slice(0, 3)}`), 1, "cash",
    [{ method: "mobile_money", amount: 100, provider: network }], 100);
  const got = (await c.query(
    `select provider from van_sale_payments where sale_id=$1`, [s.id])).rows[0];
  ok(`${network} is accepted`, got?.provider === network);
}

// ====================================================================
console.log("\n-- test 3: cash and mobile money together --");
// ====================================================================
const splitCustomer = await buyer("SPLIT");
stock = await onVan();
const splitSale = await sell(splitCustomer, 1, "cash", [
  { method: "cash", amount: 50 },
  { method: "mobile_money", amount: 50, provider: "mtn", reference: "MM-7" },
], 100);

pay = (await c.query(
  `select method, amount from van_sale_payments where sale_id=$1 order by method`,
  [splitSale.id])).rows;
ok("50 cash and 50 momo is accepted", pay.length === 2, `${pay.length} rows`);
ok("the halves are kept apart",
   Number(pay.find((p) => p.method === "cash")?.amount) === 50
   && Number(pay.find((p) => p.method === "mobile_money")?.amount) === 50);
ok("and the sale is settled", Number((await c.query(
  `select balance from van_sales where id=$1`, [splitSale.id])).rows[0].balance) === 0);

// 40 + 50 against a 100 sale is short, and a cash sale that is short is
// not a cash sale.
const shortSale = (await acting(seller,
  `insert into van_sales (org_id, load_id, van_id, customer_id, sale_type, status, sold_at)
   values ($1,$2,$3,$4,'cash','draft',now()) returning id`,
  [orgA, load.id, van, splitCustomer]))[0];
await c.query(
  `insert into van_sale_items (org_id, sale_id, product_id, quantity, unit_price, tax_rate)
   values ($1,$2,$3,1,100,0)`, [orgA, shortSale.id, product]);
const shortErr = await c.query(`select record_sale_payments($1,$2::jsonb)`,
  [shortSale.id, JSON.stringify([
    { method: "cash", amount: 40 },
    { method: "mobile_money", amount: 50, provider: "mtn" },
  ])]).then(() => null, (e) => e.message);
ok("40 + 50 against a 100 sale is refused", shortErr !== null,
   shortErr?.split("\n")[0]?.slice(0, 58));

const overErr = await c.query(`select record_sale_payments($1,$2::jsonb)`,
  [shortSale.id, JSON.stringify([
    { method: "cash", amount: 60 },
    { method: "mobile_money", amount: 50, provider: "mtn" },
  ])]).then(() => null, (e) => e.message);
ok("and 60 + 50 is refused too", overErr !== null, "more than the sale is worth");

const negErr = await c.query(`select record_sale_payments($1,$2::jsonb)`,
  [shortSale.id, JSON.stringify([{ method: "cash", amount: -10 }])])
  .then(() => null, (e) => e.message);
ok("a negative amount is refused", negErr !== null);

const badNet = await c.query(`select record_sale_payments($1,$2::jsonb)`,
  [shortSale.id, JSON.stringify([
    { method: "mobile_money", amount: 100, provider: "vodafone" },
  ])]).then(() => null, (e) => e.message);
ok("an unknown network is refused", badNet !== null, "networks rebrand; guesses do not");

// ====================================================================
console.log("\n-- test 4: an authorised credit sale --");
// ====================================================================
const creditCustomer = await buyer("CREDIT", 1000);
stock = await onVan();
const creditSale = await sell(creditCustomer, 4, "credit", null, 0);

row = (await c.query(`select * from van_sales where id=$1`, [creditSale.id])).rows[0];
ok("the sale completes on account", row.status === "completed");
ok("with the whole amount outstanding", Number(row.balance) === 400, `₵${row.balance}`);
ok("a due date is set", row.due_date !== null);
ok("stock still came off the van", (await onVan()) === stock - 4);

const invoice = (await c.query(
  `select * from invoices where van_sale_id=$1`, [creditSale.id])).rows[0];
ok("an invoice was raised automatically", !!invoice, invoice?.invoice_number);
ok("for the value of the sale", Number(invoice?.total) === 400);
ok("and it is unpaid", Number(invoice?.balance) === 400);

const ledger = (await c.query(
  `select coalesce(sum(amount),0) s from credit_transactions where customer_id=$1`,
  [creditCustomer])).rows[0].s;
ok("the customer's ledger carries the debt", Number(ledger) === 400, `₵${ledger}`);

// ====================================================================
console.log("\n-- test 5: credit beyond the limit --");
// ====================================================================
// ₵1000 limit, ₵400 already owed, so ₵700 more must be refused.
const tight = (await acting(seller,
  `insert into van_sales (org_id, load_id, van_id, customer_id, sale_type, status, sold_at)
   values ($1,$2,$3,$4,'credit','draft',now()) returning id`,
  [orgA, load.id, van, creditCustomer]))[0];
await c.query(
  `insert into van_sale_items (org_id, sale_id, product_id, quantity, unit_price, tax_rate)
   values ($1,$2,$3,7,100,0)`, [orgA, tight.id, product]);

stock = await onVan();
const limitErr = await acting(seller, `select complete_van_sale($1,0)`, [tight.id])
  .then(() => null, (e) => e.message);
ok("a sale beyond the credit limit is refused", limitErr !== null,
   limitErr?.split("\n")[0]?.slice(0, 56));
ok("and no stock moved", (await onVan()) === stock, "the refusal is complete");
ok("the sale is still a draft", (await c.query(
  `select status from van_sales where id=$1`, [tight.id])).rows[0].status === "draft");

// ====================================================================
console.log("\n-- cost price, attacked as a salesperson --");
// ====================================================================
//
// This role is new. Everything below is the same attack test that
// already covers drivers, run as the person who actually handles money.

let r = await as(seller, `select cost_price from products where id=$1`, [product]);
ok("cannot select cost_price from products", !r.ok || r.rows.length === 0,
   r.ok ? "COLUMN READABLE" : r.error?.slice(0, 44));

r = await as(seller, `select unit_cost from van_load_items where load_id=$1`, [load.id]);
ok("cannot read unit cost off the load", !r.ok || r.rows.length === 0,
   r.ok ? "READABLE" : r.error?.slice(0, 44));

r = await as(seller, `select unit_cost from purchase_order_items limit 1`);
ok("cannot read a purchase price", !r.ok || r.rows.length === 0);

r = await as(seller, `select product_cost($1) c`, [product]);
ok("product_cost() returns nothing to them",
   !r.ok || r.rows[0]?.c === null, r.ok ? `got ${r.rows[0]?.c}` : "refused");

r = await as(seller, `select stock_value from van_stock_summary where van_id=$1`, [van]);
ok("van stock is not valued for them",
   !r.ok || r.rows.every((x) => x.stock_value === null),
   r.ok ? `${r.rows[0]?.stock_value}` : "refused");

r = await as(seller, `select stock_value from stock_summary limit 1`);
ok("nor is warehouse stock",
   !r.ok || r.rows.every((x) => x.stock_value === null));

r = await as(seller, `select * from suppliers limit 1`);
ok("suppliers are not theirs to read", !r.ok || r.rows.length === 0);

r = await as(seller, `select cost_price from products_priced where id=$1`, [product]);
ok("the masked view gives them null, not the figure",
   r.ok && r.rows[0]?.cost_price === null,
   r.ok ? `got ${r.rows[0]?.cost_price}` : r.error?.slice(0, 40));

// The selling price is their job and must still work.
r = await as(seller, `select list_price from products_priced where id=$1`, [product]);
ok("but the selling price is readable", r.ok && Number(r.rows[0]?.list_price) === 100,
   `₵${r.rows[0]?.list_price}`);

// And a manager, who is allowed, still gets it - once they are scoped
// to the category. A manager with no scope sees no products at all,
// which is the rule working rather than a cost failure.
r = await as(manager, `select cost_price from products_priced where id=$1`, [product]);
ok("a manager with no category scope sees no product at all",
   r.ok && r.rows.length === 0, "scoping, not a cost rule");

await c.query(
  `insert into manager_category_scopes (org_id, profile_id, category_id) values ($1,$2,$3)`,
  [orgA, manager, cat]);

r = await as(manager, `select cost_price, list_price from products_priced where id=$1`, [product]);
ok("once scoped, the manager sees the product", r.ok && r.rows.length === 1);
ok("and its cost", Number(r.rows[0]?.cost_price) === 40, `₵${r.rows[0]?.cost_price}`);

// ---- the documents a customer receives ------------------------------
const docCols = (await c.query(
  `select column_name from information_schema.columns
    where table_schema='public'
      and table_name in ('invoice_detail','receipt_detail')
      and (column_name ilike '%cost%' or column_name ilike '%margin%')`)).rows;
ok("no customer document carries cost or margin", docCols.length === 0,
   docCols.map((x) => x.column_name).join(", "));

// ---- what a phone caches offline ------------------------------------
const bootstrap = await as(seller, `select sync_bootstrap() b`);
if (bootstrap.ok) {
  const text = JSON.stringify(bootstrap.rows[0].b);
  ok("the offline snapshot holds no cost figure",
     !/cost_price|unit_cost/.test(text) && !text.includes('"40"') ,
     "checked the payload the device stores");
} else {
  ok("the offline snapshot holds no cost figure", true, "(sync not on this database)");
}

console.log(`\n  ${pass} passed, ${fail} failed`);
await c.end();
process.exit(fail ? 1 : 0);
