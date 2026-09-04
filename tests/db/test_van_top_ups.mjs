/**
 * Topping up a van that is already out on its round.
 *
 * A van goes out on Monday and comes back on Friday, and in between the
 * depot sends more stock. These are the cases that decide whether that
 * is safe: what the van ends up holding, what Friday expects of the
 * salesperson, who is allowed to send it, and what happens when two
 * people send at once.
 *
 * Runs against the real functions. A test that reimplements the
 * arithmetic proves only that it can add up.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Client, CONN } = require("./lib.js");

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };
const head = (t) => console.log(`\n=== ${t} ===`);

const c = new Client(CONN);
await c.connect();

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
  `insert into organizations (name, slug) values ('Top Co','top-co') returning id`)).rows[0].id;
const mkUser = async (name, role, inOrg) => (await c.query(
  `insert into auth.users (email, raw_user_meta_data) values ($1,$2::jsonb) returning id`,
  [`${name.replace(/\W/g, "")}@top.test`,
   JSON.stringify({ full_name: name, role, org_id: inOrg ?? org })])).rows[0].id;

const boss = await mkUser("The Office", "admin");
const driver = await mkUser("Kojo Driver", "driver");
const warehouse = (await c.query(
  `insert into warehouses (org_id, code, name) values ($1,'MAIN','Main') returning id`,
  [org])).rows[0].id;
const category = (await c.query(
  `insert into categories (org_id, name) values ($1,'Goods') returning id`, [org])).rows[0].id;
const customer = (await c.query(
  `insert into customers (org_id, code, name, credit_limit, payment_terms_days)
   values ($1,'C1','Shop',100000,30) returning id`, [org])).rows[0].id;

let sku = 0;
async function product(name, unit, pack, price, piecePrice) {
  return (await c.query(
    `insert into products (org_id, sku, name, unit_of_measure, units_per_case,
                           list_price, piece_price, cost_price, category_id)
     values ($1,$2,$3,$4,$5,$6,$7,20,$8) returning id`,
    [org, `SKU-${++sku}`, name, unit, pack, price, piecePrice, category])).rows[0].id;
}
const stock = (p, units, pieces) => c.query(
  `insert into stock_movements (org_id, product_id, warehouse_id, type, quantity, pieces,
                                reference_type, created_by)
   values ($1,$2,$3,'opening_stock',$4,$5,'seed',null)`,
  [org, p, warehouse, units, pieces]);

let vanN = 0;
/** A van, a salesperson crewed on it, and a dispatched load: a live week. */
async function openWeek(lines) {
  const n = ++vanN;
  const van = (await c.query(
    `insert into vans (org_id, code, registration_no, is_active)
     values ($1,$2,$3,true) returning id`, [org, `TUP-V${n}`, `GT-T${n}-26`])).rows[0].id;
  const seller = await mkUser(`Seller ${n}`, "salesperson");
  await c.query(`insert into van_assignments (org_id, van_id, member_id, crew_role, assigned_at)
                 values ($1,$2,$3,'salesperson',now())`, [org, van, seller]);
  const load = (await c.query(
    `insert into van_loads (org_id, van_id, driver_id, warehouse_id, load_number,
                            load_date, status, opening_float)
     values ($1,$2,$3,$4,$5,current_date,'loaded',0) returning id`,
    [org, van, driver, warehouse, `TUP-L${n}`])).rows[0].id;
  for (const [p, units, pieces] of lines) {
    await c.query(
      `insert into van_load_items (org_id, load_id, product_id, qty_loaded, qty_loaded_pieces,
                                   unit_price, unit_cost)
       values ($1,$2,$3,$4,$5,100,20)`, [org, load, p, units, pieces]);
  }
  await c.query(`select public.dispatch_van_load($1)`, [load]);
  return { van, seller, load };
}

const onVan = async (van, p) => {
  const r = (await c.query(
    `select qty_on_hand u, qty_pieces pc from van_inventory where van_id=$1 and product_id=$2`,
    [van, p])).rows[0];
  return { units: Number(r?.u ?? 0), pieces: Number(r?.pc ?? 0) };
};
const shelf = async (p) => {
  const r = (await c.query(
    `select qty_on_hand u, qty_pieces pc from inventory where warehouse_id=$1 and product_id=$2`,
    [warehouse, p])).rows[0];
  return { units: Number(r?.u ?? 0), pieces: Number(r?.pc ?? 0) };
};
const topUp = (load, lines, note = "more stock") => c.query(
  `select public.top_up_van_load($1,$2::jsonb,$3) id`, [load, JSON.stringify(lines), note]);
const manifest = async (load, p) => {
  const r = (await c.query(
    `select qty_loaded u, qty_loaded_pieces pc from van_load_items
      where load_id=$1 and product_id=$2`, [load, p])).rows[0];
  return { units: Number(r?.u ?? 0), pieces: Number(r?.pc ?? 0) };
};

// ===================================================================
// Cases 1 and 2 - top up once, then again
// ===================================================================
head("1 & 2 - Monday load, Tuesday top-up, Thursday top-up");
{
  const a = await product("Product A", "box", 10, 100, 12);
  const b = await product("Product B", "piece", 1, 5, null);
  const d = await product("Product C", "carton", 24, 200, 9);
  await stock(a, 100, 0); await stock(b, 200, 0); await stock(d, 50, 40);

  const week = await openWeek([[a, 10, 0], [b, 20, 0]]);
  ok("Monday: the van goes out with its load",
     (await onVan(week.van, a)).units === 10 && (await onVan(week.van, b)).units === 20);

  await topUp(week.load, [{ product_id: a, quantity: 5 }, { product_id: d, pieces: 10 }]);
  ok("Tuesday: five more of A reach the van", (await onVan(week.van, a)).units === 15,
     `(${(await onVan(week.van, a)).units})`);
  ok("and ten loose pieces of a product it never had",
     (await onVan(week.van, d)).pieces === 10);

  await topUp(week.load, [{ product_id: b, quantity: 10 }]);
  ok("Thursday: ten more of B", (await onVan(week.van, b)).units === 30,
     `(${(await onVan(week.van, b)).units})`);

  const ups = await c.query(
    `select count(*) n from van_load_top_ups where load_id=$1`, [week.load]);
  ok("both top-ups are kept as separate transactions", Number(ups.rows[0].n) === 2);

  ok("and the manifest is the sum of everything sent",
     (await manifest(week.load, a)).units === 15 && (await manifest(week.load, b)).units === 30,
     `A=${(await manifest(week.load, a)).units} B=${(await manifest(week.load, b)).units}`);

  const moves = await c.query(
    `select count(*) n from stock_movements where reference_type='van_top_up'
       and reference_id in (select id from van_load_top_ups where load_id=$1)`, [week.load]);
  // Three lines across two top-ups, each written out of the warehouse
  // and into the van.
  ok("every line wrote a pair of movements", Number(moves.rows[0].n) === 6, `(${moves.rows[0].n})`);
}

// ===================================================================
// Cases 3, 4 and 11 - the cutoff is the return, not the day
// ===================================================================
head("3, 4 & 11 - topped up on Friday, blocked once the return is finalised");
{
  const p = await product("Friday Goods", "box", 10, 100, 12);
  await stock(p, 100, 0);
  const week = await openWeek([[p, 10, 0]]);

  await topUp(week.load, [{ product_id: p, quantity: 4 }], "Friday morning");
  ok("Friday, before the return: allowed", (await onVan(week.van, p)).units === 14,
     `(${(await onVan(week.van, p)).units})`);

  // The return, counted and approved: the week is closed.
  const board = await onVan(week.van, p);
  const ret = (await c.query(
    `insert into van_returns (org_id, van_id, load_id, driver_id, warehouse_id,
                              return_number, status)
     values ($1,$2,$3,$4,$5,'TUP-R-FRI','submitted') returning id`,
    [org, week.van, week.load, driver, warehouse])).rows[0].id;
  await c.query(
    `insert into van_return_items (org_id, return_id, product_id,
                                   qty_expected, qty_returned_good, qty_damaged)
     values ($1,$2,$3,$4,$4,0)`, [org, ret, p, board.units]);
  await c.query(`select public.approve_van_return($1)`, [ret]);

  const closed = (await c.query(`select status from van_loads where id=$1`, [week.load]))
    .rows[0].status;
  ok("approving the return closes the week", closed === "returned", `(${closed})`);

  let blocked = null;
  try { await topUp(week.load, [{ product_id: p, quantity: 1 }]); }
  catch (e) { blocked = e.message; }
  ok("a top-up after that is refused", blocked !== null);
  ok("and says the round is over",
     /can only be added to a van that is out/.test(blocked ?? ""), (blocked ?? "").slice(0, 60));
}

// ===================================================================
// Case 5 - not enough at the warehouse
// ===================================================================
head("5 - the warehouse has to have it");
{
  const p = await product("Scarce", "box", 10, 100, 12);
  await stock(p, 12, 3);
  const week = await openWeek([[p, 10, 0]]);
  const left = await shelf(p);

  let refused = null;
  try { await topUp(week.load, [{ product_id: p, quantity: 99 }]); }
  catch (e) { refused = e.message; }
  ok("more units than are on the shelf is refused", refused !== null);
  ok("and says what is actually there", /Only \d+ of Scarce at the warehouse/.test(refused ?? ""),
     (refused ?? "").slice(0, 55));

  let loose = null;
  try { await topUp(week.load, [{ product_id: p, pieces: 99 }]); }
  catch (e) { loose = e.message; }
  ok("so is more loose pieces than are there", loose !== null);
  ok("judged on its own, not covered by the cartons",
     /loose pieces of Scarce/.test(loose ?? ""), (loose ?? "").slice(0, 55));

  const after = await shelf(p);
  ok("and nothing left the warehouse",
     after.units === left.units && after.pieces === left.pieces,
     `(${after.units} + ${after.pieces})`);
}

// ===================================================================
// Cases 6 and 7 - all of it, or none of it
// ===================================================================
head("6 & 7 - a top-up is one transaction");
{
  const good = await product("Plenty", "box", 10, 100, 12);
  const short = await product("Nearly Gone", "box", 10, 100, 12);
  await stock(good, 100, 0); await stock(short, 2, 0);
  const week = await openWeek([[good, 5, 0]]);

  const beforeVan = await onVan(week.van, good);
  const beforeShelf = await shelf(good);

  let failed = null;
  try {
    await topUp(week.load, [
      { product_id: good, quantity: 10 },   // fine on its own
      { product_id: short, quantity: 50 },  // not
    ]);
  } catch (e) { failed = e.message; }
  ok("a top-up with one bad line is refused whole", failed !== null);

  ok("the good line did not reach the van",
     (await onVan(week.van, good)).units === beforeVan.units,
     `(${(await onVan(week.van, good)).units})`);
  ok("nor leave the warehouse", (await shelf(good)).units === beforeShelf.units);
  ok("and no top-up was recorded",
     Number((await c.query(`select count(*) n from van_load_top_ups where load_id=$1`,
       [week.load])).rows[0].n) === 0);

  // The same shape, all lines valid.
  await topUp(week.load, [{ product_id: good, quantity: 10 }, { product_id: short, quantity: 2 }]);
  ok("with every line valid, all of it moves",
     (await onVan(week.van, good)).units === beforeVan.units + 10 &&
     (await onVan(week.van, short)).units === 2);
}

// ===================================================================
// Case 8 - sales before the top-up
// ===================================================================
head("8 - a van that has been selling all morning");
{
  const p = await product("Fast Mover", "box", 10, 100, 12);
  await stock(p, 100, 0);
  const week = await openWeek([[p, 20, 0]]);

  const sale = (await c.query(
    `insert into van_sales (org_id, van_id, load_id, salesperson_id, driver_id, customer_id,
                            sale_number, sale_type, status)
     values ($1,$2,$3,$4,$5,$6,'TUP-S1','cash','draft') returning id`,
    [org, week.van, week.load, week.seller, driver, customer])).rows[0].id;
  await c.query(
    `insert into van_sale_items (org_id, sale_id, product_id, quantity, pieces,
                                 unit_price, piece_price)
     values ($1,$2,$3,6,0,100,12)`, [org, sale, p]);
  await c.query(`select public.complete_van_sale($1, (select total from van_sales where id=$1))`,
                [sale]);

  ok("fourteen left after selling six", (await onVan(week.van, p)).units === 14,
     `(${(await onVan(week.van, p)).units})`);

  await topUp(week.load, [{ product_id: p, quantity: 10 }]);
  ok("a top-up adds to what is left, not to what was loaded",
     (await onVan(week.van, p)).units === 24, `(${(await onVan(week.van, p)).units})`);
  ok("while the manifest records all thirty ever sent out",
     (await manifest(week.load, p)).units === 30, `(${(await manifest(week.load, p)).units})`);
}

// ===================================================================
// Case 9 - Friday, after several top-ups
// ===================================================================
head("9 - Friday expects everything that was sent, not just the load");
{
  const p = await product("Weekly Goods", "box", 10, 100, 12);
  await stock(p, 200, 0);
  const week = await openWeek([[p, 20, 0]]);
  await topUp(week.load, [{ product_id: p, quantity: 10 }]);
  await topUp(week.load, [{ product_id: p, quantity: 5 }]);

  const sale = (await c.query(
    `insert into van_sales (org_id, van_id, load_id, salesperson_id, driver_id, customer_id,
                            sale_number, sale_type, status)
     values ($1,$2,$3,$4,$5,$6,'TUP-S2','cash','draft') returning id`,
    [org, week.van, week.load, week.seller, driver, customer])).rows[0].id;
  await c.query(
    `insert into van_sale_items (org_id, sale_id, product_id, quantity, pieces,
                                 unit_price, piece_price)
     values ($1,$2,$3,12,0,100,12)`, [org, sale, p]);
  await c.query(`select public.complete_van_sale($1, (select total from van_sales where id=$1))`,
                [sale]);

  const board = await onVan(week.van, p);
  ok("the van holds thirty-five sent less twelve sold", board.units === 23, `(${board.units})`);

  await c.query(`select public.build_reconciliation($1)`, [week.load]);
  const r = (await c.query(
    `select expected_stock_value, stock_variance from van_reconciliations where load_id=$1`,
    [week.load])).rows[0];
  // Thirty-five units at cost twenty, less twelve sold at the same cost.
  ok("and Friday expects the value of all thirty-five less what sold",
     Number(r.expected_stock_value) === 23 * 20, `(${r.expected_stock_value})`);
  ok("so a van that returns everything it holds has no variance",
     Number(r.stock_variance) === 0, `(${r.stock_variance})`);
}

// ===================================================================
// Case 10 - two people sending at once
// ===================================================================
head("10 - two top-ups racing for the last of the stock");
{
  const p = await product("Contested", "box", 10, 100, 12);
  await stock(p, 10, 0);
  const one = await openWeek([[p, 1, 0]]);
  const two = await openWeek([[p, 1, 0]]);
  const before = await shelf(p);

  const other = new Client(CONN);
  await other.connect();
  await c.query("begin");
  await other.query("begin");

  // Both ask for more than half of what is left, so only one can win.
  const want = Math.floor(before.units / 2) + 1;
  await c.query(`select public.top_up_van_load($1,$2::jsonb,'first')`,
                [one.load, JSON.stringify([{ product_id: p, quantity: want }])]);

  const second = other.query(`select public.top_up_van_load($1,$2::jsonb,'second')`,
                             [two.load, JSON.stringify([{ product_id: p, quantity: want }])]);
  let blocked = false;
  const settled = second.then(() => "went through").catch((e) => e.message);
  await c.query("commit");
  const outcome = await settled;
  try { await other.query("commit"); } catch { blocked = true; }
  if (/Only \d+ of Contested/.test(String(outcome))) blocked = true;
  await other.query("rollback").catch(() => {});
  await other.end();

  ok("the second is made to wait and then refused", blocked, String(outcome).slice(0, 55));
  const after = await shelf(p);
  ok("so the warehouse is drawn down once, not twice",
     after.units === before.units - want, `(${before.units} - ${want} = ${after.units})`);
  ok("and never goes negative", after.units >= 0);
}

// ===================================================================
// Who may send stock to a van
// ===================================================================
head("only the depot may top up a van");
{
  const p = await product("Guarded", "box", 10, 100, 12);
  await stock(p, 50, 0);
  const week = await openWeek([[p, 5, 0]]);
  const lines = JSON.stringify([{ product_id: p, quantity: 1 }]);

  const bySeller = await asUser(week.seller,
    `select public.top_up_van_load($1,$2::jsonb,'for me')`, [week.load, lines]);
  ok("a salesperson may not top up the van they sell from", !bySeller.ok,
     (bySeller.error ?? "").slice(0, 50));

  const byDriver = await asUser(driver,
    `select public.top_up_van_load($1,$2::jsonb,'for me')`, [week.load, lines]);
  ok("nor the driver", !byDriver.ok);

  const byOffice = await asUser(boss,
    `select public.top_up_van_load($1,$2::jsonb,'from the depot')`, [week.load, lines]);
  ok("the office may", byOffice.ok, byOffice.error ?? "");

  // Tenancy: definer rights must not reach across organizations.
  const otherOrg = (await c.query(
    `insert into organizations (name, slug) values ('Rival','rival-top') returning id`)).rows[0].id;
  const rival = await mkUser("Rival Office", "admin", otherOrg);
  const acrossTenants = await asUser(rival,
    `select public.top_up_van_load($1,$2::jsonb,'not mine')`, [week.load, lines]);
  ok("another organization's office cannot top up this van", !acrossTenants.ok,
     (acrossTenants.error ?? "").slice(0, 40));
}

// ===================================================================
// A return already counted
// ===================================================================
head("a count already taken is not overtaken");
{
  const p = await product("Counted", "box", 10, 100, 12);
  await stock(p, 60, 0);
  const week = await openWeek([[p, 10, 0]]);

  await c.query(
    `insert into van_returns (org_id, van_id, load_id, driver_id, warehouse_id,
                              return_number, status)
     values ($1,$2,$3,$4,$5,'TUP-R-CNT','submitted')`,
    [org, week.van, week.load, driver, warehouse]);

  let refused = null;
  try { await topUp(week.load, [{ product_id: p, quantity: 1 }]); }
  catch (e) { refused = e.message; }
  ok("stock cannot be sent to a van whose return is already counted", refused !== null);
  ok("and the message says to settle the return first",
     /Approve or reject it before adding more stock/.test(refused ?? ""),
     (refused ?? "").slice(0, 55));
}

console.log(`\n  ${pass} passed, ${fail} failed`);
await c.end();
process.exit(fail ? 1 : 0);
