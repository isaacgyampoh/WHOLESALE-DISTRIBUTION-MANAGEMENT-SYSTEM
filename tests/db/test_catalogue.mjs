import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Client, CONN } = require("./lib.js");

/**
 * Phase 6 boundaries, at the database.
 *
 * The catalogue screens rest on these. They are asserted here because
 * the screens are not what enforces them.
 */
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

const c = new Client(CONN); await c.connect();
const orgA = (await c.query("select id from organizations where slug='default'")).rows[0].id;
const orgB = (await c.query(
  `insert into organizations (name, slug) values ('Other Co','other-co-6') returning id`)).rows[0].id;

const mk = async (name, role, org = orgA) => (await c.query(
  `insert into auth.users (email, raw_user_meta_data) values ($1,$2::jsonb) returning id`,
  [`${name}@cat.test`, JSON.stringify({ full_name: name, role, org_id: org })])).rows[0].id;

const as = async (id, sql, params) => {
  await c.query("begin");
  await c.query(`select set_config('request.jwt.claims',$1,true)`,
    [JSON.stringify({ sub: id, role: "authenticated" })]);
  await c.query("set local role authenticated");
  try { return { ok: true, rows: (await c.query(sql, params)).rows }; }
  catch (e) { return { ok: false, error: e.message }; }
  finally { await c.query("rollback"); }
};

const admin = await mk("cadmin", "admin");
const manager = await mk("cmanager", "manager");
const driver = await mk("cdriver", "driver");
const rival = await mk("crival", "admin", orgB);

const beverages = (await c.query(`select id from categories where org_id=$1 and name='Beverages'`, [orgA])).rows[0].id;
const dryGoods = (await c.query(`select id from categories where org_id=$1 and name='Dry Goods'`, [orgA])).rows[0].id;
await c.query(`delete from manager_category_scopes where profile_id=$1`, [manager]);
await c.query(`insert into manager_category_scopes (org_id, profile_id, category_id) values ($1,$2,$3)`,
  [orgA, manager, beverages]);

const warehouse = (await c.query(`select id from warehouses where org_id=$1 limit 1`, [orgA])).rows[0].id;
const bevProduct = (await c.query(
  `select id from products where org_id=$1 and category_id=$2 limit 1`, [orgA, beverages])).rows[0].id;

console.log("=== category status (migration 0020) ===");
ok("categories can be retired",
   (await c.query(`select count(*)::int n from information_schema.columns
     where table_schema='public' and table_name='categories' and column_name='is_active'`)).rows[0].n === 1);
await c.query(`update categories set is_active=false where id=$1`, [dryGoods]);
ok("retiring a category keeps its products",
   (await c.query(`select count(*)::int n from products where category_id=$1`, [dryGoods])).rows[0].n > 0);
await c.query(`update categories set is_active=true where id=$1`, [dryGoods]);

console.log("\n=== manager category scoping ===");
let r = await as(manager, `select count(*)::int n from products`);
const bevCount = (await c.query(`select count(*)::int n from products where category_id=$1`, [beverages])).rows[0].n;
ok("a scoped manager sees only their categories", r.ok && r.rows[0].n === bevCount,
   r.ok ? `(${r.rows[0].n} of ${bevCount})` : "");
r = await as(manager, `select count(*)::int n from products where category_id=$1`, [dryGoods]);
ok("and none from a category they do not hold", r.ok && r.rows[0].n === 0);

r = await as(manager, `select count(*)::int n from categories where id=$1`, [dryGoods]);
ok("nor the category itself", r.ok && r.rows[0].n === 0);

console.log("\n=== who may change the catalogue ===");
r = await as(driver, `insert into products (org_id, sku, name) values ($1,'DRV-1','x') returning id`, [orgA]);
ok("a driver cannot create a product", !r.ok, r.ok ? "(CREATED)" : "(blocked)");
r = await as(driver, `update products set list_price=1 where id=$1 returning id`, [bevProduct]);
ok("a driver cannot change a price", !r.ok || r.rows.length === 0);
r = await as(manager, `insert into categories (org_id, name) values ($1,'Manager Made') returning id`, [orgA]);
ok("a manager cannot create a category", !r.ok, r.ok ? "(CREATED)" : "(blocked)");
r = await as(admin, `insert into categories (org_id, name) values ($1,'Admin Made') returning id`, [orgA]);
ok("an administrator can", r.ok && r.rows.length === 1, r.ok ? "" : `-> ${r.error.slice(0, 40)}`);

console.log("\n=== stock is derived, never set ===");
// Not "the application does not do it", but "the database refuses it".
r = await as(admin, `update inventory set qty_on_hand=9999 where product_id=$1 returning id`, [bevProduct]);
ok("even an administrator cannot set a quantity directly", !r.ok,
   r.ok ? `(CHANGED ${r.rows.length} rows)` : `-> ${r.error.slice(0, 44)}`);

r = await as(admin, `update inventory set bin_location='A-12' where product_id=$1 returning id`, [bevProduct]);
ok("but may still record where the stock sits", r.ok && r.rows.length > 0,
   r.ok ? "" : `-> ${r.error.slice(0, 44)}`);

r = await as(admin, `insert into inventory (org_id, product_id, warehouse_id, qty_on_hand)
                     values ($1,$2,$3,50) returning id`, [orgA, bevProduct, warehouse]);
ok("nor conjure a stock row into existence", !r.ok, r.ok ? "(INSERTED)" : "(blocked)");

r = await as(driver, `insert into stock_movements (org_id, product_id, warehouse_id, type, quantity)
                      values ($1,$2,$3,'adjustment_in',10) returning id`, [orgA, bevProduct, warehouse]);
ok("a driver cannot post a warehouse movement", !r.ok, r.ok ? "(POSTED)" : "(blocked)");

r = await as(admin, `insert into stock_movements (org_id, product_id, warehouse_id, type, quantity, reason)
                     values ($1,$2,$3,'adjustment_in',10,'test') returning id`, [orgA, bevProduct, warehouse]);
ok("an administrator can", r.ok, r.ok ? "" : `-> ${r.error.slice(0, 40)}`);

console.log("\n=== the ledger is append-only ===");
await c.query(`insert into stock_movements (org_id, product_id, warehouse_id, type, quantity, reason)
               values ($1,$2,$3,'adjustment_in',5,'append test')`, [orgA, bevProduct, warehouse]);
r = await as(admin, `update stock_movements set quantity=1 where reason='append test' returning id`);
ok("an administrator cannot rewrite a movement", !r.ok, r.ok ? "(REWRITTEN)" : `-> ${r.error.slice(0, 44)}`);
r = await as(admin, `delete from stock_movements where reason='append test' returning id`);
ok("nor delete one", !r.ok, r.ok ? "(DELETED)" : "(blocked)");

console.log("\n=== a movement moves the quantity it says ===");
const before = (await c.query(
  `select coalesce(qty_on_hand,0) q from inventory where product_id=$1 and warehouse_id=$2`,
  [bevProduct, warehouse])).rows[0]?.q ?? 0;
await c.query(`insert into stock_movements (org_id, product_id, warehouse_id, type, quantity, reason)
               values ($1,$2,$3,'adjustment_in',13,'derive up')`, [orgA, bevProduct, warehouse]);
const afterUp = (await c.query(
  `select qty_on_hand q from inventory where product_id=$1 and warehouse_id=$2`,
  [bevProduct, warehouse])).rows[0].q;
ok("an increase raises the quantity", afterUp === before + 13, `(${before} -> ${afterUp})`);
await c.query(`insert into stock_movements (org_id, product_id, warehouse_id, type, quantity, reason)
               values ($1,$2,$3,'adjustment_out',5,'derive down')`, [orgA, bevProduct, warehouse]);
const afterDown = (await c.query(
  `select qty_on_hand q from inventory where product_id=$1 and warehouse_id=$2`,
  [bevProduct, warehouse])).rows[0].q;
ok("a decrease lowers it", afterDown === afterUp - 5, `(${afterUp} -> ${afterDown})`);

console.log("\n=== organization isolation ===");
for (const table of ["products", "categories", "inventory", "stock_movements"]) {
  const rr = await as(rival, `select count(*)::int n from ${table} where org_id=$1`, [orgA]);
  ok(`another organization sees no ${table}`, rr.ok && rr.rows[0].n === 0);
}
r = await as(rival, `update products set name='hijacked' where org_id=$1 returning id`, [orgA]);
ok("and cannot change them", !r.ok || r.rows.length === 0);

console.log("\n=== product codes are unique within an organization ===");
const sku = (await c.query(`select sku from products where org_id=$1 limit 1`, [orgA])).rows[0].sku;
let dup = false;
try { await c.query(`insert into products (org_id, sku, name) values ($1,$2,'Duplicate')`, [orgA, sku]); }
catch { dup = true; }
ok("a duplicate code is refused", dup);
let across = true;
try { await c.query(`insert into products (org_id, sku, name) values ($1,$2,'Same code elsewhere')`, [orgB, sku]); }
catch { across = false; }
ok("but the same code is free in another organization", across);

console.log("\n=== low stock reads from what is available, not what is present ===");
const summary = (await c.query(
  `select qty_on_hand, qty_available, reorder_point, needs_reorder
   from stock_summary where product_id=$1`, [bevProduct])).rows[0];
ok("the reporting view exposes availability and the threshold", Boolean(summary),
   summary ? `on hand ${summary.qty_on_hand}, available ${summary.qty_available}, threshold ${summary.reorder_point}` : "");
ok("needs_reorder follows availability against the threshold",
   summary.needs_reorder === (Number(summary.qty_available) <= Number(summary.reorder_point)));

console.log(`\n  ${pass} passed, ${fail} failed`);
await c.end();
process.exit(fail ? 1 : 0);
