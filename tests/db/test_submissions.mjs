import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { createHash, randomBytes } = require("crypto");
const { Client, CONN } = require("./lib.js");

/**
 * Suppliers submitting their own invoices, and the gaps around it.
 *
 * The submission path is the interesting one: it runs for somebody
 * holding a link rather than a session, so every check that would
 * normally be a role check has to be a link check instead - and the
 * link has to be re-examined at the moment of submission, not trusted
 * from whatever resolved it a page ago.
 */
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

const stamp = Date.now().toString(36);
const c = new Client(CONN); await c.connect();
const orgA = (await c.query("select id from organizations where slug='default'")).rows[0].id;
const orgB = (await c.query(
  `insert into organizations (name, slug) values ('Submit Rival',$1) returning id`,
  [`sub-rival-${stamp}`])).rows[0].id;

const mk = async (name, role, org = orgA) => (await c.query(
  `insert into auth.users (email, raw_user_meta_data) values ($1,$2::jsonb) returning id`,
  [`${name}-${stamp}@sub.test`, JSON.stringify({ full_name: name, role, org_id: org })])).rows[0].id;

const as = async (who, sql, params) => {
  await c.query("begin");
  await c.query("select set_config('request.jwt.claims',$1,true)",
    [JSON.stringify({ sub: who, role: "authenticated" })]);
  await c.query("set local role authenticated");
  try { return { ok: true, rows: (await c.query(sql, params)).rows }; }
  catch (e) { return { ok: false, error: e.message }; }
  finally { await c.query("rollback"); }
};

const acting = async (who, sql, params) => {
  await c.query("select set_config('request.jwt.claims',$1,false)",
    [JSON.stringify({ sub: who, role: "authenticated" })]);
  try { return (await c.query(sql, params)).rows; }
  finally { await c.query("select set_config('request.jwt.claims','',false)"); }
};

const digest = (t) => createHash("sha256").update(t).digest("hex");

const clerk    = await mk("subacc", "accountant");
const storeman = await mk("subwh", "warehouse");
const driver   = await mk("subdrv", "driver");
const rival    = await mk("subrival", "admin", orgB);

// ---- a supplier holding a link --------------------------------------
const wh = (await c.query(
  `insert into warehouses (org_id, code, name) values ($1,$2,'Submit Depot') returning id`,
  [orgA, `SUBW-${stamp}`.slice(0, 12)])).rows[0].id;
const supplier = (await c.query(
  `insert into suppliers (org_id, code, name) values ($1,$2,'Kwame Trading') returning id`,
  [orgA, `SUBS-${stamp}`.slice(0, 12)])).rows[0].id;
const otherSupplier = (await c.query(
  `insert into suppliers (org_id, code, name) values ($1,$2,'Other Trading') returning id`,
  [orgA, `SUBO-${stamp}`.slice(0, 12)])).rows[0].id;
const cat = (await c.query(
  `insert into categories (org_id, name) values ($1,$2) returning id`,
  [orgA, `Sub Cat ${stamp}`])).rows[0].id;
const product = (await c.query(
  `insert into products (org_id, sku, name, category_id, unit_of_measure, cost_price, list_price)
   values ($1,$2,'Submit Product',$3,'case',10,100) returning id`,
  [orgA, `SUBP-${stamp}`.slice(0, 20), cat])).rows[0].id;
const customer = (await c.query(
  `insert into customers (org_id, code, name, credit_limit) values ($1,$2,'Submit Customer',50000)
   returning id`, [orgA, `SUBC-${stamp}`.slice(0, 12)])).rows[0].id;

const link = randomBytes(32).toString("base64url");
const token = (await c.query(
  `select * from issue_supplier_token($1,$2,$3,30,'Accounts')`,
  [supplier, digest(link), link.slice(0, 6)])).rows[0];

const submit = (ref, opts = {}) => c.query(
  `select * from submit_supplier_document(
     $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
  [
    opts.supplier ?? supplier,
    opts.org ?? orgA,
    opts.token ?? token.id,
    opts.company ?? "Kwame Trading Ltd",
    opts.contact ?? "Ama Boateng",
    ref,
    opts.date ?? new Date().toISOString().slice(0, 10),
    opts.amount ?? 4500,
    opts.notes ?? null,
    `${orgA}/${supplier}/${randomBytes(8).toString("hex")}`,
    opts.fileName ?? "invoice.pdf",
    opts.mime ?? "application/pdf",
    opts.size ?? 120000,
  ]);

// ====================================================================
console.log("\n-- a supplier sends an invoice --");
// ====================================================================

const sent = (await submit("KT-4471")).rows[0];
ok("a supplier can submit through their link", !!sent);
ok("it arrives as received, not approved", sent.status === "received",
   `${sent.status} - nobody here has looked at it yet`);
ok("with the number they typed", sent.reference === "KT-4471");
ok("and the amount they typed", Number(sent.amount) === 4500);
ok("recorded as an invoice", sent.kind === "invoice");
ok("keeping the company name they gave",
   sent.submitted_company === "Kwame Trading Ltd",
   "which is not always the name we hold them under");
ok("and who sent it", sent.submitted_by_name === "Ama Boateng");
ok("stamped with when", sent.submitted_at !== null);
ok("and which link it came through", sent.submitted_via_token === token.id);

const arrival = (await c.query(
  `select * from notifications where kind='supplier.invoice_received'
    and subject_id=$1`, [sent.id])).rows[0];
ok("the office is told it arrived", !!arrival, arrival?.title);
ok("addressed to the accountant", arrival?.recipient_role === "accountant");
ok("with the amount in the message", arrival?.body?.includes("4,500"), arrival?.body);
ok("and a link to the supplier", arrival?.link === `/suppliers/${supplier}`);

const noNumber = await submit("   ").then(() => null, e => e.message);
ok("an invoice with no number is refused", noNumber !== null);

const negative = await submit("KT-NEG", { amount: -100 }).then(() => null, e => e.message);
ok("and one for a negative amount", negative !== null);

// ====================================================================
console.log("\n-- the link is checked at the moment of submission --");
// ====================================================================

const forOther = await submit("KT-9999", { supplier: otherSupplier })
  .then(() => null, e => e.message);
ok("a link cannot be used for a different supplier", forOther !== null,
   "the token is matched to the supplier, not just looked up");

const wrongOrg = await submit("KT-8888", { org: orgB }).then(() => null, e => e.message);
ok("nor for a different organization", wrongOrg !== null);

const madeUp = await submit("KT-7777", {
  token: "00000000-0000-0000-0000-000000000000",
}).then(() => null, e => e.message);
ok("a link nobody issued is refused", madeUp !== null);

// Revoking has to stop a submission already on its way.
const doomed = randomBytes(32).toString("base64url");
const doomedToken = (await c.query(
  `select * from issue_supplier_token($1,$2,$3,30)`,
  [supplier, digest(doomed), doomed.slice(0, 6)])).rows[0];
await c.query(`select revoke_supplier_token($1)`, [doomedToken.id]);
const afterRevoke = await submit("KT-6666", { token: doomedToken.id })
  .then(() => null, e => e.message);
ok("a revoked link stops a submission in flight", afterRevoke !== null,
   "the link is re-checked here, not trusted from whatever resolved it");

const stale = randomBytes(32).toString("base64url");
const staleToken = (await c.query(
  `select * from issue_supplier_token($1,$2,$3,1)`,
  [supplier, digest(stale), stale.slice(0, 6)])).rows[0];
await c.query(
  `update supplier_portal_tokens
      set created_at = now() - interval '2 days', expires_at = now() - interval '1 hour'
    where id=$1`, [staleToken.id]);
const afterExpiry = await submit("KT-5555", { token: staleToken.id })
  .then(() => null, e => e.message);
ok("and an expired one", afterExpiry !== null);

// ====================================================================
console.log("\n-- somebody here reviews it --");
// ====================================================================

const reviewing = (await acting(clerk,
  `select * from review_supplier_document($1,'reviewing')`, [sent.id]))[0];
ok("an accountant can pick it up", reviewing.status === "reviewing");
ok("recording who", reviewing.reviewed_by === clerk);

const noReason = await c.query(
  `select review_supplier_document($1,'rejected')`, [sent.id]).then(() => null, e => e.message);
ok("rejecting without saying why is refused", noReason !== null,
   "otherwise the supplier sends the same thing again");

const rejected = (await acting(clerk,
  `select * from review_supplier_document($1,'rejected','The quantities do not match GRN 118')`,
  [sent.id]))[0];
ok("rejecting with a reason works", rejected.status === "rejected");
ok("and the reason is kept", rejected.review_note === "The quantities do not match GRN 118");

const approved = (await acting(clerk,
  `select * from review_supplier_document($1,'approved','Matched to PO')`, [sent.id]))[0];
ok("and it can then be approved", approved.status === "approved");

const backToPending = await c.query(
  `select review_supplier_document($1,'pending')`, [sent.id]).then(() => null, e => e.message);
ok("a review cannot set it back to pending", backToPending !== null,
   "pending means nothing has arrived, which is no longer true");

const driverReviews = await as(driver,
  `select review_supplier_document($1,'approved')`, [sent.id]);
ok("a driver cannot approve an invoice", !driverReviews.ok,
   driverReviews.error?.split("\n")[0]);

const storeReviews = await as(storeman,
  `select review_supplier_document($1,'approved')`, [sent.id]);
ok("nor can the warehouse", !storeReviews.ok,
   "approving an invoice is agreeing to pay it");

const rivalReviews = await as(rival,
  `select review_supplier_document($1,'approved')`, [sent.id]);
ok("nor another organization", !rivalReviews.ok, rivalReviews.error?.split("\n")[0]);

// ---- what the supplier sees back ------------------------------------
await submit("KT-4472");
const theirView = (await c.query(
  `select * from supplier_portal_documents($1,$2)`, [supplier, orgA])).rows;
ok("a supplier sees what they have sent", theirView.length === 2, `${theirView.length}`);

const rejectedRow = theirView.find((r) => r.status === "approved");
ok("and the status of each", !!rejectedRow);

const withNote = (await c.query(
  `select * from supplier_portal_documents($1,$2)`, [supplier, orgA])).rows
  .find((r) => r.id === sent.id);
ok("an internal note on an approved document is not shown to them",
   withNote?.review_note === null,
   "only a rejection reason is theirs to see");

const notTheirs = (await c.query(
  `select * from supplier_portal_documents($1,$2)`, [otherSupplier, orgA])).rows;
ok("and nothing another supplier sent", notTheirs.length === 0);

// ====================================================================
console.log("\n-- what we owe suppliers --");
// ====================================================================

const order = (await c.query(
  `insert into purchase_orders (org_id, supplier_id, warehouse_id, status, order_date,
     supplier_invoice_number, supplier_invoice_date)
   values ($1,$2,$3,'submitted', current_date, 'KT-4471', current_date) returning id, po_number`,
  [orgA, supplier, wh])).rows[0];
ok("a purchase order can carry the supplier's own reference", !!order,
   "what they quote when they ring about payment");

await c.query(
  `insert into purchase_order_items (org_id, po_id, product_id, quantity, unit_cost, tax_rate)
   values ($1,$2,$3,50,10,0)`, [orgA, order.id, product]);

const payable = (await c.query(
  `select * from supplier_payables where supplier_id=$1`, [supplier])).rows[0];
ok("a payable summary exists per supplier", !!payable);
ok("counting their open orders", Number(payable.open_orders) === 1);
ok("and what they have billed us", Number(payable.invoiced_value) > 0,
   `₵${payable.invoiced_value}`);

// Receiving a delivery tells the accountant, so the invoice can be matched.
await c.query(`select receive_purchase_line(
  (select id from purchase_order_items where po_id=$1 limit 1), 50)`, [order.id]);
const receivedNote = (await c.query(
  `select * from notifications where kind='purchase.received' and subject_id=$1`,
  [order.id])).rows[0];
ok("booking in a delivery tells the accountant", !!receivedNote, receivedNote?.title);
ok("naming the order", receivedNote?.body?.includes(order.po_number), receivedNote?.body);

// ====================================================================
console.log("\n-- the smaller gaps --");
// ====================================================================

// ---- invoices carry a discount --------------------------------------
const discounted = (await c.query(
  `insert into invoices (org_id, customer_id, status, subtotal, discount, total)
   values ($1,$2,'issued', 1000, 150, 850) returning *`, [orgA, customer])).rows[0];
ok("an invoice can carry a discount", Number(discounted.discount) === 150);
ok("kept apart from the line prices", Number(discounted.subtotal) === 1000,
   "so it can be reported on rather than buried in a reduced price");
ok("and the balance reflects the discounted total",
   Number(discounted.balance) === 850, `₵${discounted.balance}`);

const negativeDiscount = await c.query(
  `insert into invoices (org_id, customer_id, subtotal, discount, total)
   values ($1,$2,100,-10,110)`, [orgA, customer]).then(() => null, e => e.message);
ok("a negative discount is refused", negativeDiscount !== null);

// ---- returns have a reason worth counting ---------------------------
const reasons = (await c.query(
  `select unnest(enum_range(null::return_reason))::text r`)).rows.map((x) => x.r);
ok("returns have structured reasons",
   ["damaged", "expired", "wrong_item", "customer_return", "unsold", "other"]
     .every((r) => reasons.includes(r)),
   reasons.join(", "));

// ---- a customer bringing goods back ---------------------------------
await c.query(
  `insert into stock_movements (org_id, product_id, warehouse_id, type, quantity, reason)
   values ($1,$2,$3,'receipt',200,'Opening')`, [orgA, product, wh]);

const before = Number((await c.query(
  `select qty_on_hand q from inventory where product_id=$1 and warehouse_id=$2`,
  [product, wh])).rows[0].q);

const customerReturn = (await c.query(
  `select * from record_stock_return($1,'wrong_item',$2::jsonb,$3,null,'Sent the wrong size')`,
  [wh, JSON.stringify([{ product_id: product, quantity: 6 }]), customer])).rows[0];
ok("a customer return can be recorded", !!customerReturn);
ok("numbered", /^RTN-\d{4}-\d{6}$/.test(customerReturn.return_number),
   customerReturn.return_number);

const after = Number((await c.query(
  `select qty_on_hand q from inventory where product_id=$1 and warehouse_id=$2`,
  [product, wh])).rows[0].q);
ok("and the stock comes back in", after === before + 6, `${before} to ${after}`);

const movement = (await c.query(
  `select type, reason from stock_movements
    where reference_type='stock_return' and reference_id=$1`, [customerReturn.id])).rows[0];
ok("through the ledger as a customer return, not an adjustment",
   movement.type === "customer_return", movement.type);
ok("carrying the reason", movement.reason === "wrong_item");

// ---- goods going back to a supplier ---------------------------------
const supplierReturn = (await c.query(
  `select * from record_stock_return($1,'damaged',$2::jsonb,null,$3,'Crushed in transit')`,
  [wh, JSON.stringify([{ product_id: product, quantity: 4 }]), supplier])).rows[0];
const afterOut = Number((await c.query(
  `select qty_on_hand q from inventory where product_id=$1 and warehouse_id=$2`,
  [product, wh])).rows[0].q);
ok("goods can go back to a supplier", !!supplierReturn);
ok("and the stock leaves", afterOut === after - 4, `${after} to ${afterOut}`);

const tooMany = await c.query(
  `select record_stock_return($1,'damaged',$2::jsonb,null,$3)`,
  [wh, JSON.stringify([{ product_id: product, quantity: 99999 }]), supplier])
  .then(() => null, e => e.message);
ok("more cannot go back than is on hand", tooMany !== null);

const both = await c.query(
  `select record_stock_return($1,'other',$2::jsonb,$3,$4)`,
  [wh, JSON.stringify([{ product_id: product, quantity: 1 }]), customer, supplier])
  .then(() => null, e => e.message);
ok("a return is from a customer or to a supplier, never both", both !== null);

const summary = (await c.query(
  `select * from stock_return_summary where id=$1`, [customerReturn.id])).rows[0];
ok("returns are summarised with the party and direction",
   summary.direction === "customer" && summary.party_name === "Submit Customer",
   `${summary.direction} / ${summary.party_name}`);

const driverReturns = await as(driver,
  `select record_stock_return($1,'damaged',$2::jsonb,$3,null)`,
  [wh, JSON.stringify([{ product_id: product, quantity: 1 }]), customer]);
ok("a driver cannot record a warehouse return", !driverReturns.ok,
   driverReturns.error?.split("\n")[0]);

// ---- waybills record what did not arrive ----------------------------
const van = (await c.query(
  `insert into vans (org_id, code, registration_no, home_warehouse_id) values ($1,$2,$3,$4)
   returning id`, [orgA, `SUBV-${stamp}`.slice(0, 12), `GS-${stamp}`.slice(0, 14), wh])).rows[0].id;
const waybill = (await c.query(
  `insert into waybills (org_id, status, van_id, from_warehouse_id)
   values ($1,'issued',$2,$3) returning id, waybill_number`, [orgA, van, wh])).rows[0];
const wbItem = (await c.query(
  `insert into waybill_items (org_id, waybill_id, product_id, quantity)
   values ($1,$2,$3,100) returning id`, [orgA, waybill.id, product])).rows[0].id;

const signed = (await acting(storeman,
  `select * from receive_waybill($1,'Yaw Mensah',$2::jsonb)`,
  [waybill.id, JSON.stringify([{ item_id: wbItem, damaged: 3, short: 2 }])]))[0];
ok("a waybill can be signed for", signed.status === "delivered");
ok("recording who took the goods", signed.received_by === "Yaw Mensah");

const wbLine = (await c.query(
  `select * from waybill_items where id=$1`, [wbItem])).rows[0];
ok("with what was damaged", Number(wbLine.qty_damaged) === 3);
ok("what never turned up", Number(wbLine.qty_short) === 2);
ok("and what actually arrived", Number(wbLine.qty_received) === 95, `${wbLine.qty_received}`);

const overReport = await c.query(
  `select receive_waybill($1,'Someone',$2::jsonb)`,
  [waybill.id, JSON.stringify([{ item_id: wbItem, damaged: 200, short: 0 }])])
  .then(() => null, e => e.message);
ok("more cannot be damaged than was on the waybill", overReport !== null);

const unsigned = await c.query(`select receive_waybill($1,'   ')`, [waybill.id])
  .then(() => null, e => e.message);
ok("and it cannot be signed by nobody", unsigned !== null);

console.log(`\n  ${pass} passed, ${fail} failed`);
await c.end();
process.exit(fail ? 1 : 0);
