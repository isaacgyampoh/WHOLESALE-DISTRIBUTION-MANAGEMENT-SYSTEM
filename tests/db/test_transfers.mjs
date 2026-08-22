import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Client, CONN } = require("./lib.js");

/**
 * Moving stock between warehouses.
 *
 * Before this, a transfer was an adjustment out of one depot and an
 * adjustment in to the other. The arithmetic worked; everything else
 * about it was a lie. What is tested here is the part the arithmetic
 * never covered: that a manager has to agree before goods move, that
 * the stock is genuinely nowhere while it is in transit, and that what
 * arrives is counted rather than assumed.
 */
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

const stamp = Date.now().toString(36);
const c = new Client(CONN); await c.connect();
const orgA = (await c.query("select id from organizations where slug='default'")).rows[0].id;
const orgB = (await c.query(
  `insert into organizations (name, slug) values ('Transfer Rival',$1) returning id`,
  [`trf-rival-${stamp}`])).rows[0].id;

const mk = async (name, role, org = orgA) => (await c.query(
  `insert into auth.users (email, raw_user_meta_data) values ($1,$2::jsonb) returning id`,
  [`${name}-${stamp}@trf.test`, JSON.stringify({ full_name: name, role, org_id: org })])).rows[0].id;

const as = async (who, sql, params) => {
  await c.query("begin");
  await c.query("select set_config('request.jwt.claims',$1,true)",
    [JSON.stringify({ sub: who, role: "authenticated" })]);
  await c.query("set local role authenticated");
  try { return { ok: true, rows: (await c.query(sql, params)).rows }; }
  catch (e) { return { ok: false, error: e.message }; }
  finally { await c.query("rollback"); }
};

/** Run for real as this person, so the audit columns get filled. */
const acting = async (who, sql, params) => {
  await c.query("select set_config('request.jwt.claims',$1,false)",
    [JSON.stringify({ sub: who, role: "authenticated" })]);
  try { return (await c.query(sql, params)).rows; }
  finally { await c.query("select set_config('request.jwt.claims','',false)"); }
};

const storeman = await mk("trfwh", "warehouse");
const manager  = await mk("trfmgr", "manager");
const driver   = await mk("trfdrv", "driver");
const rival    = await mk("trfrival", "admin", orgB);

// ---- two depots and something to move between them ------------------
const accra = (await c.query(
  `insert into warehouses (org_id, code, name) values ($1,$2,'Accra Depot') returning id`,
  [orgA, `TRFA-${stamp}`.slice(0, 12)])).rows[0].id;
const kumasi = (await c.query(
  `insert into warehouses (org_id, code, name) values ($1,$2,'Kumasi Depot') returning id`,
  [orgA, `TRFK-${stamp}`.slice(0, 12)])).rows[0].id;
const cat = (await c.query(
  `insert into categories (org_id, name) values ($1,$2) returning id`,
  [orgA, `Trf Cat ${stamp}`])).rows[0].id;

/** A product, optionally one whose expiry is tracked. */
const makeProduct = async (label, tracked = false) => (await c.query(
  `insert into products (org_id, sku, name, category_id, unit_of_measure,
     cost_price, list_price, tax_rate, track_batches, track_expiry)
   values ($1,$2,$3,$4,'case',10,100,0,$5,$5) returning id`,
  [orgA, `TRF${label}-${stamp}`.slice(0, 20), `Transfer ${label}`, cat, tracked])).rows[0].id;

const product = await makeProduct("P");
await c.query(
  `insert into stock_movements (org_id, product_id, warehouse_id, type, quantity, reason)
   values ($1,$2,$3,'receipt',500,'Opening')`, [orgA, product, accra]);

const stockAt = async (wh, prod = product) => Number((await c.query(
  `select coalesce(qty_on_hand,0) q from inventory where product_id=$1 and warehouse_id=$2`,
  [prod, wh])).rows[0]?.q ?? 0);

/** A draft transfer of `qty` from Accra to Kumasi. */
const draft = async (qty, prod = product) => {
  const t = (await c.query(
    `insert into stock_transfers (org_id, from_warehouse_id, to_warehouse_id, status)
     values ($1,$2,$3,'draft') returning id, transfer_number`,
    [orgA, accra, kumasi])).rows[0];
  await c.query(
    `insert into stock_transfer_items (org_id, transfer_id, product_id, quantity)
     values ($1,$2,$3,$4)`, [orgA, t.id, prod, qty]);
  return t;
};

// ====================================================================
console.log("\n-- nothing moves until somebody agrees --");
// ====================================================================

const t1 = await draft(100);
ok("a transfer starts as a draft", (await c.query(
  `select status from stock_transfers where id=$1`, [t1.id])).rows[0].status === "draft");
ok("numbered as a transfer", /^TRF-\d{4}-\d{6}$/.test(t1.transfer_number), t1.transfer_number);

const shipEarly = await as(storeman, `select dispatch_stock_transfer($1)`, [t1.id]);
ok("a draft cannot be dispatched", !shipEarly.ok, shipEarly.error?.split("\n")[0]);

// The control that matters: a depot cannot sign off its own transfer.
const selfApprove = await as(storeman, `select approve_stock_transfer($1)`, [t1.id]);
ok("the warehouse cannot approve its own transfer", !selfApprove.ok,
   "otherwise a depot moves stock wherever it likes");

const approved = await as(manager, `select status from approve_stock_transfer($1)`, [t1.id]);
ok("a manager can", approved.ok && approved.rows[0].status === "approved");

// as() rolls back, so approve for real before going on.
await c.query(`select approve_stock_transfer($1)`, [t1.id]);

const emptyTransfer = (await c.query(
  `insert into stock_transfers (org_id, from_warehouse_id, to_warehouse_id)
   values ($1,$2,$3) returning id`, [orgA, accra, kumasi])).rows[0].id;
const approveEmpty = await c.query(`select approve_stock_transfer($1)`, [emptyTransfer])
  .then(() => null, e => e.message);
ok("a transfer with nothing on it is refused", approveEmpty !== null);

const sameWarehouse = await c.query(
  `insert into stock_transfers (org_id, from_warehouse_id, to_warehouse_id)
   values ($1,$2,$2) returning id`, [orgA, accra]).then(() => null, e => e.message);
ok("a transfer to the warehouse it came from is refused", sameWarehouse !== null);

// ====================================================================
console.log("\n-- in transit, the stock is nowhere --");
// ====================================================================

const accraBefore = await stockAt(accra);
const kumasiBefore = await stockAt(kumasi);

await c.query(`select dispatch_stock_transfer($1)`, [t1.id]);

ok("dispatching takes the goods off the source warehouse",
   (await stockAt(accra)) === accraBefore - 100, `${await stockAt(accra)}`);
ok("and does not put them on the destination yet",
   (await stockAt(kumasi)) === kumasiBefore,
   "they are in transit and belong to neither depot");

const transitRows = (await c.query(
  `select * from stock_in_transit where transfer_id=$1`, [t1.id])).rows;
ok("so they are reported as in transit", transitRows.length === 1
   && Number(transitRows[0].quantity) === 100, `${transitRows[0]?.quantity} units`);

const movements = (await c.query(
  `select type, quantity from stock_movements
    where reference_type='stock_transfer' and reference_id=$1 order by type`, [t1.id])).rows;
ok("recorded as a transfer, not as an adjustment",
   movements.length === 1 && movements[0].type === "transfer_out",
   movements.map(m => m.type).join(", "));

const cancelInTransit = await c.query(
  `select cancel_stock_transfer($1, 'changed my mind')`, [t1.id]).then(() => null, e => e.message);
ok("a transfer already on the road cannot be cancelled", cancelInTransit !== null,
   "cancelling would strand the goods");

// ====================================================================
console.log("\n-- what arrives is counted --");
// ====================================================================

const items = (await c.query(
  `select id, quantity from stock_transfer_items where transfer_id=$1`, [t1.id])).rows;

// 96 of the 100 arrive: four went missing on the road.
await acting(storeman, `select receive_stock_transfer($1, $2::jsonb)`,
  [t1.id, JSON.stringify([{ item_id: items[0].id, quantity: 96 }])]);

ok("receiving books in what was counted",
   (await stockAt(kumasi)) === kumasiBefore + 96, `${await stockAt(kumasi)}`);
ok("and not what was sent",
   (await stockAt(kumasi)) !== kumasiBefore + 100);

const summary = (await c.query(
  `select * from stock_transfer_summary where id=$1`, [t1.id])).rows[0];
ok("the shortfall stays on the document", Number(summary.qty_short) === 4,
   `${summary.qty_short} units never arrived`);
ok("the transfer is received", summary.status === "received");
ok("naming who received it", !!summary.received_by_name);
ok("and it is no longer in transit", (await c.query(
  `select count(*)::int n from stock_in_transit where transfer_id=$1`, [t1.id])).rows[0].n === 0);

const receiveTwice = await c.query(`select receive_stock_transfer($1)`, [t1.id])
  .then(() => null, e => e.message);
ok("a received transfer cannot be received again", receiveTwice !== null,
   "otherwise the stock lands twice");

// More cannot arrive than left.
const t2 = await draft(20);
await c.query(`select approve_stock_transfer($1)`, [t2.id]);
await c.query(`select dispatch_stock_transfer($1)`, [t2.id]);
const t2Item = (await c.query(
  `select id from stock_transfer_items where transfer_id=$1`, [t2.id])).rows[0].id;
const tooMany = await c.query(`select receive_stock_transfer($1,$2::jsonb)`,
  [t2.id, JSON.stringify([{ item_id: t2Item, quantity: 25 }])]).then(() => null, e => e.message);
ok("more cannot arrive than was sent", tooMany !== null, "it belongs on its own receipt");

// A line nobody counted is taken to have arrived in full, which is the
// common case and should not need typing.
await c.query(`select receive_stock_transfer($1)`, [t2.id]);
ok("an uncounted line is taken to have arrived in full", Number((await c.query(
  `select qty_received from stock_transfer_items where id=$1`, [t2Item])).rows[0].qty_received) === 20);

// ====================================================================
console.log("\n-- expiry survives the journey --");
// ====================================================================

const perishable = await makeProduct("EXP", true);
await c.query(
  `insert into stock_movements (org_id, product_id, warehouse_id, type, quantity, reason)
   values ($1,$2,$3,'receipt',60,'Opening')`, [orgA, perishable, accra]);
await c.query(
  `insert into product_batches (org_id, product_id, warehouse_id, batch_number,
     expires_on, qty_received, qty_remaining)
   values ($1,$2,$3,$4, current_date + 200, 60, 60)`,
  [orgA, perishable, accra, `B-SOON-${stamp}`.slice(0, 20)]);

const t3 = await draft(25, perishable);
await c.query(`select approve_stock_transfer($1)`, [t3.id]);
await c.query(`select dispatch_stock_transfer($1)`, [t3.id]);

const sourceBatch = (await c.query(
  `select qty_remaining from product_batches where product_id=$1 and warehouse_id=$2`,
  [perishable, accra])).rows[0];
ok("dispatching draws the goods out of a batch",
   Number(sourceBatch.qty_remaining) === 35, `${sourceBatch.qty_remaining} left at source`);

await c.query(`select receive_stock_transfer($1)`, [t3.id]);
const arrivedBatch = (await c.query(
  `select batch_number, expires_on, qty_remaining from product_batches
    where product_id=$1 and warehouse_id=$2`, [perishable, kumasi])).rows[0];
ok("and the batch arrives at the other depot", !!arrivedBatch);
ok("still carrying its expiry date",
   arrivedBatch?.expires_on?.toISOString().slice(0, 10) ===
     new Date(Date.now() + 200 * 864e5).toISOString().slice(0, 10),
   arrivedBatch?.expires_on?.toISOString().slice(0, 10));
ok("for the quantity that arrived", Number(arrivedBatch?.qty_remaining) === 25);
ok("under the same batch number", arrivedBatch?.batch_number === `B-SOON-${stamp}`.slice(0, 20),
   "the same batch really is in two places once a delivery is split");

// Expired stock is not somebody else's problem.
const expired = await makeProduct("OLD", true);
await c.query(
  `insert into stock_movements (org_id, product_id, warehouse_id, type, quantity, reason)
   values ($1,$2,$3,'receipt',40,'Opening')`, [orgA, expired, accra]);
await c.query(
  `insert into product_batches (org_id, product_id, warehouse_id, batch_number,
     expires_on, qty_received, qty_remaining)
   values ($1,$2,$3,$4, current_date - 5, 40, 40)`,
  [orgA, expired, accra, `B-GONE-${stamp}`.slice(0, 20)]);

const t4 = await draft(10, expired);
await c.query(`select approve_stock_transfer($1)`, [t4.id]);
const shipExpired = await c.query(`select dispatch_stock_transfer($1)`, [t4.id])
  .then(() => null, e => e.message);
ok("expired stock is not transferred to another depot", shipExpired !== null,
   "it would only relocate the write-off");
ok("and the refusal moves nothing", (await c.query(
  `select count(*)::int n from stock_movements
    where reference_type='stock_transfer' and reference_id=$1`, [t4.id])).rows[0].n === 0);

// ====================================================================
console.log("\n-- who may do what --");
// ====================================================================

const t5 = await draft(5);

const driverDrafts = await as(driver,
  `insert into stock_transfers (org_id, from_warehouse_id, to_warehouse_id)
   values ($1,$2,$3) returning id`, [orgA, accra, kumasi]);
ok("a driver cannot raise a transfer between depots",
   !driverDrafts.ok || driverDrafts.rows.length === 0);

const driverApproves = await as(driver, `select approve_stock_transfer($1)`, [t5.id]);
ok("nor approve one", !driverApproves.ok, driverApproves.error?.split("\n")[0]);

await c.query(`select approve_stock_transfer($1)`, [t5.id]);
const storemanShips = await as(storeman, `select status from dispatch_stock_transfer($1)`, [t5.id]);
ok("the warehouse dispatches what a manager approved",
   storemanShips.ok && storemanShips.rows[0].status === "in_transit");

const rivalSees = await as(rival,
  `select count(*)::int n from stock_transfers where org_id=$1`, [orgA]);
ok("another organization sees none of these transfers",
   rivalSees.ok && rivalSees.rows[0].n === 0);

const rivalApproves = await as(rival, `select approve_stock_transfer($1)`, [t5.id]);
ok("and cannot approve one of them", !rivalApproves.ok,
   rivalApproves.error?.split("\n")[0]);

const rivalShips = await as(rival, `select dispatch_stock_transfer($1)`, [t5.id]);
ok("nor dispatch one", !rivalShips.ok, rivalShips.error?.split("\n")[0]);

// ---- cancelling ----------------------------------------------------
const t6 = await draft(3);
const cancelled = (await c.query(
  `select status, cancelled_reason from cancel_stock_transfer($1, 'Ordered in error')`,
  [t6.id])).rows[0];
ok("a draft can be cancelled", cancelled.status === "cancelled");
ok("with the reason kept", cancelled.cancelled_reason === "Ordered in error");
ok("and nothing moved", (await c.query(
  `select count(*)::int n from stock_movements
    where reference_type='stock_transfer' and reference_id=$1`, [t6.id])).rows[0].n === 0);

console.log(`\n  ${pass} passed, ${fail} failed`);
await c.end();
process.exit(fail ? 1 : 0);
