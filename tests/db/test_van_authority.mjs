/**
 * A salesperson sells from their own van, and no other.
 *
 * The crew model answered "who made this sale" and stopped there.
 * Nothing asked whether the seller had any business with the van the
 * goods came off, so naming another van's load was enough to sell its
 * stock: the round reconciled short and the ledger blamed the wrong
 * vehicle.
 *
 * Most of what follows is trying to sell stock off a van the seller is
 * not crewed on.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Client, CONN } = require("./lib.js");

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };
const head = (t) => console.log(`\n=== ${t} ===`);

const c = new Client(CONN);
await c.connect();

/** Run as a given signed-in user, rolled back afterwards. */
const asUser = async (id, sql, params) => {
  await c.query("begin");
  await c.query("select set_config('request.jwt.claims',$1,true)",
    [JSON.stringify({ sub: id, role: "authenticated" })]);
  await c.query("set local role authenticated");
  try { return { ok: true, rows: (await c.query(sql, params)).rows }; }
  catch (e) { return { ok: false, error: e.message }; }
  finally { await c.query("rollback"); }
};

const org = (await c.query(
  `insert into organizations (name, slug) values ('Van Co','van-co') returning id`)).rows[0].id;

const mkUser = async (name, role) => (await c.query(
  `insert into auth.users (email, raw_user_meta_data) values ($1,$2::jsonb) returning id`,
  [`${name.replace(/\W/g, "")}@van.test`,
   JSON.stringify({ full_name: name, role, org_id: org })])).rows[0].id;

const driverA = await mkUser("Kofi Driver", "driver");
const sellerA = await mkUser("Nana Seller", "salesperson");
const sellerB = await mkUser("Ama Other", "salesperson");
const boss = await mkUser("The Office", "admin");

const customer = (await c.query(
  `insert into customers (org_id, code, name, credit_limit) values ($1,'C-1','Shop',100000)
   returning id`, [org])).rows[0].id;
const warehouse = (await c.query(
  `insert into warehouses (org_id, code, name) values ($1,'WH','Depot') returning id`,
  [org])).rows[0].id;
const category = (await c.query(
  `insert into categories (org_id, name) values ($1,'Goods') returning id`, [org])).rows[0].id;

const product = (await c.query(
  `insert into products (org_id, sku, name, unit_of_measure, list_price, cost_price, category_id)
   values ($1,'TOM','Tomatoes','piece',10.00,6.00,$2) returning id`, [org, category])).rows[0].id;

// Two vans, each with its own crew and its own stock.
const vanA = (await c.query(
  `insert into vans (org_id, code, registration_no) values ($1,'VAN-001','GR-1') returning id`,
  [org])).rows[0].id;
const vanB = (await c.query(
  `insert into vans (org_id, code, registration_no) values ($1,'VAN-002','GR-2') returning id`,
  [org])).rows[0].id;

await c.query(
  `insert into van_assignments (org_id, van_id, member_id, crew_role, assigned_by)
   values ($1,$2,$3,'driver',$4), ($1,$2,$5,'salesperson',$4), ($1,$6,$7,'salesperson',$4)`,
  [org, vanA, driverA, boss, sellerA, vanB, sellerB]);

const loadA = (await c.query(
  `insert into van_loads (org_id, van_id, driver_id, warehouse_id, status)
   values ($1,$2,$3,$4,'dispatched') returning id`, [org, vanA, driverA, warehouse])).rows[0].id;

// 50 on van A, none on van B.
await c.query(
  `insert into stock_movements (org_id, product_id, van_id, type, quantity, reference_type, created_by)
   values ($1,$2,$3,'transfer_in',50,'van_load',$4)`, [org, product, vanA, boss]);

const onVan = async (van) => Number((await c.query(
  `select coalesce(qty_on_hand,0) q from van_inventory where van_id=$1 and product_id=$2`,
  [van, product])).rows[0]?.q ?? 0);

ok("van A starts with 50", await onVan(vanA) === 50);
ok("van B starts with none", await onVan(vanB) === 0);

/** A draft sale on a given van, attributed to a given salesperson. */
async function draftSale(van, salesperson, qty, type = "cash") {
  const sale = (await c.query(
    `insert into van_sales (org_id, load_id, van_id, driver_id, salesperson_id, customer_id,
                            sale_type, status, subtotal, tax_total, total, amount_paid)
     values ($1,$2,$3,$4,$5,$6,$7,'draft',$8,0,$8,0) returning id`,
    [org, loadA, van, driverA, salesperson, customer, type, qty * 10])).rows[0].id;
  await c.query(
    `insert into van_sale_items (org_id, sale_id, product_id, quantity, unit_price)
     values ($1,$2,$3,$4,10.00)`, [org, sale, product, qty]);
  return sale;
}

head("the salesperson crewed on the van may sell from it");
{
  const sale = await draftSale(vanA, sellerA, 5);
  const done = await asUser(sellerA,
    `select status from complete_van_sale($1, $2)`, [sale, 50]);
  ok("the sale completes", done.ok && done.rows[0].status === "completed",
     done.ok ? "" : done.error.slice(0, 70));
  // Rolled back with the transaction, so the van is untouched here.
  await c.query(`delete from van_sale_items where sale_id=$1`, [sale]);
  await c.query(`delete from van_sales where id=$1`, [sale]);
}

head("a salesperson crewed on another van may not");
{
  // Ama is crewed on van B. The sale names van A, whose stock she has
  // no claim on - which is exactly the request that used to succeed.
  const sale = await draftSale(vanA, sellerB, 5);
  const theft = await asUser(sellerB, `select complete_van_sale($1, $2)`, [sale, 50]);

  ok("the sale is refused", !theft.ok, theft.ok ? "(COMPLETED)" : "");
  ok("and refused for the right reason",
     /not crewed on the van/i.test(theft.error ?? ""), (theft.error ?? "").slice(0, 70));

  const after = await c.query(`select status from van_sales where id=$1`, [sale]);
  ok("the sale stays a draft", after.rows[0].status === "draft");
  ok("and van A keeps its stock", await onVan(vanA) === 50);

  await c.query(`delete from van_sale_items where sale_id=$1`, [sale]);
  await c.query(`delete from van_sales where id=$1`, [sale]);
}

head("a salesperson crewed on no van at all may not");
{
  const drifter = await mkUser("No Van", "salesperson");
  const sale = await draftSale(vanA, drifter, 1);
  const refused = await asUser(drifter, `select complete_van_sale($1, $2)`, [sale, 10]);
  ok("the sale is refused", !refused.ok, refused.ok ? "(COMPLETED)" : "");
  ok("and van A keeps its stock", await onVan(vanA) === 50);
  await c.query(`delete from van_sale_items where sale_id=$1`, [sale]);
  await c.query(`delete from van_sales where id=$1`, [sale]);
}

head("the driver of the van may not sell from it either");
{
  // The driver is crewed, so is_van_crew says yes - and they are still
  // refused, by the older check that the seller owns the sale. Both
  // rules are needed: neither catches this case alone.
  const sale = await draftSale(vanA, sellerA, 1);
  const bySomeoneElse = await asUser(driverA, `select complete_van_sale($1, $2)`, [sale, 10]);
  ok("a driver cannot complete the salesperson's sale", !bySomeoneElse.ok,
     bySomeoneElse.ok ? "(COMPLETED)" : "");
  await c.query(`delete from van_sale_items where sale_id=$1`, [sale]);
  await c.query(`delete from van_sales where id=$1`, [sale]);
}

head("the office may settle a round it is not crewed on");
{
  const sale = await draftSale(vanA, sellerA, 2);
  const settled = await asUser(boss, `select status from complete_van_sale($1, $2)`, [sale, 20]);
  ok("a manager completes it", settled.ok && settled.rows[0].status === "completed",
     settled.ok ? "" : settled.error.slice(0, 70));
  await c.query(`delete from van_sale_items where sale_id=$1`, [sale]);
  await c.query(`delete from van_sales where id=$1`, [sale]);
}

head("a van cannot be sold past what it carries");
{
  const sale = await draftSale(vanA, sellerA, 51);
  const oversold = await asUser(sellerA, `select complete_van_sale($1, $2)`, [sale, 510]);
  ok("selling more than is on board is refused", !oversold.ok,
     oversold.ok ? "(COMPLETED)" : "");
  ok("and says what is actually there",
     /does not carry enough/i.test(oversold.error ?? ""), (oversold.error ?? "").slice(0, 70));
  ok("the van keeps its stock", await onVan(vanA) === 50);
  await c.query(`delete from van_sale_items where sale_id=$1`, [sale]);
  await c.query(`delete from van_sales where id=$1`, [sale]);
}

head("selling takes the goods off the van, not the warehouse");
{
  const before = await onVan(vanA);
  const inDepot = Number((await c.query(
    `select coalesce(qty_on_hand,0) q from inventory where warehouse_id=$1 and product_id=$2`,
    [warehouse, product])).rows[0]?.q ?? 0);

  const sale = await draftSale(vanA, sellerA, 5);
  await c.query("begin");
  await c.query("select set_config('request.jwt.claims',$1,true)",
    [JSON.stringify({ sub: sellerA, role: "authenticated" })]);
  await c.query("set local role authenticated");
  await c.query(`select complete_van_sale($1, $2)`, [sale, 50]);
  await c.query("reset role");

  ok("the van is five lighter", await onVan(vanA) === before - 5, `(${await onVan(vanA)})`);

  const stillInDepot = Number((await c.query(
    `select coalesce(qty_on_hand,0) q from inventory where warehouse_id=$1 and product_id=$2`,
    [warehouse, product])).rows[0]?.q ?? 0);
  ok("the depot is untouched", stillInDepot === inDepot);

  const move = await c.query(
    `select type, quantity, van_id, warehouse_id from stock_movements
      where reference_type='van_sale' and reference_id=$1`, [sale]);
  ok("one issue movement is written", move.rowCount === 1);
  ok("against the van, not a warehouse",
     move.rows[0]?.van_id === vanA && move.rows[0]?.warehouse_id === null);
  await c.query("rollback");
}

head("a van's stock is its own");
{
  // The question Part 15 asks: van A must not see van B's stock in its
  // own balance, however much of the same product exists elsewhere.
  await c.query(
    `insert into stock_movements (org_id, product_id, van_id, type, quantity, reference_type, created_by)
     values ($1,$2,$3,'transfer_in',100,'van_load',$4)`, [org, product, vanB, boss]);

  ok("van A still holds 50", await onVan(vanA) === 50, `(${await onVan(vanA)})`);
  ok("van B holds its own 100", await onVan(vanB) === 100, `(${await onVan(vanB)})`);
  ok("neither is the sum of both", await onVan(vanA) !== 150);
}

head("every movement type has a direction");
{
  // A type without one does not miscount the balance - the trigger
  // multiplies null by the quantity and the inventory row stops being a
  // number. Three labels reached production in exactly that state.
  const missing = await c.query(`
    select e.enumlabel v from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'movement_type'
       and public.movement_direction(e.enumlabel::public.movement_type) is null`);
  ok("no movement type is left without one", missing.rowCount === 0,
     missing.rows.map((r) => r.v).join(", "));

  // And the ones that were missing behave, rather than merely resolving.
  const org2 = (await c.query(
    `insert into organizations (name, slug) values ('Dir Co','dir-co') returning id`)).rows[0].id;
  const wh2 = (await c.query(
    `insert into warehouses (org_id, code, name) values ($1,'W2','Shed') returning id`,
    [org2])).rows[0].id;
  const cat2 = (await c.query(
    `insert into categories (org_id, name) values ($1,'C2') returning id`, [org2])).rows[0].id;
  const prod2 = (await c.query(
    `insert into products (org_id, sku, name, unit_of_measure, list_price, cost_price, category_id)
     values ($1,'DIR-1','Direction Test','piece',5,2,$2) returning id`, [org2, cat2])).rows[0].id;

  const level = async () => Number((await c.query(
    `select coalesce(qty_on_hand,0) q from inventory where warehouse_id=$1 and product_id=$2`,
    [wh2, prod2])).rows[0]?.q ?? 0);

  const move = async (type, qty) => c.query(
    `insert into stock_movements (org_id, product_id, warehouse_id, type, quantity,
                                  reference_type, created_by)
     values ($1,$2,$3,$4::public.movement_type,$5,'test',null)`,
    [org2, prod2, wh2, type, qty]);

  await move("opening_stock", 100);
  ok("opening_stock adds to the shelf", await level() === 100, `(${await level()})`);

  await move("stocktake_out", 7);
  ok("stocktake_out takes off it", await level() === 93, `(${await level()})`);

  await move("stocktake_in", 2);
  ok("stocktake_in puts back on it", await level() === 95, `(${await level()})`);

  ok("and the balance is still a number, not null", (await level()) !== null);
}

console.log(`\n  ${pass} passed, ${fail} failed`);
await c.end();
process.exit(fail ? 1 : 0);
