import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Client, CONN } = require("./lib.js");

/**
 * Invoices, receipts and waybills.
 *
 * These tables have existed since the first migration and nothing ever
 * wrote to them, which is why the Credit screen - which reads
 * invoice_ageing - showed nothing however much the business was owed.
 *
 * What is being proved here is mostly that the documents follow the
 * money on their own. An invoice that depends on somebody remembering
 * to raise it is how a wholesaler loses track of a debt, so the tests
 * complete sales and then look for the paperwork rather than asking for
 * it.
 */
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

const stamp = Date.now().toString(36);
const c = new Client(CONN); await c.connect();
const orgA = (await c.query("select id from organizations where slug='default'")).rows[0].id;
const orgB = (await c.query(
  `insert into organizations (name, slug) values ('Doc Rival',$1) returning id`,
  [`doc-rival-${stamp}`])).rows[0].id;

const mk = async (name, role, org = orgA) => (await c.query(
  `insert into auth.users (email, raw_user_meta_data) values ($1,$2::jsonb) returning id`,
  [`${name}-${stamp}@doc.test`, JSON.stringify({ full_name: name, role, org_id: org })])).rows[0].id;

/** Run as a signed-in user, then roll back. */
const as = async (who, sql, params) => {
  await c.query("begin");
  await c.query("select set_config('request.jwt.claims',$1,true)",
    [JSON.stringify({ sub: who, role: "authenticated" })]);
  await c.query("set local role authenticated");
  try { return { ok: true, rows: (await c.query(sql, params)).rows }; }
  catch (e) { return { ok: false, error: e.message }; }
  finally { await c.query("rollback"); }
};

const driver   = await mk("docdrv", "driver");
const other    = await mk("docdrv2", "driver");
const manager  = await mk("docmgr", "manager");
const rival    = await mk("docrival", "admin", orgB);

// ---- a van with stock on it ----------------------------------------
const wh = (await c.query(
  `insert into warehouses (org_id, code, name) values ($1,$2,'Doc Depot') returning id`,
  [orgA, `DOCWH-${stamp}`.slice(0, 12)])).rows[0].id;
const cat = (await c.query(
  `insert into categories (org_id, name) values ($1,$2) returning id`,
  [orgA, `Doc Cat ${stamp}`])).rows[0].id;
const product = (await c.query(
  `insert into products (org_id, sku, name, category_id, unit_of_measure, cost_price, list_price, tax_rate)
   values ($1,$2,'Doc Product',$3,'case',10,100,0) returning id`,
  [orgA, `DOC-${stamp}`.slice(0, 20), cat])).rows[0].id;
// 14 day terms, so a due date that is not the schema's default 30.
const customer = (await c.query(
  `insert into customers (org_id, code, name, credit_limit, payment_terms_days, phone, billing_address)
   values ($1,$2,'Doc Customer',500000,14,'024 000 0000','Kaneshie, Accra') returning id`,
  [orgA, `DOCC-${stamp}`.slice(0, 12)])).rows[0].id;
const van = (await c.query(
  `insert into vans (org_id, code, registration_no, home_warehouse_id) values ($1,$2,$3,$4) returning id`,
  [orgA, `DOCV-${stamp}`.slice(0, 12), `GD-${stamp}`.slice(0, 14), wh])).rows[0].id;
await c.query(`insert into van_assignments (org_id, van_id, driver_id) values ($1,$2,$3)`,
  [orgA, van, driver]);
await c.query(
  `insert into stock_movements (org_id, product_id, warehouse_id, type, quantity, reason)
   values ($1,$2,$3,'receipt',2000,'Opening')`, [orgA, product, wh]);

const load = (await c.query(
  `insert into van_loads (org_id, van_id, driver_id, warehouse_id, status, load_date,
     driver_confirmed_at, opening_float)
   values ($1,$2,$3,$4,'loaded',current_date, now(), 100) returning id, load_number`,
  [orgA, van, driver, wh])).rows[0];
await c.query(
  `insert into van_load_items (org_id, load_id, product_id, qty_loaded, unit_price, unit_cost)
   values ($1,$2,$3,1000,100,10)`, [orgA, load.id, product]);
await c.query(`select dispatch_van_load($1)`, [load.id]);

/** A completed sale of `qty` at ₵100 each. */
const sell = async (qty, saleType, paid = 0, payments = null, buyer = customer) => {
  const sale = (await c.query(
    `insert into van_sales (org_id, load_id, van_id, driver_id, customer_id,
       sale_type, status, sold_at)
     values ($1,$2,$3,$4,$5,$6,'draft',now()) returning id`,
    [orgA, load.id, van, driver, buyer, saleType])).rows[0];
  await c.query(
    `insert into van_sale_items (org_id, sale_id, product_id, quantity, unit_price, tax_rate)
     values ($1,$2,$3,$4,100,0)`, [orgA, sale.id, product, qty]);
  if (payments) {
    await c.query(`select record_sale_payments($1,$2::jsonb)`, [sale.id, JSON.stringify(payments)]);
  }
  await c.query(`select complete_van_sale($1,$2)`, [sale.id, paid]);
  return sale.id;
};

/** A customer with plenty of credit and 14 day terms. */
const buyer = async (label) => (await c.query(
  `insert into customers (org_id, code, name, credit_limit, payment_terms_days)
   values ($1,$2,$3,500000,14) returning id`,
  [orgA, `DC${label}-${stamp}`.slice(0, 12), `Doc ${label}`])).rows[0].id;

const invoiceFor = async (saleId) => (await c.query(
  `select * from invoices where van_sale_id = $1`, [saleId])).rows[0];

// ====================================================================
console.log("\n-- an invoice arrives on its own --");
// ====================================================================

const cashSale = await sell(2, "cash", 200);
ok("a cash sale raises no invoice", (await invoiceFor(cashSale)) === undefined,
   "settled at the door; there is nothing to chase");

const creditSale = await sell(5, "credit");
const inv1 = await invoiceFor(creditSale);
ok("completing a credit sale raises an invoice", !!inv1);
ok("numbered as an invoice", /^INV-\d{4}-\d{6}$/.test(inv1?.invoice_number || ""),
   inv1?.invoice_number);
ok("for the full value of the sale", Number(inv1.total) === 500, `₵${inv1.total}`);
ok("issued, not draft", inv1.status === "issued", inv1.status);
ok("due on the customer's own terms, not the schema default",
   inv1.due_date.toISOString().slice(0, 10) ===
     new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10),
   `${inv1.due_date.toISOString().slice(0, 10)} (14 day terms)`);

// Raising it again must not produce a second document for one debt.
const again = (await c.query(`select * from issue_invoice_for_sale($1)`, [creditSale])).rows[0];
ok("raising it twice returns the invoice already raised", again.id === inv1.id);
ok("and there is still only one", (await c.query(
  `select count(*)::int n from invoices where van_sale_id=$1`, [creditSale])).rows[0].n === 1);

const dupe = await c.query(
  `insert into invoices (org_id, van_sale_id, customer_id, total)
   values ($1,$2,$3,1) returning id`, [orgA, creditSale, customer]).then(() => null, e => e.message);
ok("and the database refuses a second one outright", dupe !== null,
   "one invoice per sale, enforced by index");

// ====================================================================
console.log("\n-- money put down at the door --");
// ====================================================================

// ₵400 sold, ₵150 paid on mobile money at the door, ₵250 on account.
const depositCustomer = await buyer("DEP");
const deposited = await sell(4, "credit", 150,
  [{ method: "mobile_money", amount: 150, reference: "MM-77123" }], depositCustomer);
const inv2 = await invoiceFor(deposited);
ok("the invoice is still raised for the whole sale", Number(inv2.total) === 400, `₵${inv2.total}`);
ok("the deposit shows as paid", Number(inv2.amount_paid) === 150, `₵${inv2.amount_paid}`);
ok("and the balance is what is actually owed", Number(inv2.balance) === 250, `₵${inv2.balance}`);
ok("part paid, not issued", inv2.status === "partially_paid", inv2.status);

const deposit = (await c.query(
  `select * from payments where invoice_id=$1`, [inv2.id])).rows;
ok("the deposit is a payment, so it can be receipted", deposit.length === 1);
ok("receipted by the method it was taken with", deposit[0]?.method === "mobile_money",
   deposit[0]?.method);
ok("carrying the momo transaction id", deposit[0]?.reference === "MM-77123");
ok("and numbered as a receipt", /^PAY-\d{4}-\d{6}$/.test(deposit[0]?.payment_number || ""),
   deposit[0]?.payment_number);

// The bug this shape exists to avoid: amount_paid is recalculated from
// the payments table, so a deposit written into the column instead of
// as a payment is erased by the first collection.
await c.query(`select record_credit_payment($1, 50, 'cash', 'Part settlement')`,
  [depositCustomer]);
const afterCollection = (await c.query(`select * from invoices where id=$1`, [inv2.id])).rows[0];
ok("a later collection does not erase the deposit",
   Number(afterCollection.amount_paid) === 200, `₵${afterCollection.amount_paid} (150 + 50)`);

// ====================================================================
console.log("\n-- a collection settles the oldest debt first --");
// ====================================================================

// Two debts, one long overdue and one not yet due. Nothing else is
// open against this customer, so where the money lands says exactly
// which one the function chose.
const debtor = await buyer("AGE");
const oldest = (await c.query(
  `insert into invoices (org_id, customer_id, status, issue_date, due_date, subtotal, total)
   values ($1,$2,'issued', current_date - 90, current_date - 60, 300, 300) returning *`,
  [orgA, debtor])).rows[0];
const newest = (await c.query(
  `insert into invoices (org_id, customer_id, status, issue_date, due_date, subtotal, total)
   values ($1,$2,'issued', current_date, current_date + 30, 300, 300) returning *`,
  [orgA, debtor])).rows[0];

// Enough to clear the oldest and start on the next.
await c.query(`select record_credit_payment($1, 400, 'mobile_money', 'MM-88214')`, [debtor]);
const oldestAfter = (await c.query(`select * from invoices where id=$1`, [oldest.id])).rows[0];
ok("the oldest invoice is settled first", Number(oldestAfter.balance) === 0, `₵${oldestAfter.balance}`);
ok("and marked paid", oldestAfter.status === "paid", oldestAfter.status);

const spill = (await c.query(`select * from invoices where id=$1`, [newest.id])).rows[0];
ok("and the remainder carries onto the next", Number(spill.amount_paid) === 100,
   `₵${spill.amount_paid}`);
ok("which is only part paid", spill.status === "partially_paid", spill.status);

const receipts = (await c.query(
  `select * from payments where invoice_id in ($1,$2) order by amount desc`,
  [oldest.id, newest.id])).rows;
ok("one collection can produce a receipt against each invoice it touched",
   receipts.length === 2, `${receipts.length} receipts`);
ok("recorded with the method the customer paid by",
   receipts.every(r => r.method === "mobile_money"));

const ledger = (await c.query(
  `select coalesce(sum(amount),0) s from credit_transactions
    where customer_id=$1 and type='payment'`, [debtor])).rows[0].s;
ok("and the customer's ledger moves by what was collected",
   Number(ledger) === -400, `₵${ledger}`);

// Money beyond what is owed stays on account rather than being forced
// onto an invoice that has not been raised yet.
const owedBefore = (await c.query(
  `select coalesce(sum(balance),0) s from invoices
    where customer_id=$1 and status not in ('paid','void')`, [debtor])).rows[0].s;
await c.query(`select record_credit_payment($1, $2, 'cash', 'Clearing the account')`,
  [debtor, Number(owedBefore) + 1000]);
const owedAfter = (await c.query(
  `select coalesce(sum(balance),0) s from invoices
    where customer_id=$1 and status not in ('paid','void')`, [debtor])).rows[0].s;
ok("an overpayment clears every invoice", Number(owedAfter) === 0, `₵${owedAfter}`);
const overpaid = (await c.query(
  `select count(*)::int n from invoices where customer_id=$1 and amount_paid > total`,
  [debtor])).rows[0].n;
ok("without pushing any invoice past its own value", overpaid === 0,
   "the excess is money on account");

const refused = await c.query(`select record_credit_payment($1, -5)`, [debtor])
  .then(() => null, e => e.message);
ok("a negative collection is refused", refused !== null);

// ====================================================================
console.log("\n-- what the office can now see --");
// ====================================================================

const ageing = (await c.query(
  `select * from invoice_ageing where customer_id=$1`, [customer])).rows;
ok("credit ageing is no longer empty", ageing.length > 0, `${ageing.length} invoices`);
ok("with a bucket on every row", ageing.every(r => !!r.bucket));

const detail = (await c.query(
  `select * from invoice_detail where id=$1`, [inv1.id])).rows[0];
ok("an invoice can be printed with the customer on it",
   detail.customer_name === "Doc Customer" && detail.customer_phone === "024 000 0000");
ok("and the sale it came from", detail.sale_number?.startsWith("VS-"), detail.sale_number);
ok("an invoice carries no cost price",
   !Object.keys(detail).some(k => /cost|margin/i.test(k)),
   "a customer document shows what they were charged");

const receipt = (await c.query(
  `select * from receipt_detail where invoice_number=$1 limit 1`, [inv2.invoice_number])).rows[0];
ok("a receipt can be printed with the invoice it settles",
   receipt?.invoice_number === inv2.invoice_number);
ok("showing what is still outstanding after it", receipt?.invoice_balance !== undefined);

// ====================================================================
console.log("\n-- the goods travel with a document --");
// ====================================================================

const wb = (await c.query(`select * from issue_waybill_for_load($1)`, [load.id])).rows[0];
ok("a dispatched load can be given a waybill", !!wb);
ok("numbered as one", /^WB-\d{4}-\d{6}$/.test(wb?.waybill_number || ""), wb?.waybill_number);
ok("issued, naming the van and the driver",
   wb.status === "issued" && wb.van_id === van && wb.driver_id === driver);
ok("and pointing back at the load it evidences",
   wb.reference_type === "van_load" && wb.reference_id === load.id);

const wbItems = (await c.query(
  `select * from waybill_items where waybill_id=$1`, [wb.id])).rows;
ok("listing what went out", wbItems.length === 1 && Number(wbItems[0].quantity) === 1000,
   `${wbItems[0]?.quantity} units`);

const wbAgain = (await c.query(`select * from issue_waybill_for_load($1)`, [load.id])).rows[0];
ok("issuing it twice returns the one already issued", wbAgain.id === wb.id);
ok("and does not duplicate the lines", (await c.query(
  `select count(*)::int n from waybill_items where waybill_id=$1`, [wb.id])).rows[0].n === 1);

const noDestination = await c.query(
  `insert into waybills (org_id, status) values ($1,'draft')`, [orgA])
  .then(() => null, e => e.message);
ok("a waybill going nowhere is refused", noDestination !== null,
   "it has to name a van, a customer or a destination");

const zeroQty = await c.query(
  `insert into waybill_items (org_id, waybill_id, product_id, quantity)
   values ($1,$2,$3,0)`, [orgA, wb.id, product]).then(() => null, e => e.message);
ok("and a line for nothing is refused", zeroQty !== null);

// ====================================================================
console.log("\n-- who may see and touch the paperwork --");
// ====================================================================

const driverSees = await as(driver, `select count(*)::int n from waybills where id=$1`, [wb.id]);
ok("a driver sees the waybill for their own round",
   driverSees.ok && driverSees.rows[0].n === 1);

const otherSees = await as(other, `select count(*)::int n from waybills where id=$1`, [wb.id]);
ok("another driver does not", otherSees.ok && otherSees.rows[0].n === 0);

const mgrSees = await as(manager, `select count(*)::int n from waybills where id=$1`, [wb.id]);
ok("the office sees all of them", mgrSees.ok && mgrSees.rows[0].n === 1);

// The lines have to follow the document. A waybill nobody may read
// whose contents are readable would list a competitor's whole load.
const otherLines = await as(other,
  `select count(*)::int n from waybill_items where waybill_id=$1`, [wb.id]);
ok("and the lines are hidden from whoever cannot see the waybill",
   otherLines.ok && otherLines.rows[0].n === 0);
const driverLines = await as(driver,
  `select count(*)::int n from waybill_items where waybill_id=$1`, [wb.id]);
ok("but visible to the driver carrying them",
   driverLines.ok && driverLines.rows[0].n === 1);

const driverWrites = await as(driver,
  `insert into waybills (org_id, van_id, status) values ($1,$2,'issued') returning id`,
  [orgA, van]);
ok("a driver cannot write their own waybill",
   !driverWrites.ok || driverWrites.rows.length === 0,
   "goods are signed out by the warehouse, not by whoever carries them");

// ---- tenants ------------------------------------------------------
const rivalInvoices = await as(rival,
  `select count(*)::int n from invoices where org_id=$1`, [orgA]);
ok("another organization sees none of these invoices",
   rivalInvoices.ok && rivalInvoices.rows[0].n === 0);

const rivalWaybills = await as(rival,
  `select count(*)::int n from waybills where org_id=$1`, [orgA]);
ok("nor any of the waybills", rivalWaybills.ok && rivalWaybills.rows[0].n === 0);

const rivalRaises = await as(rival, `select issue_invoice_for_sale($1)`, [creditSale]);
ok("and cannot raise an invoice against another organization's sale",
   !rivalRaises.ok, rivalRaises.error?.split("\n")[0]);

const rivalWaybill = await as(rival, `select issue_waybill_for_load($1)`, [load.id]);
ok("nor a waybill against its load", !rivalWaybill.ok,
   rivalWaybill.error?.split("\n")[0]);

const rivalCollects = await as(rival, `select record_credit_payment($1, 10)`, [customer]);
ok("nor take a payment off its customer", !rivalCollects.ok,
   rivalCollects.error?.split("\n")[0]);

console.log(`\n  ${pass} passed, ${fail} failed`);
await c.end();
process.exit(fail ? 1 : 0);
