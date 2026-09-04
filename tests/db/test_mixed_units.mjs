/**
 * The scenarios the business actually described.
 *
 * Ten boxes and five pieces, a box at 100 and a piece at 12, and the
 * salesperson selling either. Every figure here is from the
 * specification rather than invented, so a failure means the system
 * disagrees with the business rather than with a test author.
 *
 * Runs against the real functions - complete_van_sale, dispatch_van_load,
 * convert_stock_units, transfer_van_stock - because a test that
 * reimplements the arithmetic proves only that it can add up.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Client, CONN } = require("./lib.js");

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };
const head = (t) => console.log(`\n=== ${t} ===`);

const c = new Client(CONN);
await c.connect();

/** Runs as a signed-in user; rolled back, so state is read inside. */
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
  `insert into organizations (name, slug) values ('GB Premium','gb-premium') returning id`)).rows[0].id;

const mkUser = async (name, role) => (await c.query(
  `insert into auth.users (email, raw_user_meta_data) values ($1,$2::jsonb) returning id`,
  [`${name.replace(/\W/g, "")}@mixed.test`,
   JSON.stringify({ full_name: name, role, org_id: org })])).rows[0].id;

const boss = await mkUser("The Office", "admin");
const driver = await mkUser("Kwesi Driver", "driver");

const warehouse = (await c.query(
  `insert into warehouses (org_id, code, name) values ($1,'MAIN','Main Warehouse') returning id`,
  [org])).rows[0].id;
const category = (await c.query(
  `insert into categories (org_id, name) values ($1,'Cleaning Products') returning id`,
  [org])).rows[0].id;
const customer = (await c.query(
  `insert into customers (org_id, code, name, credit_limit, payment_terms_days)
   values ($1,'C1','Shop',100000,30) returning id`, [org])).rows[0].id;

/** A product with its own unit, pack size and two prices. */
async function product(sku, name, unit, pack, unitPrice, piecePrice) {
  return (await c.query(
    `insert into products (org_id, sku, name, unit_of_measure, units_per_case,
                           list_price, piece_price, cost_price, category_id)
     values ($1,$2,$3,$4,$5,$6,$7,10,$8) returning id`,
    [org, sku, name, unit, pack, unitPrice, piecePrice, category])).rows[0].id;
}

// ECOWASH as a box product, and again as a carton product.
const ecowashBox = await product("ECO-BOX", "Ecowash Softening Powder", "box", 10, 100, 12);
const ecowashCtn = await product("ECO-CTN", "Ecowash Carton", "carton", 36, 180, 7);

const shelf = async (p) => {
  const r = (await c.query(
    `select qty_on_hand u, qty_pieces pc from inventory where warehouse_id=$1 and product_id=$2`,
    [warehouse, p])).rows[0];
  return { units: Number(r?.u ?? 0), pieces: Number(r?.pc ?? 0) };
};
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : (w.endsWith("x") ? "es" : "s")}`;
const say = (h, unit) => `${plural(h.units, unit)} + ${plural(h.pieces, "Piece")}`;

const stock = (p, units, pieces) => c.query(
  `insert into stock_movements (org_id, product_id, warehouse_id, type, quantity, pieces,
                                reference_type, created_by)
   values ($1,$2,$3,'opening_stock',$4,$5,'test',null)`,
  [org, p, warehouse, units, pieces]);

// ------------------------------------------------------------------
// A van per scenario, with its own crew.
// ------------------------------------------------------------------
//
// One open load per van and one active van per person, both enforced by
// the schema. Rather than unwinding a round between scenarios - which
// would test the teardown as much as the rule - each gets its own
// vehicle and its own salesperson.
let loadCounter = 0;

/** Puts stock on a fresh van through a real load, as the warehouse would. */
async function loadVan(p, units, pieces) {
  const n = ++loadCounter;
  const van = (await c.query(
    `insert into vans (org_id, code, registration_no, is_active)
     values ($1,$2,$3,true) returning id`,
    [org, `VAN-${n}`, `GT-${100 + n}-20`])).rows[0].id;
  const seller = await mkUser(`Seller ${n}`, "salesperson");
  await c.query(`insert into van_assignments (org_id, van_id, member_id, crew_role, assigned_at)
                 values ($1,$2,$3,'salesperson',now())`, [org, van, seller]);

  const load = (await c.query(
    `insert into van_loads (org_id, van_id, driver_id, warehouse_id, load_number,
                            load_date, status, opening_float)
     values ($1,$2,$3,$4,$5,current_date,'loaded',0) returning id`,
    [org, van, driver, warehouse, `VL-${n}`])).rows[0].id;
  await c.query(
    `insert into van_load_items (org_id, load_id, product_id, qty_loaded, qty_loaded_pieces,
                                 unit_price, unit_cost)
     values ($1,$2,$3,$4,$5,100,10)`,
    [org, load, p, units, pieces]);
  await c.query(`select public.dispatch_van_load($1)`, [load]);
  return { load, van, seller };
}

const onVan = async (van, p) => {
  const r = (await c.query(
    `select qty_on_hand u, qty_pieces pc from van_inventory where van_id=$1 and product_id=$2`,
    [van, p])).rows[0];
  return { units: Number(r?.u ?? 0), pieces: Number(r?.pc ?? 0) };
};

let saleCounter = 0;
/**
 * A real sale, completed by the salesperson, read back inside the same
 * transaction - complete_van_sale runs under asUserSteps, which rolls
 * back, so the balance has to be observed before it does.
 */
async function sell(round, p, units, pieces, unitPrice, piecePrice) {
  const { load, van, seller } = round;
  const sale = (await c.query(
    `insert into van_sales (org_id, van_id, load_id, salesperson_id, driver_id, customer_id,
                            sale_number, sale_type, status)
     values ($1,$2,$3,$4,$5,$6,$7,'cash','draft') returning id`,
    [org, van, load, seller, driver, customer, `VS-${++saleCounter}`])).rows[0].id;
  await c.query(
    `insert into van_sale_items (org_id, sale_id, product_id, quantity, pieces,
                                 unit_price, piece_price)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [org, sale, p, units, pieces, unitPrice, piecePrice]);

  const total = Number((await c.query(
    `select total from van_sales where id=$1`, [sale])).rows[0].total);

  const done = await asUserSteps(seller, [
    [`select public.complete_van_sale($1,$2)`, [sale, total]],
    [`select qty_on_hand u, qty_pieces pc from van_inventory
       where van_id=$1 and product_id=$2`, [van, p]],
  ]);
  return {
    ok: done.ok,
    error: done.error,
    total,
    after: done.ok
      ? { units: Number(done.rows[0].u), pieces: Number(done.rows[0].pc) }
      : null,
  };
}

// ===================================================================
// TEST A - a box sale
// ===================================================================
head("A - selling whole boxes leaves the loose pieces alone");
{
  await stock(ecowashBox, 10, 5);
  const round = await loadVan(ecowashBox, 10, 5);
  ok("the van carries ten boxes and five pieces",
     say(await onVan(round.van, ecowashBox), "Box") === "10 Boxes + 5 Pieces",
     say(await onVan(round.van, ecowashBox), "Box"));

  const r = await sell(round, ecowashBox, 2, 0, 100, 12);
  ok("two boxes sell", r.ok, r.error ?? "");
  ok("eight boxes and five pieces remain",
     r.after?.units === 8 && r.after?.pieces === 5, say(r.after ?? {}, "Box"));
  ok("and the total is 200, not 24 or 224", r.total === 200, `(${r.total})`);
}

// ===================================================================
// TEST B - a piece sale
// ===================================================================
head("B - selling pieces leaves the boxes alone, at the piece price");
{
  const p = await product("ECO-B", "Ecowash B", "box", 10, 100, 12);
  await stock(p, 10, 5);
  const round = await loadVan(p, 10, 5);

  const r = await sell(round, p, 0, 2, 100, 12);
  ok("two pieces sell", r.ok, r.error ?? "");
  ok("ten boxes and three pieces remain",
     r.after?.units === 10 && r.after?.pieces === 3, say(r.after ?? {}, "Box"));
  // The whole point of the specification: not 200, not 100.
  ok("and the total is 24, the piece price twice", r.total === 24, `(${r.total})`);
}

// ===================================================================
// TEST C - both, one after the other
// ===================================================================
head("C - a box and then two pieces, each at its own price");
{
  const p = await product("ECO-C", "Ecowash C", "box", 10, 100, 12);
  await stock(p, 10, 5);
  const round = await loadVan(p, 10, 5);

  // The first sale rolls back with its transaction, so the second is
  // written as one line carrying both halves - which is also how the
  // till sends a customer who takes a box and two singles.
  const r = await sell(round, p, 1, 2, 100, 12);
  ok("a box and two pieces sell together", r.ok, r.error ?? "");
  ok("nine boxes and three pieces remain",
     r.after?.units === 9 && r.after?.pieces === 3, say(r.after ?? {}, "Box"));
  ok("and the total is 124 - one box at 100, two pieces at 12",
     r.total === 124, `(${r.total})`);
}

// ===================================================================
// TEST D - opening a box
// ===================================================================
head("D - a box is opened before its pieces can be sold");
{
  const p = await product("ECO-D", "Ecowash D", "box", 10, 100, 12);
  await stock(p, 10, 0);
  ok("the shelf holds ten boxes and nothing loose",
     say(await shelf(p), "Box") === "10 Boxes + 0 Pieces", say(await shelf(p), "Box"));

  await c.query(`select public.convert_stock_units($1,$2,null,'open',1,'customer wants singles')`,
                [p, warehouse]);
  const opened = await shelf(p);
  ok("opening one leaves nine boxes and ten pieces",
     opened.units === 9 && opened.pieces === 10, say(opened, "Box"));

  const round = await loadVan(p, 9, 10);
  const r = await sell(round, p, 0, 3, 100, 12);
  ok("three of those pieces sell", r.ok, r.error ?? "");
  ok("nine boxes and seven pieces remain",
     r.after?.units === 9 && r.after?.pieces === 7, say(r.after ?? {}, "Box"));
  ok("at 36 - three pieces at twelve", r.total === 36, `(${r.total})`);
}

// ===================================================================
// TEST E and F - the carton product
// ===================================================================
head("E and F - a carton of 36, at 180, with pieces at 7");
{
  await stock(ecowashCtn, 3, 4);
  const round = await loadVan(ecowashCtn, 3, 4);

  const e = await sell(round, ecowashCtn, 1, 0, 180, 7);
  ok("one carton sells", e.ok, e.error ?? "");
  ok("two cartons and four pieces remain",
     e.after?.units === 2 && e.after?.pieces === 4, say(e.after ?? {}, "Carton"));
  ok("at 180", e.total === 180, `(${e.total})`);

  const f = await sell(round, ecowashCtn, 0, 2, 180, 7);
  ok("two pieces sell", f.ok, f.error ?? "");
  ok("three cartons and two pieces remain",
     f.after?.units === 3 && f.after?.pieces === 2, say(f.after ?? {}, "Carton"));
  // 14, not 360. The carton price must never reach a piece.
  ok("at 14 - two pieces at seven, not two cartons at 180",
     f.total === 14, `(${f.total})`);
}

// ===================================================================
// TEST G - a van load
// ===================================================================
head("G - loading a van takes both halves off the shelf");
{
  const p = await product("ECO-G", "Ecowash G", "carton", 36, 180, 7);
  await stock(p, 10, 5);
  const g = await loadVan(p, 3, 2);

  const left = await shelf(p);
  ok("seven cartons and three pieces are left at the warehouse",
     left.units === 7 && left.pieces === 3, say(left, "Carton"));
  const board = await onVan(g.van, p);
  ok("three cartons and two pieces are on the van",
     board.units === 3 && board.pieces === 2, say(board, "Carton"));
}

// ===================================================================
// TEST H - selling off the van, one then the other
// ===================================================================
head("H - a carton then a piece, off the same van");
{
  const p = await product("ECO-H", "Ecowash H", "carton", 36, 180, 7);
  await stock(p, 10, 5);
  const round = await loadVan(p, 3, 2);

  const one = await sell(round, p, 1, 0, 180, 7);
  ok("a carton sells", one.ok, one.error ?? "");
  ok("two cartons and two pieces remain",
     one.after?.units === 2 && one.after?.pieces === 2, say(one.after ?? {}, "Carton"));

  const two = await sell(round, p, 0, 1, 180, 7);
  ok("a single piece sells", two.ok, two.error ?? "");
  ok("three cartons and one piece remain",
     two.after?.units === 3 && two.after?.pieces === 1, say(two.after ?? {}, "Carton"));
  ok("the piece costs 7", two.total === 7, `(${two.total})`);
}

// ===================================================================
// TEST I - a return of one piece
// ===================================================================
head("I - one piece comes back as one piece");
{
  const p = await product("ECO-I", "Ecowash I", "box", 10, 100, 12);
  await stock(p, 5, 0);
  const before = await shelf(p);

  await c.query(
    `select public.record_stock_return($1,'damaged'::public.return_reason,$2::jsonb,$3,null,'one piece back')`,
    [warehouse, JSON.stringify([{ product_id: p, quantity: 0, pieces: 1 }]), customer]);

  const after = await shelf(p);
  ok("the boxes are untouched", after.units === before.units, say(after, "Box"));
  ok("and exactly one loose piece came back",
     after.pieces === before.pieces + 1, `(${after.pieces})`);
}

// ===================================================================
// TEST J - a transfer between vans
// ===================================================================
head("J - a carton and two pieces move to another van");
{
  const p = await product("ECO-J", "Ecowash J", "carton", 36, 180, 7);
  await stock(p, 10, 5);
  const a = await loadVan(p, 5, 4);

  const vanB = (await c.query(
    `insert into vans (org_id, code, registration_no, is_active)
     values ($1,'VAN-RELIEF','GT-999-20',true) returning id`, [org])).rows[0].id;

  const moved = await asUserSteps(boss, [
    [`select public.transfer_van_stock($1,$2,$3::jsonb,'reassigned')`,
     [a.van, vanB, JSON.stringify([{ product_id: p, quantity: 1, pieces: 2 }])]],
    [`select
        (select coalesce(qty_on_hand,0) from van_inventory where van_id=$1 and product_id=$3) au,
        (select coalesce(qty_pieces,0)  from van_inventory where van_id=$1 and product_id=$3) ap,
        (select coalesce(qty_on_hand,0) from van_inventory where van_id=$2 and product_id=$3) bu,
        (select coalesce(qty_pieces,0)  from van_inventory where van_id=$2 and product_id=$3) bp`,
     [a.van, vanB, p]],
  ]);
  ok("the transfer runs", moved.ok, moved.error ?? "");
  const t = moved.ok ? moved.rows[0] : {};
  ok("van A keeps four cartons and two pieces",
     Number(t.au) === 4 && Number(t.ap) === 2, `(${t.au} + ${t.ap})`);
  ok("van B receives one carton and two pieces",
     Number(t.bu) === 1 && Number(t.bp) === 2, `(${t.bu} + ${t.bp})`);
}

// ===================================================================
// The price rule itself
// ===================================================================
head("a piece with no price is refused, not guessed at");
{
  const p = (await c.query(
    `insert into products (org_id, sku, name, unit_of_measure, units_per_case,
                           list_price, cost_price, category_id)
     values ($1,'ECO-NP','Ecowash Unpriced','box',10,100,10,$2) returning id`,
    [org, category])).rows[0].id;

  ok("the product has no piece price",
     (await c.query(`select piece_price from products where id=$1`, [p])).rows[0].piece_price === null);

  await stock(p, 10, 5);
  const round = await loadVan(p, 10, 5);
  const r = await sell(round, p, 0, 2, 100, 0);
  ok("selling pieces of it is refused", !r.ok);
  ok("and says a price has to be set first",
     /No price is set for a single/.test(r.error ?? ""), (r.error ?? "").slice(0, 60));

  // The refusal is the proof that nothing fell back: had the box price
  // stood in for the piece, the sale would have completed at 200.

  const whole = await sell(round, p, 1, 0, 100, 0);
  ok("but whole boxes still sell", whole.ok, whole.error ?? "");
  ok("at the box price", whole.total === 100, `(${whole.total})`);
}

// ===================================================================
// Pack size is for opening a box, not for having singles
// ===================================================================
head("loose pieces need a parent unit, not a pack size");
{
  // A box product nobody has told the system the contents of. This is
  // the ordinary case: the business knows a box costs 100 and a single
  // costs 12, and has never counted how many are in a box.
  const p = await product("ECO-NOPACK", "Ecowash No Pack", "box", 1, 100, 12);
  ok("its pack size is unset", Number(
    (await c.query(`select units_per_case u from products where id=$1`, [p])).rows[0].u) === 1);

  await stock(p, 3, 4);
  const held = await shelf(p);
  ok("it still holds three boxes and four pieces",
     held.units === 3 && held.pieces === 4, say(held, "Box"));

  const round = await loadVan(p, 3, 4);
  const r = await sell(round, p, 0, 2, 100, 12);
  ok("and two of those pieces sell", r.ok, r.error ?? "");
  ok("leaving three boxes and two pieces",
     r.after?.units === 3 && r.after?.pieces === 2, say(r.after ?? {}, "Box"));
  ok("at 24 - the piece price, not the box price", r.total === 24, `(${r.total})`);

  // What the pack size actually governs.
  const opening = await asUserSteps(boss, [
    [`select public.convert_stock_units($1,$2,null,'open',1,'no pack size')`, [p, warehouse]],
  ]);
  ok("but a box of it cannot be opened", !opening.ok);
  ok("because that is the one thing pack size is for",
     /No pack size is set/.test(opening.error ?? ""), (opening.error ?? "").slice(0, 55));
}

// ===================================================================
// Stock nobody can sell
// ===================================================================
head("the office is told about pieces that cannot be sold");
{
  // Holding singles with no price for them: real stock that cannot
  // leave the building, and until this view nothing said so.
  const stranded = await product("STRAND", "Stranded Powder", "box", 1, 100, null);
  await c.query(`update products set piece_price = null where id = $1`, [stranded]);
  await stock(stranded, 2, 6);

  // Priced, so its singles can be sold. Must not appear.
  const fine = await product("FINE", "Priced Powder", "box", 1, 100, 9);
  await stock(fine, 2, 6);

  // Unpriced but holding no singles. Nothing is stuck, so nothing to say.
  const quiet = await product("QUIET", "Quiet Powder", "box", 1, 100, null);
  await c.query(`update products set piece_price = null where id = $1`, [quiet]);
  await stock(quiet, 5, 0);

  // Sold by the piece: its selling price is already the piece price.
  const single = await product("SINGLE", "Single Bar", "piece", 1, 10, null);
  await c.query(`update products set piece_price = null where id = $1`, [single]);
  await stock(single, 40, 0);

  const listed = await asUserSteps(boss, [
    [`select sku, loose_pieces from public.unsellable_pieces order by sku`, []],
  ]);
  ok("the view is readable by the office", listed.ok, listed.error ?? "");
  const skus = listed.ok ? listed.rows.map((r) => r.sku) : [];

  ok("the stranded product is listed", skus.includes("STRAND"), skus.join(", "));
  ok("with the pieces that are stuck",
     Number(listed.rows?.find((r) => r.sku === "STRAND")?.loose_pieces) === 6);
  ok("a priced product is not listed", !skus.includes("FINE"));
  ok("nor one holding no singles", !skus.includes("QUIET"));
  ok("nor one sold by the piece", !skus.includes("SINGLE"));

  // Tenancy: the view runs as its caller, so another organisation's
  // stranded stock must not appear in this one's list.
  const other = (await c.query(
    `insert into organizations (name, slug) values ('Other Co','other-co-up') returning id`)).rows[0].id;
  const otherWh = (await c.query(
    `insert into warehouses (org_id, code, name) values ($1,'OW','Other') returning id`,
    [other])).rows[0].id;
  const otherCat = (await c.query(
    `insert into categories (org_id, name) values ($1,'C') returning id`, [other])).rows[0].id;
  const otherProduct = (await c.query(
    `insert into products (org_id, sku, name, unit_of_measure, units_per_case,
                           list_price, cost_price, category_id)
     values ($1,'OTHER-STRAND','Their Powder','box',1,100,10,$2) returning id`,
    [other, otherCat])).rows[0].id;
  await c.query(
    `insert into stock_movements (org_id, product_id, warehouse_id, type, quantity, pieces,
                                  reference_type, created_by)
     values ($1,$2,$3,'opening_stock',1,5,'test',null)`,
    [other, otherProduct, otherWh]);

  const mine = await asUserSteps(boss, [
    [`select sku from public.unsellable_pieces order by sku`, []],
  ]);
  ok("another organisation's stranded stock stays theirs",
     mine.ok && !mine.rows.map((r) => r.sku).includes("OTHER-STRAND"),
     (mine.rows ?? []).map((r) => r.sku).join(", "));
}

console.log(`\n  ${pass} passed, ${fail} failed`);
await c.end();
process.exit(fail ? 1 : 0);
