/**
 * Selling over the counter.
 *
 * A salesperson standing in the shop, selling warehouse stock to
 * whoever walks in. The same sale machinery as a round - unit and piece
 * prices, cash and credit, a receipt - drawing on a warehouse instead
 * of a van.
 *
 * What these check is that the counter path is as careful as the van
 * path, and that the van path is exactly as it was.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Client, CONN } = require("./lib.js");

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };
const head = (t) => console.log(`\n=== ${t} ===`);

const c = new Client(CONN);
await c.connect();

const asUserSteps = async (id, steps) => {
  await c.query("begin");
  await c.query("select set_config('request.jwt.claims',$1,true)",
    [JSON.stringify({ sub: id, role: "authenticated" })]);
  await c.query("set local role authenticated");
  try {
    let last;
    for (const [sql, params] of steps) last = await c.query(sql, params);
    return { ok: true, rows: last.rows };
  } catch (e) { return { ok: false, error: e.message }; }
  finally { await c.query("rollback"); }
};

const org = (await c.query(
  `insert into organizations (name, slug) values ('Shop Co','shop-co') returning id`)).rows[0].id;
const mkUser = async (name, role, inOrg) => (await c.query(
  `insert into auth.users (email, raw_user_meta_data) values ($1,$2::jsonb) returning id`,
  [`${name.replace(/\W/g, "")}@shop.test`,
   JSON.stringify({ full_name: name, role, org_id: inOrg ?? org })])).rows[0].id;

const seller = await mkUser("Akosua Counter", "salesperson");
const boss = await mkUser("The Office", "admin");
const storeman = await mkUser("The Storeman", "warehouse");
const warehouse = (await c.query(
  `insert into warehouses (org_id, code, name) values ($1,'SHOP','Shop Floor') returning id`,
  [org])).rows[0].id;
const category = (await c.query(
  `insert into categories (org_id, name) values ($1,'Goods') returning id`, [org])).rows[0].id;
const named = (await c.query(
  `insert into customers (org_id, code, name, credit_limit, payment_terms_days)
   values ($1,'SC1','Regular Shop',100000,30) returning id`, [org])).rows[0].id;

let sku = 0;
const product = async (name, unit, pack, price, piecePrice) => (await c.query(
  `insert into products (org_id, sku, name, unit_of_measure, units_per_case,
                         list_price, piece_price, cost_price, category_id)
   values ($1,$2,$3,$4,$5,$6,$7,20,$8) returning id`,
  [org, `SC-${++sku}`, name, unit, pack, price, piecePrice, category])).rows[0].id;
const stock = (p, units, pieces) => c.query(
  `insert into stock_movements (org_id, product_id, warehouse_id, type, quantity, pieces,
                                reference_type, created_by)
   values ($1,$2,$3,'opening_stock',$4,$5,'seed',null)`,
  [org, p, warehouse, units, pieces]);
const shelf = async (p) => {
  const r = (await c.query(
    `select qty_on_hand u, qty_pieces pc from inventory where warehouse_id=$1 and product_id=$2`,
    [warehouse, p])).rows[0];
  return { units: Number(r?.u ?? 0), pieces: Number(r?.pc ?? 0) };
};

/** A counter sale, drafted then completed by whoever is serving. */
async function counterSale(
  { product: p, units = 0, pieces = 0, price = 100, piecePrice = 12,
    customer = null, type = "cash", by = seller },
) {
  const sale = (await c.query(
    `insert into van_sales (org_id, warehouse_id, salesperson_id, customer_id,
                            sale_number, sale_type, status)
     values ($1,$2,$3,$4,$5,$6,'draft') returning id`,
    [org, warehouse, by, customer, `SC-S${++sku}`, type])).rows[0].id;
  await c.query(
    `insert into van_sale_items (org_id, sale_id, product_id, quantity, pieces,
                                 unit_price, piece_price)
     values ($1,$2,$3,$4,$5,$6,$7)`, [org, sale, p, units, pieces, price, piecePrice]);
  const total = Number((await c.query(
    `select total from van_sales where id=$1`, [sale])).rows[0].total);
  const done = await asUserSteps(by, [
    [`select public.complete_van_sale($1,$2)`, [sale, type === "cash" ? total : 0]],
    [`select qty_on_hand u, qty_pieces pc from inventory
       where warehouse_id=$1 and product_id=$2`, [warehouse, p]],
  ]);
  return {
    ok: done.ok, error: done.error, total, saleId: sale,
    after: done.ok && done.rows[0]
      ? { units: Number(done.rows[0].u), pieces: Number(done.rows[0].pc) }
      : null,
  };
}

// ===================================================================
head("a walk-in buys for cash");
{
  const p = await product("Key Soap", "carton", 24, 100, 12);
  await stock(p, 10, 6);

  const r = await counterSale({ product: p, units: 2 });
  ok("the sale completes with no customer named", r.ok, r.error ?? "");
  ok("and takes the stock off the shelf",
     r.after?.units === 8 && r.after?.pieces === 6, `(${r.after?.units} + ${r.after?.pieces})`);
  ok("at the carton price", r.total === 200, `(${r.total})`);

  const s = (await c.query(
    `select van_id, load_id, warehouse_id, customer_id, status from van_sales where id=$1`,
    [r.saleId])).rows[0];
  ok("it belongs to no van and no round", s.van_id === null && s.load_id === null);
  ok("and names the warehouse it drew on", s.warehouse_id === warehouse);
}

head("pieces sell at the piece price, over the counter too");
{
  const p = await product("Sachet Soap", "carton", 24, 100, 7);
  await stock(p, 5, 10);

  const r = await counterSale({ product: p, pieces: 3, piecePrice: 7 });
  ok("three singles sell", r.ok, r.error ?? "");
  ok("the cartons are untouched", r.after?.units === 5 && r.after?.pieces === 7,
     `(${r.after?.units} + ${r.after?.pieces})`);
  ok("at twenty-one, not three hundred", r.total === 21, `(${r.total})`);

  // The rule from 0062 holds on this path too.
  const unpriced = await product("Unpriced", "carton", 24, 100, null);
  await c.query(`update products set piece_price = null where id=$1`, [unpriced]);
  await stock(unpriced, 5, 5);
  const refused = await counterSale({ product: unpriced, pieces: 2, piecePrice: 0 });
  ok("a piece with no price is still refused", !refused.ok,
     (refused.error ?? "").slice(0, 45));
}

head("the shelf has to have it");
{
  const p = await product("Scarce Counter", "carton", 24, 100, 12);
  await stock(p, 3, 2);
  const before = await shelf(p);

  const many = await counterSale({ product: p, units: 99 });
  ok("more than is on the shelf is refused", !many.ok);
  ok("and says what is there", /Scarce Counter: 3 available/.test(many.error ?? ""),
     (many.error ?? "").slice(0, 45));

  const loose = await counterSale({ product: p, pieces: 99, piecePrice: 12 });
  ok("so is more loose pieces than are there", !loose.ok,
     (loose.error ?? "").slice(0, 45));

  const after = await shelf(p);
  ok("and nothing moved", after.units === before.units && after.pieces === before.pieces);
}

head("credit needs somebody to owe it");
{
  const p = await product("Credit Goods", "carton", 24, 100, 12);
  await stock(p, 20, 0);

  const onCredit = await counterSale(
    { product: p, units: 2, customer: named, type: "credit" });
  ok("a credit sale to a named customer works", onCredit.ok, onCredit.error ?? "");

  let refused = null;
  try {
    await c.query(
      `insert into van_sales (org_id, warehouse_id, salesperson_id, customer_id,
                              sale_number, sale_type, status)
       values ($1,$2,$3,null,'SC-NOCUST','credit','draft')`,
      [org, warehouse, seller]);
  } catch (e) { refused = e.message; }
  ok("a credit sale to nobody is refused by the database", refused !== null,
     /van_sales_credit_has_a_customer/.test(refused ?? "") ? "by the constraint" : (refused ?? "").slice(0, 40));
}

head("a sale draws on one source, never two and never none");
{
  const p = await product("Source Goods", "carton", 24, 100, 12);
  const cases = [
    ["neither a van nor a warehouse",
     `insert into van_sales (org_id, salesperson_id, sale_number, sale_type, status)
      values ($1,$2,'SC-NONE','cash','draft')`, [org, seller]],
    ["a warehouse and a van at once",
     `insert into van_sales (org_id, warehouse_id, van_id, load_id, salesperson_id,
                             sale_number, sale_type, status)
      values ($1,$2,gen_random_uuid(),gen_random_uuid(),$3,'SC-BOTH','cash','draft')`,
     [org, warehouse, seller]],
  ];
  for (const [what, sql, params] of cases) {
    let msg = null;
    try { await c.query(sql, params); } catch (e) { msg = e.message; }
    ok(what + " is refused", msg !== null,
       /van_sales_has_one_source/.test(msg ?? "") ? "by the constraint" : (msg ?? "").slice(0, 40));
  }
}

head("who may serve at the counter");
{
  const p = await product("Guarded Counter", "carton", 24, 100, 12);
  await stock(p, 20, 0);

  const byStoreman = await counterSale({ product: p, units: 1, by: storeman });
  ok("a warehouse hand may not sell over the counter", !byStoreman.ok,
     (byStoreman.error ?? "").slice(0, 45));

  const byOffice = await counterSale({ product: p, units: 1, by: boss });
  ok("a manager may", byOffice.ok, byOffice.error ?? "");

  const bySeller = await counterSale({ product: p, units: 1, by: seller });
  ok("and a salesperson may", bySeller.ok, bySeller.error ?? "");

  // Definer rights must not reach across tenants.
  const otherOrg = (await c.query(
    `insert into organizations (name, slug) values ('Rival Shop','rival-shop') returning id`)).rows[0].id;
  const rival = await mkUser("Rival Seller", "salesperson", otherOrg);
  const across = await counterSale({ product: p, units: 1, by: rival });
  ok("a salesperson from another organization may not", !across.ok,
     (across.error ?? "").slice(0, 40));
}

head("the receipt names a walk-in without inventing one");
{
  const p = await product("Receipt Goods", "carton", 24, 100, 12);
  await stock(p, 10, 0);
  const r = await counterSale({ product: p, units: 1 });
  ok("the sale completes", r.ok, r.error ?? "");

  // The sale rolled back with its transaction, so the receipt is
  // resolved against a committed one made the same way.
  const sale = (await c.query(
    `insert into van_sales (org_id, warehouse_id, salesperson_id, customer_id,
                            sale_number, sale_type, status, subtotal, tax_total, total, amount_paid)
     values ($1,$2,$3,null,'SC-RCPT','cash','completed',100,0,100,100) returning id`,
    [org, warehouse, seller])).rows[0].id;
  await c.query(
    `insert into van_sale_items (org_id, sale_id, product_id, quantity, pieces,
                                 unit_price, piece_price)
     values ($1,$2,$3,1,0,100,12)`, [org, sale, p]);
  const tok = (await c.query(
    `insert into receipt_tokens (org_id, subject_type, subject_id, receipt_number,
                                 token_hash, token_hint, expires_at)
     values ($1,'sale',$2,'R-SC-1','hash-counter-1','abcd', now() + interval '30 days')
     returning id`, [org, sale])).rows[0].id;

  const doc = (await c.query(
    `select public.resolve_receipt_token('hash-counter-1') d`)).rows[0].d;
  ok("the receipt resolves for a sale with no customer", doc !== null);
  ok("and calls the buyer a walk-in", doc?.customerName === "Walk-in customer",
     JSON.stringify(doc?.customerName));
  ok("without inventing a customer record",
     Number((await c.query(`select count(*) n from customers where org_id=$1`, [org])).rows[0].n) === 1);
}

head("the van path is exactly as it was");
{
  // A round, sold from, with the crew rule still deciding.
  const p = await product("Round Goods", "carton", 24, 100, 12);
  await stock(p, 50, 0);
  const van = (await c.query(
    `insert into vans (org_id, code, registration_no, is_active)
     values ($1,'SC-VAN','GT-SC-26',true) returning id`, [org])).rows[0].id;
  const crew = await mkUser("Round Seller", "salesperson");
  const driver = await mkUser("Round Driver", "driver");
  await c.query(`insert into van_assignments (org_id, van_id, member_id, crew_role, assigned_at)
                 values ($1,$2,$3,'salesperson',now())`, [org, van, crew]);
  const load = (await c.query(
    `insert into van_loads (org_id, van_id, driver_id, warehouse_id, load_number,
                            load_date, status, opening_float)
     values ($1,$2,$3,$4,'SC-L1',current_date,'loaded',0) returning id`,
    [org, van, driver, warehouse])).rows[0].id;
  await c.query(
    `insert into van_load_items (org_id, load_id, product_id, qty_loaded, qty_loaded_pieces,
                                 unit_price, unit_cost)
     values ($1,$2,$3,10,0,100,20)`, [org, load, p]);
  await c.query(`select public.dispatch_van_load($1)`, [load]);

  const mk = async (by) => {
    const sale = (await c.query(
      `insert into van_sales (org_id, van_id, load_id, salesperson_id, driver_id, customer_id,
                              sale_number, sale_type, status)
       values ($1,$2,$3,$4,$5,$6,$7,'cash','draft') returning id`,
      [org, van, load, by, driver, named, `SC-V${++sku}`])).rows[0].id;
    await c.query(
      `insert into van_sale_items (org_id, sale_id, product_id, quantity, pieces,
                                   unit_price, piece_price)
       values ($1,$2,$3,2,0,100,12)`, [org, sale, p]);
    return asUserSteps(by, [
      [`select public.complete_van_sale($1,(select total from van_sales where id=$1))`, [sale]],
      [`select qty_on_hand u from van_inventory where van_id=$1 and product_id=$2`, [van, p]],
    ]);
  };

  const byCrew = await mk(crew);
  ok("the crewed salesperson still sells off the van", byCrew.ok, byCrew.error ?? "");
  ok("and the van is two lighter", Number(byCrew.rows?.[0]?.u) === 8,
     `(${byCrew.rows?.[0]?.u})`);

  const byStranger = await mk(seller);
  ok("somebody not crewed on it still cannot", !byStranger.ok);
  ok("with the message it always gave",
     /not crewed on the van this sale draws from/.test(byStranger.error ?? ""),
     (byStranger.error ?? "").slice(0, 48));
}

head("what each role can see in the catalogue");
{
  const p = await product("Shelf Only", "carton", 24, 100, 12);
  await stock(p, 10, 0);

  // A salesperson crewed on no van at all - the person at the counter.
  const counterHand = await mkUser("Counter Only", "salesperson");
  const seen = await asUserSteps(counterHand, [
    [`select count(*)::int n from products_priced where id = $1`, [p]],
  ]);
  ok("a salesperson sees what is on the shelf", Number(seen.rows?.[0]?.n) === 1,
     `(${seen.rows?.[0]?.n})`);

  // A driver still sees only what their van carries, which is none of it.
  const roundDriver = await mkUser("Shelf Driver", "driver");
  const driverSees = await asUserSteps(roundDriver, [
    [`select count(*)::int n from products_priced where id = $1`, [p]],
  ]);
  ok("a driver still sees only their van", Number(driverSees.rows?.[0]?.n) === 0,
     `(${driverSees.rows?.[0]?.n})`);

  // And cost stays masked for the person at the counter.
  const cost = await asUserSteps(counterHand, [
    [`select cost_price from products_priced where id = $1`, [p]],
  ]);
  ok("without seeing what it cost", cost.rows?.[0]?.cost_price === null,
     JSON.stringify(cost.rows?.[0]?.cost_price));

  // Another organization's shelf is still not theirs.
  const otherOrg = (await c.query(
    `insert into organizations (name, slug) values ('Far Shop','far-shop') returning id`)).rows[0].id;
  const stranger = await mkUser("Far Seller", "salesperson", otherOrg);
  const across = await asUserSteps(stranger, [
    [`select count(*)::int n from products_priced where id = $1`, [p]],
  ]);
  ok("but not another organization's", Number(across.rows?.[0]?.n) === 0,
     `(${across.rows?.[0]?.n})`);
}

console.log(`\n  ${pass} passed, ${fail} failed`);
await c.end();
process.exit(fail ? 1 : 0);
