import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Client, CONN } = require("./lib.js");

/**
 * Telling people what needs them.
 *
 * The distinction this suite exists to protect is between something
 * that happened once and something that is true until it stops. A
 * driver closing their day happened; stock being below its reorder
 * point is a state. Treating the second like the first buries the
 * warehouse under a new copy of the same fact every time a screen
 * loads, which is how people learn to ignore the bell.
 */
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

const stamp = Date.now().toString(36);
const c = new Client(CONN); await c.connect();

// Its own organization, so counts are about this suite's data and not
// about whatever the demo seed left behind.
const org = (await c.query(
  `insert into organizations (name, slug) values ('Notify Co',$1) returning id`,
  [`notify-${stamp}`])).rows[0].id;
const other = (await c.query(
  `insert into organizations (name, slug) values ('Notify Rival',$1) returning id`,
  [`notify-rival-${stamp}`])).rows[0].id;

const mk = async (name, role, o = org) => (await c.query(
  `insert into auth.users (email, raw_user_meta_data) values ($1,$2::jsonb) returning id`,
  [`${name}-${stamp}@ntf.test`, JSON.stringify({ full_name: name, role, org_id: o })])).rows[0].id;

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

const manager  = await mk("ntfmgr", "manager");
const storeman = await mk("ntfwh", "warehouse");
const clerk    = await mk("ntfacc", "accountant");
const driver   = await mk("ntfdrv", "driver");
const rival    = await mk("ntfrival", "manager", other);

const inbox = async (kind) => (await c.query(
  `select * from notifications where org_id=$1 and kind=$2 and resolved_at is null
    order by created_at desc`, [org, kind])).rows;

const refresh = async () => (await c.query(
  `select refresh_standing_alerts($1) n`, [org])).rows[0].n;

// ---- a warehouse with something in it -------------------------------
const wh = (await c.query(
  `insert into warehouses (org_id, code, name) values ($1,$2,'Notify Depot') returning id`,
  [org, `NTFW-${stamp}`.slice(0, 12)])).rows[0].id;
const cat = (await c.query(
  `insert into categories (org_id, name) values ($1,$2) returning id`,
  [org, `Ntf Cat ${stamp}`])).rows[0].id;
const product = (await c.query(
  `insert into products (org_id, sku, name, category_id, unit_of_measure,
     cost_price, list_price, tax_rate, reorder_point)
   values ($1,$2,'Notify Product',$3,'case',10,100,0,50) returning id`,
  [org, `NTF-${stamp}`.slice(0, 20), cat])).rows[0].id;
const customer = (await c.query(
  `insert into customers (org_id, code, name, credit_limit) values ($1,$2,'Notify Customer',1000)
   returning id`, [org, `NTFC-${stamp}`.slice(0, 12)])).rows[0].id;

// ====================================================================
console.log("\n-- something happened --");
// ====================================================================

const t = (await c.query(
  `insert into stock_transfers (org_id, from_warehouse_id, to_warehouse_id)
   values ($1,$2,$2) returning id`, [org, wh]).catch(() => null));

const wh2 = (await c.query(
  `insert into warehouses (org_id, code, name) values ($1,$2,'Notify Depot 2') returning id`,
  [org, `NTFW2-${stamp}`.slice(0, 12)])).rows[0].id;

const transfer = (await c.query(
  `insert into stock_transfers (org_id, from_warehouse_id, to_warehouse_id)
   values ($1,$2,$3) returning id, transfer_number`, [org, wh, wh2])).rows[0];

const raised = await inbox("transfer.awaiting_approval");
ok("raising a transfer tells a manager", raised.length === 1);
ok("naming the transfer", raised[0]?.title.includes(transfer.transfer_number),
   raised[0]?.title);
ok("addressed to the job rather than to one person",
   raised[0]?.recipient_role === "manager" && raised[0]?.recipient_id === null,
   "the named manager might be on leave");
ok("and leading somewhere", raised[0]?.link === `/transfers/${transfer.id}`, raised[0]?.link);
ok("recorded as an event, not a condition", raised[0]?.standing === false);

// Two transfers really are two things to approve.
await c.query(
  `insert into stock_transfers (org_id, from_warehouse_id, to_warehouse_id) values ($1,$2,$3)`,
  [org, wh, wh2]);
ok("two transfers are two notifications", (await inbox("transfer.awaiting_approval")).length === 2);

// ====================================================================
console.log("\n-- something is true until it stops --");
// ====================================================================

// 10 on hand against a reorder point of 50.
await c.query(
  `insert into stock_movements (org_id, product_id, warehouse_id, type, quantity, reason)
   values ($1,$2,$3,'receipt',10,'Opening')`, [org, product, wh]);

await refresh();
let low = await inbox("stock.low");
ok("stock below its reorder point is flagged", low.length === 1, low[0]?.title);
ok("to the warehouse", low[0]?.recipient_role === "warehouse");
ok("as a condition", low[0]?.standing === true);

await refresh();
await refresh();
low = await inbox("stock.low");
ok("refreshing three times leaves one notification, not three", low.length === 1,
   "otherwise the bell fills up with the same fact");

// Reading it, then refreshing while nothing has changed, must not shout
// again.
await c.query(`update notifications set read_at = now() where id = $1`, [low[0].id]);
await refresh();
ok("a condition already read stays read while it is unchanged",
   (await c.query(`select read_at from notifications where id=$1`, [low[0].id]))
     .rows[0].read_at !== null);

// Bring the stock up. The condition has ended.
await c.query(
  `insert into stock_movements (org_id, product_id, warehouse_id, type, quantity, reason)
   values ($1,$2,$3,'receipt',200,'Replenishment')`, [org, product, wh]);
await refresh();
ok("replenishing clears it without anybody dismissing it",
   (await inbox("stock.low")).length === 0);

// And it comes back if it happens again.
await c.query(
  `insert into stock_movements (org_id, product_id, warehouse_id, type, quantity, reason)
   values ($1,$2,$3,'adjustment_out',205,'Sold out')`, [org, product, wh]);
await refresh();
ok("and returns when it happens again", (await inbox("stock.low")).length === 1);

// ====================================================================
console.log("\n-- money that is late --");
// ====================================================================

await c.query(
  `insert into invoices (org_id, customer_id, status, issue_date, due_date, subtotal, total)
   values ($1,$2,'issued', current_date - 60, current_date - 30, 400, 400)`, [org, customer]);
await refresh();

const late = await inbox("invoices.overdue");
ok("an overdue invoice is the accountant's problem", late.length === 1
   && late[0].recipient_role === "accountant", late[0]?.title);
ok("with the amount on it", late[0]?.body?.includes("400"), late[0]?.body);

// Over the credit limit is the manager's, because it stops sales.
await c.query(
  `insert into credit_transactions (org_id, customer_id, type, amount, reference_type)
   values ($1,$2,'charge',5000,'test')`, [org, customer]);
await refresh();
const over = await inbox("credit.over_limit");
ok("a customer beyond their limit is the manager's", over.length === 1
   && over[0].recipient_role === "manager", over[0]?.title);

// ====================================================================
console.log("\n-- who sees what --");
// ====================================================================

const managerSees = await as(manager,
  `select kind from notifications where org_id=$1 and resolved_at is null`, [org]);
const kinds = new Set(managerSees.rows?.map((r) => r.kind) ?? []);
ok("a manager sees what is addressed to managers",
   kinds.has("transfer.awaiting_approval") && kinds.has("credit.over_limit"));
ok("and not what is addressed to the warehouse", !kinds.has("stock.low"));
ok("nor what is addressed to the accountant", !kinds.has("invoices.overdue"));

const storeSees = await as(storeman,
  `select kind from notifications where org_id=$1 and resolved_at is null`, [org]);
const storeKinds = new Set(storeSees.rows?.map((r) => r.kind) ?? []);
ok("the warehouse sees the stock ones", storeKinds.has("stock.low"));
ok("and not the credit ones", !storeKinds.has("credit.over_limit"));

const clerkSees = await as(clerk,
  `select kind from notifications where org_id=$1 and resolved_at is null`, [org]);
ok("the accountant sees the overdue invoices",
   (clerkSees.rows ?? []).some((r) => r.kind === "invoices.overdue"));

const driverSees = await as(driver,
  `select count(*)::int n from notifications where org_id=$1`, [org]);
ok("a driver is not shown the office's work",
   driverSees.ok && driverSees.rows[0].n === 0);

const rivalSees = await as(rival,
  `select count(*)::int n from notifications where org_id=$1`, [org]);
ok("another organization sees none of it", rivalSees.ok && rivalSees.rows[0].n === 0);

// ====================================================================
console.log("\n-- nobody writes their own --");
// ====================================================================

const forged = await as(driver,
  `insert into notifications (org_id, recipient_role, kind, title)
   values ($1,'manager','forged','The stock was fine') returning id`, [org]);
ok("a person cannot write a notification", !forged.ok || forged.rows.length === 0,
   "one anybody could insert is a way to report something that did not happen");

const forgedFn = await as(driver,
  `select notify($1,'manager','forged','Nothing to see here')`, [org]);
ok("nor call the function that writes them", !forgedFn.ok,
   forgedFn.error?.split("\n")[0]);

// ---- marking read --------------------------------------------------
// The warehouse's stock.low was marked read further up, so it is put
// back to unread here: what is being tested is that one person reading
// their own does not clear somebody else's.
await c.query(
  `update notifications set read_at = null
    where org_id=$1 and recipient_role='warehouse' and resolved_at is null`, [org]);

const before = (await c.query(
  `select count(*)::int n from notifications
    where org_id=$1 and recipient_role='manager' and read_at is null and resolved_at is null`,
  [org])).rows[0].n;
ok("a manager has unread work", before > 0, `${before}`);

await acting(manager, `select mark_notifications_read()`);
const after = (await c.query(
  `select count(*)::int n from notifications
    where org_id=$1 and recipient_role='manager' and read_at is null and resolved_at is null`,
  [org])).rows[0].n;
ok("marking read clears their own", after === 0);

const stillUnread = (await c.query(
  `select count(*)::int n from notifications
    where org_id=$1 and recipient_role='warehouse' and read_at is null and resolved_at is null`,
  [org])).rows[0].n;
ok("and leaves everybody else's alone", stillUnread > 0, `${stillUnread} still with the warehouse`);

console.log(`\n  ${pass} passed, ${fail} failed`);
await c.end();
process.exit(fail ? 1 : 0);
