import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { createHash, randomBytes } = require("crypto");
const { Client, CONN } = require("./lib.js");

/**
 * Supplier paperwork, and letting a supplier see their own orders.
 *
 * Two things are being protected here. The files carry purchase prices,
 * which 0023 established is management information - so a driver must
 * not reach them, and neither must another organization. And the portal
 * link is a credential: it is held as a digest, it expires, it can be
 * revoked, guessing at it is throttled, and it discloses exactly one
 * supplier's own orders and nothing else.
 */
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

const stamp = Date.now().toString(36);
const c = new Client(CONN); await c.connect();
const orgA = (await c.query("select id from organizations where slug='default'")).rows[0].id;
const orgB = (await c.query(
  `insert into organizations (name, slug) values ('Supplier Rival',$1) returning id`,
  [`sup-rival-${stamp}`])).rows[0].id;

const mk = async (name, role, org = orgA) => (await c.query(
  `insert into auth.users (email, raw_user_meta_data) values ($1,$2::jsonb) returning id`,
  [`${name}-${stamp}@sup.test`, JSON.stringify({ full_name: name, role, org_id: org })])).rows[0].id;

const as = async (who, sql, params) => {
  await c.query("begin");
  await c.query("select set_config('request.jwt.claims',$1,true)",
    [JSON.stringify({ sub: who, role: "authenticated" })]);
  await c.query("set local role authenticated");
  try { return { ok: true, rows: (await c.query(sql, params)).rows }; }
  catch (e) { return { ok: false, error: e.message }; }
  finally { await c.query("rollback"); }
};

const manager  = await mk("supmgr", "manager");
const storeman = await mk("supwh", "warehouse");
const driver   = await mk("supdrv", "driver");
const rival    = await mk("suprival", "admin", orgB);

const digest = (t) => createHash("sha256").update(t).digest("hex");

// ---- a supplier with an order --------------------------------------
const wh = (await c.query(
  `insert into warehouses (org_id, code, name) values ($1,$2,'Supplier Depot') returning id`,
  [orgA, `SUPW-${stamp}`.slice(0, 12)])).rows[0].id;
const supplier = (await c.query(
  `insert into suppliers (org_id, code, name) values ($1,$2,'Acme Supplies') returning id`,
  [orgA, `SUP-${stamp}`.slice(0, 12)])).rows[0].id;
const otherSupplier = (await c.query(
  `insert into suppliers (org_id, code, name) values ($1,$2,'Rival Supplies') returning id`,
  [orgA, `SUP2-${stamp}`.slice(0, 12)])).rows[0].id;
const cat = (await c.query(
  `insert into categories (org_id, name) values ($1,$2) returning id`,
  [orgA, `Sup Cat ${stamp}`])).rows[0].id;
const product = (await c.query(
  `insert into products (org_id, sku, name, category_id, unit_of_measure, cost_price, list_price)
   values ($1,$2,'Supplier Product',$3,'case',10,100) returning id`,
  [orgA, `SUPP-${stamp}`.slice(0, 20), cat])).rows[0].id;

const order = (await c.query(
  `insert into purchase_orders (org_id, supplier_id, warehouse_id, status, order_date)
   values ($1,$2,$3,'submitted', current_date) returning id, po_number`,
  [orgA, supplier, wh])).rows[0];
await c.query(
  `insert into purchase_order_items (org_id, po_id, product_id, quantity, unit_cost, tax_rate)
   values ($1,$2,$3,100,10,0)`, [orgA, order.id, product]);

const draftOrder = (await c.query(
  `insert into purchase_orders (org_id, supplier_id, warehouse_id, status, order_date)
   values ($1,$2,$3,'draft', current_date) returning id`, [orgA, supplier, wh])).rows[0].id;

const otherOrder = (await c.query(
  `insert into purchase_orders (org_id, supplier_id, warehouse_id, status, order_date)
   values ($1,$2,$3,'submitted', current_date) returning id`,
  [orgA, otherSupplier, wh])).rows[0].id;

// ====================================================================
console.log("\n-- the bucket is private --");
// ====================================================================

const bucket = (await c.query(
  `select * from storage.buckets where id='supplier-documents'`)).rows[0];
ok("the supplier document bucket exists", !!bucket);
ok("and is private", bucket?.public === false,
   "a public one hands every purchase price to anybody who guesses a URL");
ok("with a size cap", Number(bucket?.file_size_limit) === 20971520,
   `${bucket?.file_size_limit} bytes`);
ok("and a list of types it will take",
   (bucket?.allowed_mime_types ?? []).includes("application/pdf")
   && !(bucket?.allowed_mime_types ?? []).includes("application/x-msdownload"),
   (bucket?.allowed_mime_types ?? []).join(", "));

// ====================================================================
console.log("\n-- filing a document --");
// ====================================================================

const path = `${orgA}/${supplier}/${randomBytes(8).toString("hex")}`;
const doc = (await c.query(
  `insert into supplier_documents
     (org_id, supplier_id, purchase_order_id, kind, title, storage_path,
      file_name, mime_type, size_bytes, amount, document_date)
   values ($1,$2,$3,'invoice','Acme invoice 8891',$4,'invoice-8891.pdf',
           'application/pdf', 184320, 1000, current_date)
   returning *`, [orgA, supplier, order.id, path])).rows[0];
ok("a document can be filed against a delivery", !!doc);
ok("under the organization's own folder", doc.storage_path.startsWith(`${orgA}/`),
   "so one tenant's folder cannot be reached from another's");

const dupePath = await c.query(
  `insert into supplier_documents
     (org_id, supplier_id, title, storage_path, file_name, mime_type, size_bytes)
   values ($1,$2,'Duplicate',$3,'x.pdf','application/pdf',100)`,
  [orgA, supplier, path]).then(() => null, e => e.message);
ok("two rows cannot point at one file", dupePath !== null,
   "deleting either would destroy the other's evidence");

const executable = await c.query(
  `insert into supplier_documents
     (org_id, supplier_id, title, storage_path, file_name, mime_type, size_bytes)
   values ($1,$2,'Trojan',$3,'setup.exe','application/x-msdownload',100)`,
  [orgA, supplier, `${orgA}/${supplier}/exe`]).then(() => null, e => e.message);
ok("a file type nobody asked for is refused", executable !== null);

const huge = await c.query(
  `insert into supplier_documents
     (org_id, supplier_id, title, storage_path, file_name, mime_type, size_bytes)
   values ($1,$2,'Enormous',$3,'big.pdf','application/pdf',99999999)`,
  [orgA, supplier, `${orgA}/${supplier}/big`]).then(() => null, e => e.message);
ok("and one that is too large", huge !== null);

const empty = await c.query(
  `insert into supplier_documents
     (org_id, supplier_id, title, storage_path, file_name, mime_type, size_bytes)
   values ($1,$2,'Nothing',$3,'empty.pdf','application/pdf',0)`,
  [orgA, supplier, `${orgA}/${supplier}/empty`]).then(() => null, e => e.message);
ok("an empty file is not a document", empty !== null);

// ====================================================================
console.log("\n-- who may read the paperwork --");
// ====================================================================

const storeSees = await as(storeman,
  `select count(*)::int n from supplier_documents where id=$1`, [doc.id]);
ok("the warehouse files and reads them", storeSees.ok && storeSees.rows[0].n === 1);

const driverSees = await as(driver,
  `select count(*)::int n from supplier_documents where id=$1`, [doc.id]);
ok("a driver cannot read one", driverSees.ok && driverSees.rows[0].n === 0,
   "supplier paperwork carries the purchase price");

const rivalSees = await as(rival,
  `select count(*)::int n from supplier_documents where org_id=$1`, [orgA]);
ok("another organization cannot", rivalSees.ok && rivalSees.rows[0].n === 0);

const detail = await as(manager,
  `select supplier_name, po_number from supplier_document_detail where id=$1`, [doc.id]);
ok("the office sees it with its supplier and order",
   detail.ok && detail.rows[0]?.supplier_name === "Acme Supplies"
   && detail.rows[0]?.po_number === order.po_number);

// ---- the objects themselves ----------------------------------------
const objectPolicies = (await c.query(
  `select policyname, cmd from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname like 'supplier_documents_objects%' order by policyname`)).rows;
ok("the files are behind their own policies, not only the rows",
   objectPolicies.length === 3,
   objectPolicies.map(p => `${p.policyname} (${p.cmd})`).join(", "));
ok("scoped by the organization folder", (await c.query(
  `select count(*)::int n from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname like 'supplier_documents_objects%'
      and (qual like '%auth_org_id%' or with_check like '%auth_org_id%')`)).rows[0].n === 3);
ok("and deleting evidence is a narrower job than filing it", (await c.query(
  `select qual from pg_policies where schemaname='storage' and tablename='objects'
     and policyname='supplier_documents_objects_delete'`)).rows[0].qual
   .includes("warehouse") === false,
   "a storeman uploads; removing a document a dispute turns on is not theirs");

// ====================================================================
console.log("\n-- the portal link is a credential --");
// ====================================================================

const link = randomBytes(32).toString("base64url");
const issued = (await c.query(
  `select * from issue_supplier_token($1,$2,$3,30,'For Acme accounts')`,
  [supplier, digest(link), link.slice(0, 6)])).rows[0];
ok("a link can be issued for a supplier", !!issued);
ok("it expires", new Date(issued.expires_at) > new Date(), issued.expires_at);

const stored = (await c.query(
  `select * from supplier_portal_tokens where id=$1`, [issued.id])).rows[0];
ok("the link itself is not stored", stored.token_hash !== link
   && !JSON.stringify(stored).includes(link),
   "a leaked backup hands over no working links");
ok("only a digest and a hint", stored.token_hash === digest(link)
   && stored.token_hint === link.slice(0, 6));

const forever = await c.query(
  `select issue_supplier_token($1,$2,'xxxxxx',9999)`, [supplier, digest("other")])
  .then(() => null, e => e.message);
ok("a link that never expires is refused", forever !== null,
   "it is a permanent grant to whoever it was forwarded to");

const shortDigest = await c.query(
  `select issue_supplier_token($1,'abc','xxxxxx',30)`, [supplier])
  .then(() => null, e => e.message);
ok("and one issued without a full digest", shortDigest !== null);

// ---- redeeming ------------------------------------------------------
const resolved = (await c.query(
  `select * from resolve_supplier_token($1,'203.0.113.5','test')`, [digest(link)])).rows[0];
ok("the link resolves to its supplier", resolved?.supplier_id === supplier);
ok("and to the right organization", resolved?.org_id === orgA);

const wrong = (await c.query(
  `select * from resolve_supplier_token($1,'203.0.113.9','test')`,
  [digest("not-a-real-link")])).rows;
ok("a link nobody issued resolves to nothing", wrong.length === 0);

const used = (await c.query(
  `select use_count, last_used_at from supplier_portal_tokens where id=$1`, [issued.id])).rows[0];
ok("use is recorded", Number(used.use_count) === 1 && used.last_used_at !== null);

// ---- revoking -------------------------------------------------------
await c.query(`select revoke_supplier_token($1)`, [issued.id]);
const afterRevoke = (await c.query(
  `select * from resolve_supplier_token($1,'203.0.113.5','test')`, [digest(link)])).rows;
ok("a revoked link stops working immediately", afterRevoke.length === 0);

// ---- expiry ---------------------------------------------------------
const stale = randomBytes(32).toString("base64url");
const staleToken = (await c.query(
  `select * from issue_supplier_token($1,$2,$3,1)`,
  [supplier, digest(stale), stale.slice(0, 6)])).rows[0];
// Both columns move: the table refuses a link that expires before it
// was issued, which is the constraint working rather than a problem.
await c.query(
  `update supplier_portal_tokens
      set created_at = now() - interval '2 days',
          expires_at = now() - interval '1 hour'
    where id=$1`, [staleToken.id]);
ok("an expired link stops working", (await c.query(
  `select * from resolve_supplier_token($1,'203.0.113.5','test')`, [digest(stale)])).rows.length === 0);

// ---- rate limiting --------------------------------------------------
const attacker = "198.51.100.7";
for (let i = 0; i < 10; i++) {
  await c.query(`select * from resolve_supplier_token($1,$2,'script')`,
    [digest(`guess-${i}`), attacker]);
}
const valid = randomBytes(32).toString("base64url");
await c.query(`select issue_supplier_token($1,$2,$3,30)`,
  [supplier, digest(valid), valid.slice(0, 6)]);

const throttled = (await c.query(
  `select * from resolve_supplier_token($1,$2,'script')`, [digest(valid), attacker])).rows;
ok("guessing is throttled", throttled.length === 0,
   "a good link is refused too, from an address that has been guessing");

const elsewhere = (await c.query(
  `select * from resolve_supplier_token($1,'203.0.113.20','browser')`,
  [digest(valid)])).rows;
ok("and the throttle is per address, not global", elsewhere.length === 1,
   "otherwise one attacker locks out every supplier");

const logged = (await c.query(
  `select count(*)::int n from supplier_portal_attempts where request_ip=$1`,
  [attacker])).rows[0].n;
ok("every attempt is recorded", logged >= 11, `${logged} attempts`);

const noSecrets = (await c.query(
  `select column_name from information_schema.columns
    where table_schema='public' and table_name='supplier_portal_attempts'`)).rows
  .map(r => r.column_name);
ok("without recording the link", !noSecrets.some(n => /hash|token_hash|secret/.test(n)),
   noSecrets.join(", "));

// ====================================================================
console.log("\n-- what a supplier can see through it --");
// ====================================================================

const orders = (await c.query(
  `select * from supplier_portal_orders($1,$2)`, [supplier, orgA])).rows;
ok("a supplier sees their own orders", orders.length === 1
   && orders[0].po_number === order.po_number, `${orders.length}`);
ok("and not another supplier's",
   !orders.some(o => o.id === otherOrder));
ok("nor a draft the business has not sent",
   !orders.some(o => o.id === draftOrder),
   "an order not yet placed is not theirs to learn about");

const lines = (await c.query(
  `select * from supplier_portal_order_lines($1,$2,$3)`,
  [order.id, supplier, orgA])).rows;
ok("with the lines of their own order", lines.length === 1
   && Number(lines[0].quantity) === 100);
ok("priced at what they charge us", Number(lines[0].unit_cost) === 10,
   "their own price is not a disclosure");

const notTheirs = (await c.query(
  `select * from supplier_portal_order_lines($1,$2,$3)`,
  [otherOrder, supplier, orgA])).rows;
ok("asking for another supplier's lines returns nothing", notTheirs.length === 0,
   "the supplier is checked, not just the order id");

const wrongOrg = (await c.query(
  `select * from supplier_portal_orders($1,$2)`, [supplier, orgB])).rows;
ok("and asking as the wrong organization returns nothing", wrongOrg.length === 0);

// ---- nothing is exposed to the browser ------------------------------
for (const [what, fn, args] of [
  ["resolve a link", "resolve_supplier_token", "'x'::text"],
  ["read a supplier's orders", "supplier_portal_orders",
   `'${supplier}'::uuid, '${orgA}'::uuid`],
  ["read their order lines", "supplier_portal_order_lines",
   `'${order.id}'::uuid, '${supplier}'::uuid, '${orgA}'::uuid`],
]) {
  const r = await as(manager, `select * from ${fn}(${args})`);
  ok(`a signed-in user cannot ${what} directly`, !r.ok,
     r.error?.split("\n")[0]);
}

const driverIssues = await as(driver,
  `select issue_supplier_token($1,$2,'xxxxxx',30)`, [supplier, digest("dr")]);
ok("a driver cannot issue a portal link", !driverIssues.ok,
   driverIssues.error?.split("\n")[0]);

const storeIssues = await as(storeman,
  `select issue_supplier_token($1,$2,'xxxxxx',30)`, [supplier, digest("wh")]);
ok("nor can the warehouse", !storeIssues.ok, storeIssues.error?.split("\n")[0]);

const rivalIssues = await as(rival,
  `select issue_supplier_token($1,$2,'xxxxxx',30)`, [supplier, digest("rv")]);
ok("nor another organization, for our supplier", !rivalIssues.ok,
   rivalIssues.error?.split("\n")[0]);

const managerReads = await as(manager,
  `select count(*)::int n from supplier_portal_tokens where supplier_id=$1`, [supplier]);
ok("a manager can see which links exist", managerReads.ok && managerReads.rows[0].n > 0);

const driverReads = await as(driver,
  `select count(*)::int n from supplier_portal_tokens`, []);
ok("a driver cannot", driverReads.ok && driverReads.rows[0].n === 0);

const attemptsRead = await as(manager, `select count(*)::int n from supplier_portal_attempts`);
ok("and nobody reads the attempt log through the browser",
   !attemptsRead.ok || attemptsRead.rows[0].n === 0);

console.log(`\n  ${pass} passed, ${fail} failed`);
await c.end();
process.exit(fail ? 1 : 0);
