/**
 * Selling singles out of sealed cartons.
 *
 * Until 0069 a salesperson could not sell one piece of anything unless
 * somebody at the depot had already opened a carton of it. That is not
 * how the counter works: the customer asks for four sachets and the
 * seller cuts the tape. What these check is that the cutting is now
 * possible, that it is recorded rather than assumed, and that the three
 * things that should still refuse still do.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Client, CONN } = require("./lib.js");

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };
const head = (t) => console.log(`\n=== ${t} ===`);

const c = new Client(CONN);
await c.connect();

/** Runs steps as one user in one transaction, then rolls back. */
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
  `insert into organizations (name, slug) values ('Singles Co','singles-co') returning id`)).rows[0].id;
const mkUser = async (name, role, inOrg) => (await c.query(
  `insert into auth.users (email, raw_user_meta_data) values ($1,$2::jsonb) returning id`,
  [`${name.replace(/\W/g, "")}@singles.test`,
   JSON.stringify({ full_name: name, role, org_id: inOrg ?? org })])).rows[0].id;

const seller = await mkUser("Afia Counter", "salesperson");
const driver = await mkUser("The Driver", "driver");
const warehouse = (await c.query(
  `insert into warehouses (org_id, code, name) values ($1,'MAIN','Main Store') returning id`,
  [org])).rows[0].id;
const category = (await c.query(
  `insert into categories (org_id, name) values ($1,'Goods') returning id`, [org])).rows[0].id;
const customer = (await c.query(
  `insert into customers (org_id, code, name, credit_limit, payment_terms_days)
   values ($1,'C1','A Shop',500000,30) returning id`, [org])).rows[0].id;

let n = 0;
const product = async (name, pack, price, piecePrice) => (await c.query(
  `insert into products (org_id, sku, name, unit_of_measure, units_per_case,
                         list_price, piece_price, cost_price, category_id)
   values ($1,$2,$3,'carton',$4,$5,$6,20,$7) returning id`,
  [org, `SG-${++n}`, name, pack, price, piecePrice, category])).rows[0].id;

const stock = (p, units, pieces) => c.query(
  `insert into stock_movements (org_id, product_id, warehouse_id, type, quantity, pieces,
                                reference_type, created_by)
   values ($1,$2,$3,'opening_stock',$4,$5,'seed',null)`,
  [org, p, warehouse, units, pieces]);

/**
 * A counter sale, completed by the seller and read back inside the same
 * transaction - complete_van_sale runs under asUserSteps, which rolls
 * back, so the shelf has to be observed before it does.
 */
async function counterSale(
  { product: p, units = 0, pieces = 0, price = 120, piecePrice = 7, by = seller },
) {
  const sale = (await c.query(
    `insert into van_sales (org_id, warehouse_id, salesperson_id,
                            sale_number, sale_type, status)
     values ($1,$2,$3,$4,'cash','draft') returning id`,
    [org, warehouse, by, `SG-S${++n}`])).rows[0].id;
  await c.query(
    `insert into van_sale_items (org_id, sale_id, product_id, quantity, pieces,
                                 unit_price, piece_price)
     values ($1,$2,$3,$4,$5,$6,$7)`, [org, sale, p, units, pieces, price, piecePrice]);
  const total = Number((await c.query(
    `select total from van_sales where id=$1`, [sale])).rows[0].total);
  // The shelf and the ledger in one row: asUserSteps hands back only the
  // last statement, and both have to be read before the rollback.
  const done = await asUserSteps(by, [
    [`select public.complete_van_sale($1,$2)`, [sale, total]],
    [`select
        (select coalesce(qty_on_hand,0) from inventory
          where warehouse_id=$1 and product_id=$2) u,
        (select coalesce(qty_pieces,0) from inventory
          where warehouse_id=$1 and product_id=$2) pc,
        (select coalesce(json_agg(json_build_object(
                  'type', type, 'quantity', quantity, 'pieces', pieces,
                  'reference_type', reference_type, 'reason', reason)), '[]'::json)
           from stock_movements where product_id=$2 and reference_id=$3) m`,
     [warehouse, p, sale]],
  ]);
  return {
    ok: done.ok, error: done.error, total, saleId: sale,
    after: done.ok ? { units: Number(done.rows[0].u), pieces: Number(done.rows[0].pc) } : null,
    movements: done.ok ? done.rows[0].m : null,
  };
}

// ===================================================================
head("the arithmetic of what has to be opened");
{
  const q = async (want, loose, pack) => (await c.query(
    `select public.units_to_open_for_pieces($1,$2,$3) n`, [want, loose, pack])).rows[0].n;

  ok("nothing when the loose stock already covers it", Number(await q(3, 5, 24)) === 0);
  ok("nothing when it covers it exactly", Number(await q(5, 5, 24)) === 0);
  ok("one carton for the two pieces beyond it", Number(await q(7, 5, 24)) === 1);
  ok("one carton is not two", Number(await q(24, 0, 24)) === 1);
  ok("but twenty-five pieces need a second", Number(await q(25, 0, 24)) === 2);
  ok("three cartons for thirty pieces of twelve", Number(await q(30, 0, 12)) === 3);
  // Null is a refusal, not a zero: there is no answer without a pack size.
  ok("no pack size gives no answer", (await q(3, 0, 1)) === null);
  ok("and none is needed when nothing is wanted", Number(await q(0, 0, 1)) === 0);
}

// ===================================================================
head("a single sells out of a sealed carton");
{
  const p = await product("Sachet Soap", 24, 120, 7);
  await stock(p, 10, 0);

  const r = await counterSale({ product: p, pieces: 3, piecePrice: 7 });
  ok("three singles sell off a shelf holding none loose", r.ok, r.error ?? "");
  ok("a carton is opened for them", r.after?.units === 9, `(${r.after?.units} cartons)`);
  ok("and its other twenty-one stay loose on the shelf",
     r.after?.pieces === 21, `(${r.after?.pieces} pieces)`);
  ok("charged at the piece price, not the carton price", r.total === 21, `(${r.total})`);

  const opened = (r.movements ?? []).filter((m) => m.reference_type === "unit_opened");
  ok("the opening is in the ledger, both halves", opened.length === 2,
     `(${opened.length} movements)`);
  ok("one carton out", opened.some((m) => m.type === "conversion_out"
     && Number(m.quantity) === 1 && Number(m.pieces) === 0));
  ok("twenty-four pieces in", opened.some((m) => m.type === "conversion_in"
     && Number(m.quantity) === 0 && Number(m.pieces) === 24));
  ok("saying which sale opened it",
     /Opened to sell singles on /.test(opened[0]?.reason ?? ""), opened[0]?.reason ?? "");
  ok("and the sale itself still issues what was sold",
     (r.movements ?? []).some((m) => m.type === "issue"
       && Number(m.quantity) === 0 && Number(m.pieces) === 3));
}

// ===================================================================
head("the loose pieces are used first");
{
  const p = await product("Small Soap", 24, 120, 5);
  await stock(p, 5, 10);

  const covered = await counterSale({ product: p, pieces: 8, piecePrice: 5 });
  ok("eight singles come out of the ten already loose", covered.ok, covered.error ?? "");
  ok("no carton is opened", covered.after?.units === 5, `(${covered.after?.units})`);
  ok("and two loose are left", covered.after?.pieces === 2, `(${covered.after?.pieces})`);
  ok("nothing is written as a conversion",
     (covered.movements ?? []).every((m) => m.reference_type !== "unit_opened"));

  const spilling = await counterSale({ product: p, pieces: 12, piecePrice: 5 });
  ok("twelve takes the ten and opens one for the rest", spilling.ok, spilling.error ?? "");
  ok("one carton gone", spilling.after?.units === 4, `(${spilling.after?.units})`);
  ok("and twenty-two loose left", spilling.after?.pieces === 22, `(${spilling.after?.pieces})`);
}

// ===================================================================
head("cartons and singles on one line are counted together");
{
  const p = await product("Both Halves", 12, 100, 11);
  await stock(p, 4, 0);

  const r = await counterSale({ product: p, units: 2, pieces: 5, price: 100, piecePrice: 11 });
  ok("two cartons and five singles sell", r.ok, r.error ?? "");
  ok("three cartons leave: two sold whole and one opened",
     r.after?.units === 1, `(${r.after?.units})`);
  ok("seven of the opened twelve stay loose", r.after?.pieces === 7, `(${r.after?.pieces})`);
  ok("and both halves are charged", r.total === 2 * 100 + 5 * 11, `(${r.total})`);

  // Three cartons are wanted and only one is left. Counting only the
  // ones sold whole would let this through and take the shelf negative.
  await c.query(
    `insert into stock_movements (org_id, product_id, warehouse_id, type, quantity, pieces,
                                  reference_type, created_by)
     values ($1,$2,$3,'adjustment_out',3,0,'seed',null)`, [org, p, warehouse]);
  const short = await counterSale({ product: p, units: 1, pieces: 1, price: 100, piecePrice: 11 });
  ok("one carton and one single needs two when only one is left", !short.ok);
  ok("and the refusal says what has to be opened",
     /on board/.test(short.error ?? "") && /opened/.test(short.error ?? ""),
     (short.error ?? "").slice(0, 100));
}

// ===================================================================
head("what still refuses");
{
  // No pack size. Nothing divides by a number nobody entered.
  const unmeasured = await product("Unmeasured", 1, 100, 9);
  await stock(unmeasured, 6, 0);
  const noPack = await counterSale({ product: unmeasured, pieces: 2, piecePrice: 9 });
  ok("a carton nobody has counted the contents of is not opened", !noPack.ok);
  ok("and the refusal says to record the pack size",
     /pack size/i.test(noPack.error ?? ""), (noPack.error ?? "").slice(0, 100));

  // With loose pieces already there it needs no pack size at all: the
  // singles exist, and 0069 changed nothing about selling them.
  await stock(unmeasured, 0, 4);
  const loose = await counterSale({ product: unmeasured, pieces: 3, piecePrice: 9 });
  ok("but loose pieces already on the shelf still sell without one", loose.ok, loose.error ?? "");
  ok("leaving the cartons alone", loose.after?.units === 6 && loose.after?.pieces === 1,
     `(${loose.after?.units} + ${loose.after?.pieces})`);

  // No piece price. Unchanged from 0062, and the carton is not divided
  // to invent one.
  const unpriced = await product("Unpriced", 24, 100, null);
  await c.query(`update products set piece_price = null where id=$1`, [unpriced]);
  await stock(unpriced, 8, 0);
  const noPrice = await counterSale({ product: unpriced, pieces: 2, piecePrice: 0 });
  ok("a single with no price of its own is still refused", !noPrice.ok);
  ok("and the refusal is about the price, not the carton",
     /price is set for a single/i.test(noPrice.error ?? ""), (noPrice.error ?? "").slice(0, 100));

  // The opener itself is reachable by nobody. It checks no authority by
  // design - its callers do - so a grant would be a way to conjure
  // loose pieces out of any carton.
  const direct = await asUserSteps(seller, [
    [`select public.open_units_for_sale($1,$2,$3,null,1,24,gen_random_uuid(),'mine now')`,
     [org, unpriced, warehouse]],
  ]);
  ok("and nobody may open a carton by calling the opener directly", !direct.ok,
     (direct.error ?? "").slice(0, 60));
}

// ===================================================================
head("a round sells singles the same way");
{
  const p = await product("On The Van", 36, 200, 8);
  await stock(p, 20, 0);

  const van = (await c.query(
    `insert into vans (org_id, code, registration_no, is_active)
     values ($1,'VAN-S','GT-9-26',true) returning id`, [org])).rows[0].id;
  const roundSeller = await mkUser("Kofi Round", "salesperson");
  await c.query(`insert into van_assignments (org_id, van_id, member_id, crew_role, assigned_at)
                 values ($1,$2,$3,'salesperson',now())`, [org, van, roundSeller]);
  const load = (await c.query(
    `insert into van_loads (org_id, van_id, driver_id, warehouse_id, load_number,
                            load_date, status, opening_float)
     values ($1,$2,$3,$4,'VL-S1',current_date,'loaded',0) returning id`,
    [org, van, driver, warehouse])).rows[0].id;
  await c.query(
    `insert into van_load_items (org_id, load_id, product_id, qty_loaded, qty_loaded_pieces,
                                 unit_price, unit_cost)
     values ($1,$2,$3,6,0,200,20)`, [org, load, p]);
  await c.query(`select public.dispatch_van_load($1)`, [load]);

  const sale = (await c.query(
    `insert into van_sales (org_id, van_id, load_id, salesperson_id, driver_id, customer_id,
                            sale_number, sale_type, status)
     values ($1,$2,$3,$4,$5,$6,'SG-VAN','cash','draft') returning id`,
    [org, van, load, roundSeller, driver, customer])).rows[0].id;
  await c.query(
    `insert into van_sale_items (org_id, sale_id, product_id, quantity, pieces,
                                 unit_price, piece_price)
     values ($1,$2,$3,0,4,200,8)`, [org, sale, p]);

  const done = await asUserSteps(roundSeller, [
    [`select public.complete_van_sale($1,32)`, [sale]],
    [`select
        (select coalesce(qty_on_hand,0) from van_inventory
          where van_id=$1 and product_id=$2) u,
        (select coalesce(qty_pieces,0) from van_inventory
          where van_id=$1 and product_id=$2) pc,
        (select count(*)::int from stock_movements
          where reference_id=$3 and reference_type='unit_opened' and van_id=$1) conv,
        (select count(*)::int from stock_movements
          where reference_id=$3 and reference_type='unit_opened'
            and warehouse_id is not null) atDepot`,
     [van, p, sale]],
  ]);
  ok("four singles sell off a van carrying only sealed cartons", done.ok, done.error ?? "");
  ok("a carton on the van is opened",
     Number(done.rows?.[0]?.u) === 5, `(${done.rows?.[0]?.u} cartons)`);
  ok("and its remaining thirty-two ride on as singles",
     Number(done.rows?.[0]?.pc) === 32, `(${done.rows?.[0]?.pc} pieces)`);
  ok("the opening is recorded against the van",
     Number(done.rows?.[0]?.conv) === 2, `(${done.rows?.[0]?.conv})`);
  ok("and not against the warehouse it left days ago",
     Number(done.rows?.[0]?.atdepot) === 0, `(${done.rows?.[0]?.atdepot})`);
}

// ===================================================================
head("a sale made with no signal opens one too");
{
  const p = await product("Offline Singles", 20, 150, 9);
  await stock(p, 12, 0);

  const van = (await c.query(
    `insert into vans (org_id, code, registration_no, is_active)
     values ($1,'VAN-O','GT-10-26',true) returning id`, [org])).rows[0].id;
  const offlineSeller = await mkUser("Adjoa Offline", "salesperson");
  await c.query(`insert into van_assignments (org_id, van_id, member_id, crew_role, assigned_at)
                 values ($1,$2,$3,'salesperson',now())`, [org, van, offlineSeller]);
  const load = (await c.query(
    `insert into van_loads (org_id, van_id, driver_id, warehouse_id, load_number,
                            load_date, status, opening_float)
     values ($1,$2,$3,$4,'VL-O1',current_date,'loaded',0) returning id`,
    [org, van, driver, warehouse])).rows[0].id;
  await c.query(
    `insert into van_load_items (org_id, load_id, product_id, qty_loaded, qty_loaded_pieces,
                                 unit_price, unit_cost)
     values ($1,$2,$3,4,0,150,15)`, [org, load, p]);
  await c.query(`select public.dispatch_van_load($1)`, [load]);

  const payload = {
    load_id: load, customer_id: customer, sale_type: "cash", amount_paid: 45,
    lines: [{ product_id: p, quantity: 0, pieces: 5, unit_price: 150, piece_price: 9 }],
  };
  const queued = await asUserSteps(offlineSeller, [
    [`select public.sync_submit(gen_random_uuid(),'phone-1','van_sale'::public.sync_operation,
                                $1::jsonb, now()) r`, [JSON.stringify(payload)]],
    [`select qty_on_hand u, qty_pieces pc from van_inventory
       where van_id=$1 and product_id=$2`, [van, p]],
  ]);
  ok("the queued sale goes through", queued.ok, queued.error ?? "");
  ok("opening a carton on the way", Number(queued.rows?.[0]?.u) === 3, `(${queued.rows?.[0]?.u})`);
  ok("and leaving fifteen singles on the van",
     Number(queued.rows?.[0]?.pc) === 15, `(${queued.rows?.[0]?.pc})`);

  // Beyond what the van can yield is still a conflict rather than a
  // failure, so the phone shows it as stock that has moved on.
  const tooMany = { ...payload,
    lines: [{ product_id: p, quantity: 0, pieces: 500, unit_price: 150, piece_price: 9 }] };
  const clash = await asUserSteps(offlineSeller, [
    [`select public.sync_submit(gen_random_uuid(),'phone-1','van_sale'::public.sync_operation,
                                $1::jsonb, now()) ->> 'status' s`, [JSON.stringify(tooMany)]],
  ]);
  ok("more singles than the van holds comes back as a conflict",
     clash.rows?.[0]?.s === "conflict", JSON.stringify(clash.rows?.[0]?.s ?? clash.error));
}

// ===================================================================
head("another organization's carton is not opened");
{
  const p = await product("Ours", 24, 100, 6);
  await stock(p, 5, 0);

  const otherOrg = (await c.query(
    `insert into organizations (name, slug) values ('Far Co','far-co-singles') returning id`
  )).rows[0].id;
  const stranger = await mkUser("Far Seller", "salesperson", otherOrg);

  const sale = (await c.query(
    `insert into van_sales (org_id, warehouse_id, salesperson_id,
                            sale_number, sale_type, status)
     values ($1,$2,$3,'SG-CROSS','cash','draft') returning id`,
    [org, warehouse, stranger])).rows[0].id;
  await c.query(
    `insert into van_sale_items (org_id, sale_id, product_id, quantity, pieces,
                                 unit_price, piece_price)
     values ($1,$2,$3,0,3,100,6)`, [org, sale, p]);

  const across = await asUserSteps(stranger, [
    [`select public.complete_van_sale($1,18)`, [sale]],
  ]);
  ok("a seller in another organization cannot complete it", !across.ok,
     (across.error ?? "").slice(0, 60));

  const untouched = (await c.query(
    `select qty_on_hand u, qty_pieces pc from inventory
      where warehouse_id=$1 and product_id=$2`, [warehouse, p])).rows[0];
  ok("and the cartons are still sealed",
     Number(untouched.u) === 5 && Number(untouched.pc) === 0,
     `(${untouched.u} + ${untouched.pc})`);
}

// ===================================================================
head("the phone is told about the pieces");
{
  // The till reads this and nothing else once it is out of signal. It
  // returned the 0022 shape until 0070 - no loose half, no pack size,
  // no unit name and no piece price - so every product on every round
  // rendered as a single stepper however much loose stock was aboard.
  const p = await product("Snapshot Soap", 48, 240, 6);
  await stock(p, 10, 5);

  const van = (await c.query(
    `insert into vans (org_id, code, registration_no, is_active)
     values ($1,'VAN-B','GT-11-26',true) returning id`, [org])).rows[0].id;
  const phoneSeller = await mkUser("Yaa Phone", "salesperson");
  await c.query(`insert into van_assignments (org_id, van_id, member_id, crew_role, assigned_at)
                 values ($1,$2,$3,'salesperson',now())`, [org, van, phoneSeller]);
  const load = (await c.query(
    `insert into van_loads (org_id, van_id, driver_id, warehouse_id, load_number,
                            load_date, status, opening_float)
     values ($1,$2,$3,$4,'VL-B1',current_date,'loaded',0) returning id`,
    [org, van, driver, warehouse])).rows[0].id;
  await c.query(
    `insert into van_load_items (org_id, load_id, product_id, qty_loaded, qty_loaded_pieces,
                                 unit_price, unit_cost)
     values ($1,$2,$3,7,5,240,30)`, [org, load, p]);
  await c.query(`select public.dispatch_van_load($1)`, [load]);

  const boot = await asUserSteps(phoneSeller, [
    [`select public.sync_bootstrap() b`, []],
  ]);
  ok("the snapshot comes back", boot.ok, boot.error ?? "");
  const snap = boot.rows?.[0]?.b ?? {};
  const line = (snap.stock ?? []).find((s) => s.product_id === p);
  const price = (snap.prices ?? []).find((x) => x.product_id === p);

  ok("it carries the sealed units", Number(line?.qty_on_hand) === 7, `(${line?.qty_on_hand})`);
  ok("and the loose pieces beside them", Number(line?.qty_pieces) === 5, `(${line?.qty_pieces})`);
  ok("and how many singles a carton holds",
     Number(line?.pieces_per_unit) === 48, `(${line?.pieces_per_unit})`);
  ok("and what the full unit is called", line?.unit === "carton", `(${line?.unit})`);
  ok("the price list carries the carton price",
     Number(price?.unit_price) === 240, `(${price?.unit_price})`);
  ok("and the price of one single", Number(price?.piece_price) === 6, `(${price?.piece_price})`);

  // A product nobody has priced a single of comes back as zero, which
  // is the till's signal to refuse rather than to guess.
  const unpriced = await product("No Single Price", 24, 300, null);
  await c.query(`update products set piece_price = null where id=$1`, [unpriced]);
  await stock(unpriced, 4, 0);
  await c.query(
    `insert into van_load_items (org_id, load_id, product_id, qty_loaded, qty_loaded_pieces,
                                 unit_price, unit_cost)
     values ($1,$2,$3,2,0,300,40)`, [org, load, unpriced]);

  const again = await asUserSteps(phoneSeller, [[`select public.sync_bootstrap() b`, []]]);
  const noPrice = (again.rows?.[0]?.b?.prices ?? []).find((x) => x.product_id === unpriced);
  ok("an unpriced single reads as zero, not as the carton price",
     Number(noPrice?.piece_price) === 0, `(${noPrice?.piece_price})`);

  // What the phone caches is still only its own round.
  const strangerVan = (await c.query(
    `insert into vans (org_id, code, registration_no, is_active)
     values ($1,'VAN-C','GT-12-26',true) returning id`, [org])).rows[0].id;
  await c.query(
    `insert into van_inventory (org_id, van_id, product_id, qty_on_hand, qty_pieces)
     values ($1,$2,$3,99,99)`, [org, strangerVan, p]);
  const mine = await asUserSteps(phoneSeller, [[`select public.sync_bootstrap() b`, []]]);
  ok("and not another van's",
     (mine.rows?.[0]?.b?.stock ?? []).every((s) => Number(s.qty_on_hand) !== 99));
}

console.log(`\n  ${pass} passed, ${fail} failed`);
await c.end();
process.exit(fail ? 1 : 0);
