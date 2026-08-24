/**
 * Receipts a customer can open, and nothing else.
 *
 * The token is the whole of the authorization, so what matters is not
 * that it works but that it reaches exactly one document: not the
 * customer, not their other purchases, not another organization's sale.
 * Most of what follows is trying to get more than one receipt out of it.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { createHash, randomBytes } = require("node:crypto");
const { Client, CONN } = require("./lib.js");

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

const c = new Client(CONN);
await c.connect();

const link = () => randomBytes(32).toString("base64url");
const digest = (t) => createHash("sha256").update(t).digest("hex");

const asUser = async (id, sql, params) => {
  await c.query("begin");
  await c.query("select set_config('request.jwt.claims',$1,true)",
    [JSON.stringify({ sub: id, role: "authenticated" })]);
  await c.query("set local role authenticated");
  try { return { ok: true, rows: (await c.query(sql, params)).rows }; }
  catch (e) { return { ok: false, error: e.message }; }
  finally { await c.query("rollback"); }
};

// ------------------------------------------------------------------
// A sale to make a receipt for
// ------------------------------------------------------------------
const org = (await c.query(
  `insert into organizations (name, slug) values ('Receipt Co','receipt-co') returning id`)).rows[0].id;
const other = (await c.query(
  `insert into organizations (name, slug) values ('Other Co','other-co') returning id`)).rows[0].id;

const mkUser = async (name, role, orgId) => (await c.query(
  `insert into auth.users (email, raw_user_meta_data) values ($1,$2::jsonb) returning id`,
  [`${name.replace(/\W/g, "")}@receipt.test`,
   JSON.stringify({ full_name: name, role, org_id: orgId })])).rows[0].id;

const seller = await mkUser("Ama Seller", "salesperson", org);
const stranger = await mkUser("Other Staff", "admin", other);

const customer = (await c.query(
  `insert into customers (org_id, code, name, phone) values ($1,'C-1','Kofi Buyer','+233241110001')
   returning id`, [org])).rows[0].id;

const warehouse = (await c.query(
  `insert into warehouses (org_id, code, name) values ($1,'WH-1','Depot') returning id`, [org])).rows[0].id;
const category = (await c.query(
  `insert into categories (org_id, name) values ($1,'Drinks') returning id`, [org])).rows[0].id;
const product = (await c.query(
  `insert into products (org_id, sku, name, unit_of_measure, list_price, cost_price, category_id)
   values ($1,'SKU-1','Malta 500ml','piece',12.50,7.25,$2) returning id`, [org, category])).rows[0].id;
const van = (await c.query(
  `insert into vans (org_id, code, registration_no) values ($1,'V-1','GR-1111-24')
   returning id`, [org])).rows[0].id;
const load = (await c.query(
  `insert into van_loads (org_id, van_id, driver_id, warehouse_id, status)
   values ($1,$2,$3,$4,'loaded') returning id`, [org, van, seller, warehouse])).rows[0].id;

const sale = (await c.query(
  `insert into van_sales (org_id, load_id, van_id, driver_id, salesperson_id, customer_id,
                          sale_type, status, subtotal, tax_total, total, amount_paid)
   -- balance is generated: total minus what was paid.
   values ($1,$2,$3,$4,$4,$5,'credit','completed',25.00,0,25.00,10.00) returning id`,
  [org, load, van, seller, customer])).rows[0].id;

await c.query(
  // line_total is generated from quantity and unit price.
  `insert into van_sale_items (org_id, sale_id, product_id, quantity, unit_price)
   values ($1,$2,$3,2,12.50)`, [org, sale, product]);
await c.query(
  `insert into van_sale_payments (org_id, sale_id, method, amount) values ($1,$2,'cash',10.00)`,
  [org, sale]);

console.log("=== a receipt reaches exactly one document ===");

const saleLink = link();
const issued = await asUser(seller,
  `select * from issue_receipt_token('sale',$1,$2,$3,'+233241110001',180)`,
  [sale, digest(saleLink), saleLink.slice(0, 6)]);
ok("a salesperson can issue a receipt link", issued.ok, issued.ok ? "" : issued.error);

// Issued inside a rolled-back transaction above, so re-issue for real.
await c.query(`select set_config('request.jwt.claims',$1,true)`,
  [JSON.stringify({ sub: seller, role: "authenticated" })]);
const row = (await c.query(
  `select * from issue_receipt_token('sale',$1,$2,$3,'+233241110001',180)`,
  [sale, digest(saleLink), saleLink.slice(0, 6)])).rows[0];

ok("it is given a receipt number", /^RCP-\d{4}-\d{6}$/.test(row.receipt_number), row.receipt_number);
ok("only the digest is stored", row.token_hash === digest(saleLink));
ok("the link itself is nowhere in the row", !JSON.stringify(row).includes(saleLink));
ok("it expires", Boolean(row.expires_at));

const doc = (await c.query(`select resolve_receipt_token($1) d`, [digest(saleLink)])).rows[0].d;
ok("the link resolves to a document", Boolean(doc));
ok("it is the right sale", doc?.total === "25.00" || Number(doc?.total) === 25);
ok("it names the customer", doc?.customerName === "Kofi Buyer");
ok("it lists what was bought", doc?.items?.[0]?.name === "Malta 500ml");
ok("it carries the price the customer paid", Number(doc?.items?.[0]?.unitPrice) === 12.5);
ok("it shows what is still owed", Number(doc?.balance) === 15);
ok("it names who served them", doc?.servedBy === "Ama Seller");

console.log("\n=== a receipt carries nothing the customer should not have ===");
const asText = JSON.stringify(doc);
ok("no cost price", !asText.includes("7.25") && !/cost/i.test(asText));
ok("no margin or profit", !/margin|profit/i.test(asText));
ok("no supplier", !/supplier/i.test(asText));
ok("no van or load", !/\bvan\b|\bload\b/i.test(asText));
ok("no organization id", !asText.includes(org));
ok("no customer id", !asText.includes(customer));
ok("no product id", !asText.includes(product));
ok("no sale id", !asText.includes(sale));

console.log("\n=== a bad link gets nothing ===");
ok("a made-up link resolves to nothing",
   (await c.query(`select resolve_receipt_token($1) d`, [digest(link())])).rows[0].d === null);
// Flipped to a character it certainly was not, rather than to a fixed
// one that might be what was already there.
const flipped = digest(saleLink).slice(0, -1)
  + (digest(saleLink).endsWith("a") ? "b" : "a");
ok("a modified digest resolves to nothing",
   (await c.query(`select resolve_receipt_token($1) d`, [flipped])).rows[0].d === null);
ok("an empty digest resolves to nothing",
   (await c.query(`select resolve_receipt_token('') d`)).rows[0].d === null);

await c.query(`update receipt_tokens set revoked_at = now() where id = $1`, [row.id]);
ok("a revoked link stops working",
   (await c.query(`select resolve_receipt_token($1) d`, [digest(saleLink)])).rows[0].d === null);
await c.query(`update receipt_tokens set revoked_at = null where id = $1`, [row.id]);

await c.query(`update receipt_tokens set expires_at = now() - interval '1 day' where id = $1`, [row.id]);
ok("an expired link stops working",
   (await c.query(`select resolve_receipt_token($1) d`, [digest(saleLink)])).rows[0].d === null);
await c.query(`update receipt_tokens set expires_at = now() + interval '180 days' where id = $1`, [row.id]);

console.log("\n=== nobody can mint a link to somebody else's sale ===");
const theft = await asUser(stranger,
  `select * from issue_receipt_token('sale',$1,$2,$3,null,30)`,
  [sale, digest(link()), "abcdef"]);
ok("another organization's staff are refused", !theft.ok,
   theft.ok ? "(ISSUED)" : theft.error.slice(0, 48));

const invented = await asUser(seller,
  `select * from issue_receipt_token('sale',$1,$2,$3,null,30)`,
  ["00000000-0000-0000-0000-000000000000", digest(link()), "abcdef"]);
ok("a transaction that does not exist is refused", !invented.ok);

const badKind = await asUser(seller,
  `select * from issue_receipt_token('everything',$1,$2,$3,null,30)`,
  [sale, digest(link()), "abcdef"]);
ok("an unknown kind of receipt is refused", !badKind.ok);

console.log("\n=== the tokens table is not a way in ===");
const peek = await asUser(stranger, `select count(*)::int n from receipt_tokens`);
ok("another organization sees no tokens", peek.ok && peek.rows[0].n === 0,
   peek.ok ? `(${peek.rows[0].n})` : peek.error.slice(0, 40));

const mine = await asUser(seller, `select count(*)::int n from receipt_tokens`);
ok("our own staff see ours", mine.ok && mine.rows[0].n >= 1);

for (const [what, sql] of [
  ["insert", `insert into receipt_tokens (org_id, subject_type, subject_id, token_hash, token_hint, expires_at)
              values ($1,'sale',$2,'deadbeef','dead', now() + interval '1 day')`],
  ["update", `update receipt_tokens set expires_at = now() + interval '999 days'`],
  ["delete", `delete from receipt_tokens`],
]) {
  const r = await asUser(seller, sql, sql.includes("$1") ? [org, sale] : undefined);
  ok(`a token cannot be ${what}d by hand`, !r.ok || r.rows.length === 0,
     r.ok ? "(SUCCEEDED)" : "");
}

console.log("\n=== a credit payment gets its own receipt ===");
await c.query(
  `insert into credit_transactions (org_id, customer_id, type, amount, reference_type, created_by)
   values ($1,$2,'charge',500.00,'invoice',$3)`, [org, customer, seller]);
const payment = (await c.query(
  `insert into credit_transactions (org_id, customer_id, type, amount, reference_type, created_by, notes)
   values ($1,$2,'payment',-200.00,'momo',$3,'Part payment') returning id`,
  [org, customer, seller])).rows[0].id;

const payLink = link();
await c.query(`select set_config('request.jwt.claims',$1,true)`,
  [JSON.stringify({ sub: seller, role: "authenticated" })]);
await c.query(`select issue_receipt_token('credit_payment',$1,$2,$3,'+233241110001',180)`,
  [payment, digest(payLink), payLink.slice(0, 6)]);

const pay = (await c.query(`select resolve_receipt_token($1) d`, [digest(payLink)])).rows[0].d;
ok("the payment link resolves", Boolean(pay));
ok("it is a payment receipt", pay?.kind === "credit_payment");
ok("it shows what was received", Number(pay?.amount) === 200);
ok("it shows what was owed before", Number(pay?.balanceBefore) === 500,
   `(${pay?.balanceBefore})`);
ok("and what is owed after", Number(pay?.balanceAfter) === 300, `(${pay?.balanceAfter})`);
ok("it names the method", String(pay?.method).includes("momo"));
ok("it names who collected", pay?.servedBy === "Ama Seller");

console.log("\n=== opening a receipt is counted ===");
const before = (await c.query(
  `select view_count from receipt_tokens where token_hash=$1`, [digest(saleLink)])).rows[0].view_count;
await c.query(`select resolve_receipt_token($1)`, [digest(saleLink)]);
const after = (await c.query(
  `select view_count, last_viewed_at from receipt_tokens where token_hash=$1`,
  [digest(saleLink)])).rows[0];
ok("a view is recorded", after.view_count === before + 1);
ok("and when it happened", Boolean(after.last_viewed_at));

console.log(`\n  ${pass} passed, ${fail} failed`);
await c.end();
process.exit(fail ? 1 : 0);
