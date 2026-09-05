/**
 * Handing stock back from a van before Friday.
 *
 * Stock could reach a van three ways and leave it two. This is the
 * third way out: a manager who realises on Tuesday that fifteen boxes
 * were never needed sends them back, and the round carries on.
 *
 * The cases that matter are what the van and the warehouse hold
 * afterwards, what Friday then expects of the salesperson, who is
 * allowed to do it, and what happens when a sale and a hand-back reach
 * for the same units at once.
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
  `insert into organizations (name, slug) values ('Back Co','back-co') returning id`)).rows[0].id;
const mkUser = async (name, role, inOrg) => (await c.query(
  `insert into auth.users (email, raw_user_meta_data) values ($1,$2::jsonb) returning id`,
  [`${name.replace(/\W/g, "")}@back.test`,
   JSON.stringify({ full_name: name, role, org_id: inOrg ?? org })])).rows[0].id;

const boss = await mkUser("The Office", "admin");
const driver = await mkUser("Yaw Driver", "driver");
const warehouse = (await c.query(
  `insert into warehouses (org_id, code, name) values ($1,'MWM','Main') returning id`,
  [org])).rows[0].id;
const annexe = (await c.query(
  `insert into warehouses (org_id, code, name) values ($1,'MWA','Annexe') returning id`,
  [org])).rows[0].id;
const category = (await c.query(
  `insert into categories (org_id, name) values ($1,'Goods') returning id`, [org])).rows[0].id;
const customer = (await c.query(
  `insert into customers (org_id, code, name, credit_limit, payment_terms_days)
   values ($1,'MWC','Shop',100000,30) returning id`, [org])).rows[0].id;

let sku = 0;
const product = async (name, unit, pack, price, piecePrice) => (await c.query(
  `insert into products (org_id, sku, name, unit_of_measure, units_per_case,
                         list_price, piece_price, cost_price, category_id)
   values ($1,$2,$3,$4,$5,$6,$7,20,$8) returning id`,
  [org, `MW-${++sku}`, name, unit, pack, price, piecePrice, category])).rows[0].id;
const stock = (p, units, pieces) => c.query(
  `insert into stock_movements (org_id, product_id, warehouse_id, type, quantity, pieces,
                                reference_type, created_by)
   values ($1,$2,$3,'opening_stock',$4,$5,'seed',null)`,
  [org, p, warehouse, units, pieces]);

let n = 0;
async function openRound(lines) {
  const i = ++n;
  const van = (await c.query(
    `insert into vans (org_id, code, registration_no, is_active)
     values ($1,$2,$3,true) returning id`, [org, `MW-V${i}`, `GT-M${i}-26`])).rows[0].id;
  const seller = await mkUser(`Seller ${i}`, "salesperson");
  await c.query(`insert into van_assignments (org_id, van_id, member_id, crew_role, assigned_at)
                 values ($1,$2,$3,'salesperson',now())`, [org, van, seller]);
  const load = (await c.query(
    `insert into van_loads (org_id, van_id, driver_id, warehouse_id, load_number,
                            load_date, status, opening_float)
     values ($1,$2,$3,$4,$5,current_date,'loaded',0) returning id`,
    [org, van, driver, warehouse, `MW-L${i}`])).rows[0].id;
  for (const [p, u, pc] of lines) {
    await c.query(
      `insert into van_load_items (org_id, load_id, product_id, qty_loaded, qty_loaded_pieces,
                                   unit_price, unit_cost)
       values ($1,$2,$3,$4,$5,100,20)`, [org, load, p, u, pc]);
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
const shelf = async (p, wh = warehouse) => {
  const r = (await c.query(
    `select qty_on_hand u, qty_pieces pc from inventory where warehouse_id=$1 and product_id=$2`,
    [wh, p])).rows[0];
  return { units: Number(r?.u ?? 0), pieces: Number(r?.pc ?? 0) };
};
const sendBack = (load, lines, wh = warehouse, note = "not needed") => c.query(
  `select public.return_van_stock_to_warehouse($1,$2,$3::jsonb,$4) id`,
  [load, wh, JSON.stringify(lines), note]);
const manifest = async (load, p) => Number((await c.query(
  `select qty_loaded u from van_load_items where load_id=$1 and product_id=$2`,
  [load, p])).rows[0]?.u ?? 0);

async function sell(round, p, units, pieces, price = 100, piecePrice = 12) {
  const sale = (await c.query(
    `insert into van_sales (org_id, van_id, load_id, salesperson_id, driver_id, customer_id,
                            sale_number, sale_type, status)
     values ($1,$2,$3,$4,$5,$6,$7,'cash','draft') returning id`,
    [org, round.van, round.load, round.seller, driver, customer, `MW-S${++sku}`])).rows[0].id;
  await c.query(
    `insert into van_sale_items (org_id, sale_id, product_id, quantity, pieces,
                                 unit_price, piece_price)
     values ($1,$2,$3,$4,$5,$6,$7)`, [org, sale, p, units, pieces, price, piecePrice]);
  await c.query(`select public.complete_van_sale($1,(select total from van_sales where id=$1))`,
                [sale]);
}

// ===================================================================
// 1-5 - the ordinary case, exactly as the business described it
// ===================================================================
head("1-5 - fifteen boxes go back on Tuesday");
{
  const a = await product("Product A", "box", 10, 100, 12);
  const b = await product("Product B", "piece", 1, 5, null);
  await stock(a, 200, 0); await stock(b, 100, 0);

  const round = await openRound([[a, 50, 0], [b, 30, 0]]);
  await sell(round, a, 10, 0);
  ok("Tuesday morning: forty boxes left after selling ten",
     (await onVan(round.van, a)).units === 40, `(${(await onVan(round.van, a)).units})`);

  const shelfBefore = await shelf(a);
  await sendBack(round.load, [{ product_id: a, quantity: 15 }]);

  ok("fifteen leave the van", (await onVan(round.van, a)).units === 25,
     `(${(await onVan(round.van, a)).units})`);
  ok("and arrive at the warehouse", (await shelf(a)).units === shelfBefore.units + 15,
     `(${shelfBefore.units} + 15 = ${(await shelf(a)).units})`);
  ok("the other product is untouched", (await onVan(round.van, b)).units === 30);

  // The accounting rule: nothing historical is rewritten.
  ok("the load manifest still says fifty were sent", await manifest(round.load, a) === 50,
     `(${await manifest(round.load, a)})`);

  const pair = (await c.query(
    `select type, quantity, warehouse_id, van_id from stock_movements
      where reference_type='van_midweek_return' and product_id=$1`, [a])).rows;
  ok("one movement off the van and one onto the shelf", pair.length === 2);
  ok("the van one is outbound",
     pair.some((r) => r.type === "transfer_out" && r.van_id === round.van && !r.warehouse_id));
  ok("the warehouse one is inbound",
     pair.some((r) => r.type === "transfer_in" && r.warehouse_id === warehouse && !r.van_id));
}

// ===================================================================
// 3, 4, 7 - both halves, more than once
// ===================================================================
head("3, 4 & 7 - whole units, loose pieces, and more than one hand-back");
{
  const p = await product("Split Goods", "carton", 24, 200, 9);
  await stock(p, 100, 50);
  const round = await openRound([[p, 20, 30]]);

  await sendBack(round.load, [{ product_id: p, quantity: 5 }]);
  await sendBack(round.load, [{ product_id: p, pieces: 12 }]);
  const board = await onVan(round.van, p);
  ok("cartons and singles come back independently",
     board.units === 15 && board.pieces === 18, `(${board.units} + ${board.pieces})`);

  const count = Number((await c.query(
    `select count(*) n from van_midweek_returns where load_id=$1`, [round.load])).rows[0].n);
  ok("each hand-back is its own transaction", count === 2, `(${count})`);
}

// ===================================================================
// 6, 12, 23 - stock that came from a top-up
// ===================================================================
head("6, 12 & 23 - returning stock that arrived as a top-up");
{
  const p = await product("Topped Goods", "box", 10, 100, 12);
  await stock(p, 100, 0);
  const round = await openRound([[p, 10, 0]]);

  await c.query(`select public.top_up_van_load($1,$2::jsonb,'Tuesday')`,
                [round.load, JSON.stringify([{ product_id: p, quantity: 10 }])]);
  ok("the top-up puts twenty on the van", (await onVan(round.van, p)).units === 20);

  await sendBack(round.load, [{ product_id: p, quantity: 10 }], warehouse, "sent too much");
  ok("ten go back", (await onVan(round.van, p)).units === 10,
     `(${(await onVan(round.van, p)).units})`);

  // The top-up is history and stays history.
  const ups = (await c.query(
    `select count(*) n from van_load_top_ups where load_id=$1`, [round.load])).rows[0];
  ok("the Tuesday top-up is still there", Number(ups.n) === 1);
  ok("still recording all twenty sent out", await manifest(round.load, p) === 20,
     `(${await manifest(round.load, p)})`);
  const upMoves = Number((await c.query(
    `select count(*) n from stock_movements where reference_type='van_top_up'
       and reference_id in (select id from van_load_top_ups where load_id=$1)`,
    [round.load])).rows[0].n);
  ok("and its own movements are untouched", upMoves === 2, `(${upMoves})`);
}

// ===================================================================
// 8, 9, 10 - the cutoff is the Friday return, not the day
// ===================================================================
head("8, 9 & 10 - allowed until the return is settled, then not");
{
  const p = await product("Cutoff Goods", "box", 10, 100, 12);
  await stock(p, 100, 0);
  const round = await openRound([[p, 20, 0]]);

  await sendBack(round.load, [{ product_id: p, quantity: 2 }], warehouse, "Friday morning");
  ok("Friday, before the count: allowed", (await onVan(round.van, p)).units === 18);

  // Counted, not yet approved.
  const ret = (await c.query(
    `insert into van_returns (org_id, van_id, load_id, driver_id, warehouse_id,
                              return_number, status)
     values ($1,$2,$3,$4,$5,'MW-R1','submitted') returning id`,
    [org, round.van, round.load, driver, warehouse])).rows[0].id;

  let counted = null;
  try { await sendBack(round.load, [{ product_id: p, quantity: 1 }]); }
  catch (e) { counted = e.message; }
  ok("once the count is taken: blocked", counted !== null);
  ok("and it says to settle the count first",
     /Approve or reject it before moving stock/.test(counted ?? ""), (counted ?? "").slice(0, 50));

  const board = await onVan(round.van, p);
  await c.query(
    `insert into van_return_items (org_id, return_id, product_id,
                                   qty_expected, qty_returned_good, qty_damaged)
     values ($1,$2,$3,$4,$4,0)`, [org, ret, p, board.units]);
  await c.query(`select public.approve_van_return($1)`, [ret]);

  let closed = null;
  try { await sendBack(round.load, [{ product_id: p, quantity: 1 }]); }
  catch (e) { closed = e.message; }
  ok("once the week is closed: blocked", closed !== null);
  ok("and it says the round is over",
     /while the van is out on its round/.test(closed ?? ""), (closed ?? "").slice(0, 50));
}

// ===================================================================
// 11, 15, 16, 17, 18 - what cannot be sent back
// ===================================================================
head("11 & 15-18 - refusing what is not there");
{
  const p = await product("Scarce Goods", "box", 10, 100, 12);
  await stock(p, 100, 20);
  const round = await openRound([[p, 5, 4]]);
  const before = await onVan(round.van, p);

  const cases = [
    ["more units than the van holds", [{ product_id: p, quantity: 99 }], /Only 5 of Scarce Goods on the van/],
    ["more loose pieces than it holds", [{ product_id: p, pieces: 99 }], /Only 4 loose pieces/],
    ["a line of nothing", [{ product_id: p, quantity: 0, pieces: 0 }], /quantity above zero/],
    ["a negative quantity", [{ product_id: p, quantity: -3 }], /whole numbers, zero or more/],
    ["a product that is not ours", [{ product_id: "00000000-0000-0000-0000-000000000001", quantity: 1 }], /Product not found/],
    ["an empty return", [], /Nothing was selected/],
  ];
  for (const [what, lines, expect] of cases) {
    let msg = null;
    try { await sendBack(round.load, lines); } catch (e) { msg = e.message; }
    ok(what + " is refused", msg !== null && expect.test(msg), (msg ?? "accepted").slice(0, 55));
  }

  const after = await onVan(round.van, p);
  ok("and the van is exactly as it was",
     after.units === before.units && after.pieces === before.pieces);
}

// ===================================================================
// 19 - all of it or none of it
// ===================================================================
head("19 - a multi-line hand-back is one transaction");
{
  const good = await product("Plenty Back", "box", 10, 100, 12);
  const thin = await product("Thin Back", "box", 10, 100, 12);
  await stock(good, 100, 0); await stock(thin, 100, 0);
  const round = await openRound([[good, 20, 0], [thin, 2, 0]]);

  const vanBefore = await onVan(round.van, good);
  const shelfBefore = await shelf(good);

  let failed = null;
  try {
    await sendBack(round.load, [
      { product_id: good, quantity: 10 },
      { product_id: thin, quantity: 50 },
    ]);
  } catch (e) { failed = e.message; }
  ok("one bad line refuses the whole hand-back", failed !== null);
  ok("the good line did not leave the van",
     (await onVan(round.van, good)).units === vanBefore.units);
  ok("nor reach the warehouse", (await shelf(good)).units === shelfBefore.units);
  ok("and nothing was recorded",
     Number((await c.query(`select count(*) n from van_midweek_returns where load_id=$1`,
       [round.load])).rows[0].n) === 0);

  await sendBack(round.load, [{ product_id: good, quantity: 10 }, { product_id: thin, quantity: 2 }]);
  ok("with every line valid, all of it moves",
     (await onVan(round.van, good)).units === vanBefore.units - 10 &&
     (await onVan(round.van, thin)).units === 0);
}

// ===================================================================
// 20, 21 - two people reaching for the same units
// ===================================================================
head("20 & 21 - a sale and a hand-back at the same moment");
{
  const p = await product("Contested Back", "box", 10, 100, 12);
  await stock(p, 100, 0);
  const round = await openRound([[p, 10, 0]]);

  const other = new Client(CONN);
  await other.connect();
  await c.query("begin");
  await other.query("begin");

  // Both want seven of the ten on board.
  await c.query(`select public.return_van_stock_to_warehouse($1,$2,$3::jsonb,'first')`,
                [round.load, warehouse, JSON.stringify([{ product_id: p, quantity: 7 }])]);

  const rival = other.query(
    `select public.return_van_stock_to_warehouse($1,$2,$3::jsonb,'second')`,
    [round.load, warehouse, JSON.stringify([{ product_id: p, quantity: 7 }])]);
  const settled = rival.then(() => "went through").catch((e) => e.message);
  await c.query("commit");
  const outcome = await settled;
  try { await other.query("commit"); } catch { /* already failed */ }
  await other.query("rollback").catch(() => {});
  await other.end();

  ok("the second waits and is then refused",
     /Only 3 of Contested Back on the van/.test(String(outcome)), String(outcome).slice(0, 50));
  const board = await onVan(round.van, p);
  ok("so the van is drawn down once, not twice", board.units === 3, `(${board.units})`);
  ok("and never goes negative", board.units >= 0);
}

// ===================================================================
// 20 again - a sale racing a hand-back for the same units
// ===================================================================
head("20 - a sale and a hand-back cannot spend the same units");
{
  const p = await product("Race Goods", "box", 10, 100, 12);
  await stock(p, 100, 0);
  const round = await openRound([[p, 10, 0]]);

  // A draft sale for seven, ready to complete.
  const sale = (await c.query(
    `insert into van_sales (org_id, van_id, load_id, salesperson_id, driver_id, customer_id,
                            sale_number, sale_type, status)
     values ($1,$2,$3,$4,$5,$6,$7,'cash','draft') returning id`,
    [org, round.van, round.load, round.seller, driver, customer, `MW-RACE`])).rows[0].id;
  await c.query(
    `insert into van_sale_items (org_id, sale_id, product_id, quantity, pieces,
                                 unit_price, piece_price)
     values ($1,$2,$3,7,0,100,12)`, [org, sale, p]);

  const other = new Client(CONN);
  await other.connect();
  await c.query("begin");
  await other.query("begin");

  // The hand-back takes seven first and holds the row.
  await c.query(`select public.return_van_stock_to_warehouse($1,$2,$3::jsonb,'depot wants them')`,
                [round.load, warehouse, JSON.stringify([{ product_id: p, quantity: 7 }])]);

  // The sale wants the same seven. Before the lock it read a stale
  // balance, found ten, and took the van to minus four.
  const selling = other.query(
    `select public.complete_van_sale($1,(select total from van_sales where id=$1))`, [sale]);
  const settled = selling.then(() => "went through").catch((e) => e.message);
  await c.query("commit");
  const outcome = await settled;
  try { await other.query("commit"); } catch { /* already failed */ }
  await other.query("rollback").catch(() => {});
  await other.end();

  ok("the sale waits for the hand-back and is then refused",
     /does not carry enough/.test(String(outcome)), String(outcome).slice(0, 55));
  const board = await onVan(round.van, p);
  ok("the van holds the three that are left", board.units === 3, `(${board.units})`);
  ok("and never went negative", board.units >= 0);
}

// ===================================================================
// 22 - Friday counts what already went back
// ===================================================================
head("22 - Friday expects what is actually on the van");
{
  const p = await product("Weekly Back", "box", 10, 100, 12);
  await stock(p, 300, 0);
  const round = await openRound([[p, 50, 0]]);
  await c.query(`select public.top_up_van_load($1,$2::jsonb,'midweek')`,
                [round.load, JSON.stringify([{ product_id: p, quantity: 20 }])]);
  await sell(round, p, 30, 0);
  await sendBack(round.load, [{ product_id: p, quantity: 15 }], warehouse, "over-loaded");

  const board = await onVan(round.van, p);
  ok("fifty out, twenty topped up, thirty sold, fifteen back: twenty-five left",
     board.units === 25, `(${board.units})`);

  await c.query(`select public.build_reconciliation($1)`, [round.load]);
  const r = (await c.query(
    `select expected_stock_value, stock_variance from van_reconciliations where load_id=$1`,
    [round.load])).rows[0];
  ok("and Friday expects twenty-five at cost, not forty",
     Number(r.expected_stock_value) === 25 * 20, `(${r.expected_stock_value})`);
  ok("so a van holding what it should has no variance",
     Number(r.stock_variance) === 0, `(${r.stock_variance})`);
}

// ===================================================================
// 13, 14 - who may do it
// ===================================================================
head("13 & 14 - only the depot, and only its own");
{
  const p = await product("Guarded Back", "box", 10, 100, 12);
  await stock(p, 100, 0);
  const round = await openRound([[p, 10, 0]]);
  const lines = JSON.stringify([{ product_id: p, quantity: 1 }]);

  const bySeller = await asUser(round.seller,
    `select public.return_van_stock_to_warehouse($1,$2,$3::jsonb,'mine')`,
    [round.load, warehouse, lines]);
  ok("a salesperson may not hand stock back", !bySeller.ok, (bySeller.error ?? "").slice(0, 45));

  const byDriver = await asUser(driver,
    `select public.return_van_stock_to_warehouse($1,$2,$3::jsonb,'mine')`,
    [round.load, warehouse, lines]);
  ok("nor the driver", !byDriver.ok);

  const byOffice = await asUser(boss,
    `select public.return_van_stock_to_warehouse($1,$2,$3::jsonb,'depot')`,
    [round.load, warehouse, lines]);
  ok("the office may", byOffice.ok, byOffice.error ?? "");

  const otherOrg = (await c.query(
    `insert into organizations (name, slug) values ('Rival','rival-back') returning id`)).rows[0].id;
  const rival = await mkUser("Rival Office", "admin", otherOrg);
  const across = await asUser(rival,
    `select public.return_van_stock_to_warehouse($1,$2,$3::jsonb,'not mine')`,
    [round.load, warehouse, lines]);
  ok("another organization cannot touch this round", !across.ok, (across.error ?? "").slice(0, 40));

  // Nor send our stock to their shelf.
  const theirWarehouse = (await c.query(
    `insert into warehouses (org_id, code, name) values ($1,'RVW','Theirs') returning id`,
    [otherOrg])).rows[0].id;
  let wrongShelf = null;
  try { await sendBack(round.load, [{ product_id: p, quantity: 1 }], theirWarehouse); }
  catch (e) { wrongShelf = e.message; }
  ok("and stock cannot be sent to another organization's warehouse",
     wrongShelf !== null && /Warehouse not found/.test(wrongShelf), (wrongShelf ?? "").slice(0, 40));
}

// ===================================================================
// A second warehouse, and 25 - pricing is untouched
// ===================================================================
head("stock can go back to a different depot, and nothing is repriced");
{
  const p = await product("Annexe Goods", "box", 10, 100, 12);
  await stock(p, 100, 0);
  const round = await openRound([[p, 10, 0]]);

  await sendBack(round.load, [{ product_id: p, quantity: 4 }], annexe, "closer depot");
  ok("it arrives at the warehouse that was named", (await shelf(p, annexe)).units === 4,
     `(${(await shelf(p, annexe)).units})`);
  ok("and not at the one the round came from", (await shelf(p, warehouse)).units === 90,
     `(${(await shelf(p, warehouse)).units})`);

  const priced = (await c.query(
    `select unit_price, unit_cost from van_load_items where load_id=$1 and product_id=$2`,
    [round.load, p])).rows[0];
  ok("the round's price list is unchanged",
     Number(priced.unit_price) === 100 && Number(priced.unit_cost) === 20,
     `(${priced.unit_price} / ${priced.unit_cost})`);
  const prod = (await c.query(
    `select list_price, piece_price from products where id=$1`, [p])).rows[0];
  ok("and so is the product's", Number(prod.list_price) === 100 && Number(prod.piece_price) === 12);
}

console.log(`\n  ${pass} passed, ${fail} failed`);
await c.end();
process.exit(fail ? 1 : 0);
