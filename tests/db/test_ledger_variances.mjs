/**
 * When the shelf and the ledger stop agreeing.
 *
 * inventory is the running total of stock_movements, folded in by a
 * trigger - the same fact seen twice. Nothing in the system compared
 * them until 0071, and one product had been carrying thirty-nine units
 * no movement accounted for for weeks before anybody noticed.
 *
 * What these check is that the comparison sees a disagreement from
 * either side, stays quiet when the books balance, and does not hand
 * one organization a look at another's.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Client, CONN } = require("./lib.js");

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };
const head = (t) => console.log(`\n=== ${t} ===`);

const c = new Client(CONN);
await c.connect();

const asUser = async (id, sql, params = []) => {
  await c.query("begin");
  await c.query("select set_config('request.jwt.claims',$1,true)",
    [JSON.stringify({ sub: id, role: "authenticated" })]);
  await c.query("set local role authenticated");
  try {
    const r = await c.query(sql, params);
    return { ok: true, rows: r.rows };
  } catch (e) { return { ok: false, error: e.message }; }
  finally { await c.query("rollback"); }
};

const org = (await c.query(
  `insert into organizations (name, slug) values ('Ledger Co','ledger-co') returning id`)).rows[0].id;
const mkUser = async (name, role, inOrg) => (await c.query(
  `insert into auth.users (email, raw_user_meta_data) values ($1,$2::jsonb) returning id`,
  [`${name.replace(/\W/g, "")}@ledger.test`,
   JSON.stringify({ full_name: name, role, org_id: inOrg ?? org })])).rows[0].id;

const boss = await mkUser("The Office", "admin");
const warehouse = (await c.query(
  `insert into warehouses (org_id, code, name) values ($1,'LW','Ledger Store') returning id`,
  [org])).rows[0].id;
const category = (await c.query(
  `insert into categories (org_id, name) values ($1,'Goods') returning id`, [org])).rows[0].id;

let n = 0;
const product = async (name) => (await c.query(
  `insert into products (org_id, sku, name, unit_of_measure, units_per_case,
                         list_price, cost_price, category_id)
   values ($1,$2,$3,'carton',12,100,40,$4) returning id`,
  [org, `LV-${++n}`, name, category])).rows[0].id;

const move = (p, type, units, pieces = 0) => c.query(
  `insert into stock_movements (org_id, product_id, warehouse_id, type, quantity, pieces,
                                reference_type, created_by)
   values ($1,$2,$3,$4,$5,$6,'seed',null)`,
  [org, p, warehouse, type, units, pieces]);

const variance = async (p) => (await c.query(
  `select unexplained_units, unexplained_pieces, inventory_units, ledger_units
     from stock_ledger_variances where product_id = $1`, [p])).rows[0] ?? null;

// ===================================================================
head("stock that arrived properly raises nothing");
{
  const p = await product("Honest Soap");
  await move(p, "opening_stock", 20, 5);
  await move(p, "issue", 3, 2);
  ok("the shelf and the ledger agree", (await variance(p)) === null);

  const held = (await c.query(
    `select qty_on_hand u, qty_pieces pc from inventory
      where warehouse_id=$1 and product_id=$2`, [warehouse, p])).rows[0];
  ok("and the figures are what the movements say",
     Number(held.u) === 17 && Number(held.pc) === 3, `(${held.u} + ${held.pc})`);
}

// ===================================================================
head("stock nobody recorded arriving is named");
{
  // Straight into inventory, past the trigger - which is the only way
  // it can happen, and is how the one real case came about.
  const p = await product("Ghost Soap");
  await c.query(
    `insert into inventory (org_id, product_id, warehouse_id, qty_on_hand, qty_pieces)
     values ($1,$2,$3,39,0)`, [org, p, warehouse]);

  const v = await variance(p);
  ok("the disagreement is seen", v !== null);
  ok("and it is thirty-nine units the ledger cannot explain",
     Number(v?.unexplained_units) === 39, `(${v?.unexplained_units})`);
  ok("with the ledger reading zero", Number(v?.ledger_units) === 0, `(${v?.ledger_units})`);
  ok("and the shelf reading thirty-nine",
     Number(v?.inventory_units) === 39, `(${v?.inventory_units})`);

  // Driven from both sides on purpose. A product with stock and no
  // movements at all never appears in the ledger, so a comparison that
  // walked only the ledger would not see this row - which is exactly
  // the blind spot that let the real one sit unnoticed.
  const seenFromLedgerOnly = (await c.query(
    `select count(*)::int n from stock_movements where product_id=$1`, [p])).rows[0].n;
  ok("even though it has no movements at all", seenFromLedgerOnly === 0);
}

// ===================================================================
head("a shelf short of what the ledger says is named too");
{
  const p = await product("Short Soap");
  await move(p, "opening_stock", 10, 0);
  await c.query(`update inventory set qty_on_hand = 4
                  where warehouse_id=$1 and product_id=$2`, [warehouse, p]);

  const v = await variance(p);
  ok("the shortfall is seen", v !== null);
  ok("and reads negative, not as an absence",
     Number(v?.unexplained_units) === -6, `(${v?.unexplained_units})`);
}

// ===================================================================
head("the loose half is compared on its own");
{
  const p = await product("Loose Soap");
  await move(p, "opening_stock", 5, 12);
  await c.query(`update inventory set qty_pieces = 20
                  where warehouse_id=$1 and product_id=$2`, [warehouse, p]);

  const v = await variance(p);
  ok("pieces that no movement explains are seen", v !== null);
  ok("eight of them", Number(v?.unexplained_pieces) === 8, `(${v?.unexplained_pieces})`);
  ok("while the units still agree",
     Number(v?.unexplained_units) === 0, `(${v?.unexplained_units})`);
}

// ===================================================================
head("what the office can see");
{
  const p = await product("Visible Soap");
  await c.query(
    `insert into inventory (org_id, product_id, warehouse_id, qty_on_hand)
     values ($1,$2,$3,7)`, [org, p, warehouse]);

  const mine = await asUser(boss,
    `select sku, name, warehouse_name, unexplained_units
       from stock_ledger_variances where product_id = $1`, [p]);
  ok("an administrator sees it", mine.ok && mine.rows.length === 1, mine.error ?? "");
  ok("named, with the warehouse",
     mine.rows?.[0]?.name === "Visible Soap" && mine.rows?.[0]?.warehouse_name === "Ledger Store",
     `${mine.rows?.[0]?.name} at ${mine.rows?.[0]?.warehouse_name}`);

  // Another organization's books are not theirs.
  const otherOrg = (await c.query(
    `insert into organizations (name, slug) values ('Far Books','far-books') returning id`
  )).rows[0].id;
  const stranger = await mkUser("Far Boss", "admin", otherOrg);
  const across = await asUser(stranger,
    `select count(*)::int n from stock_ledger_variances where product_id = $1`, [p]);
  ok("another organization sees nothing of it",
     Number(across.rows?.[0]?.n) === 0, `(${across.rows?.[0]?.n})`);

  // And nobody is shown the cost of the product through it.
  const cols = (await c.query(
    `select column_name from information_schema.columns
      where table_name='stock_ledger_variances'`)).rows.map((r) => r.column_name);
  ok("the view carries no cost", !cols.some((x) => /cost/i.test(x)), cols.join(", "));
}

// ===================================================================
head("the view runs with the caller's own rights");
{
  const opt = (await c.query(
    `select coalesce((select option_value from pg_options_to_table(c.reloptions)
                       where option_name='security_invoker'),'off') v
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='stock_ledger_variances'`)).rows[0].v;
  ok("security_invoker is on", opt === "on", `(${opt})`);
}

console.log(`\n  ${pass} passed, ${fail} failed`);
await c.end();
process.exit(fail ? 1 : 0);
