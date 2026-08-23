import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Client, CONN } = require("./lib.js");

/**
 * A driver is not a salesperson.
 *
 * The schema used to treat them as one person: every van record was
 * keyed on driver_id, and the driver role held sales.create. That put
 * the wrong name on every receipt and handed the till to whoever was
 * behind the wheel.
 *
 * What is tested here is that the separation is real - enforced by the
 * database rather than by which buttons the interface offers - and that
 * the history from before it stayed valid.
 */
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

const stamp = Date.now().toString(36);
const c = new Client(CONN); await c.connect();
const orgA = (await c.query("select id from organizations where slug='default'")).rows[0].id;
const orgB = (await c.query(
  `insert into organizations (name, slug) values ('Crew Rival',$1) returning id`,
  [`crew-rival-${stamp}`])).rows[0].id;

const mk = async (name, role, org = orgA, active = true) => (await c.query(
  `insert into auth.users (email, raw_user_meta_data) values ($1,$2::jsonb) returning id`,
  [`${name}-${stamp}@crew.test`,
   JSON.stringify({ full_name: name, role, org_id: org })])).rows[0].id
  .then?.(x => x) ?? (await c.query(
  `select id from profiles where id = (select id from auth.users where email=$1)`,
  [`${name}-${stamp}@crew.test`])).rows[0].id;

const mkUser = async (name, role, org = orgA) => {
  const id = (await c.query(
    `insert into auth.users (email, raw_user_meta_data) values ($1,$2::jsonb) returning id`,
    [`${name}-${stamp}@crew.test`,
     JSON.stringify({ full_name: name, role, org_id: org })])).rows[0].id;
  return id;
};

const as = async (who, sql, params) => {
  await c.query("begin");
  await c.query("select set_config('request.jwt.claims',$1,true)",
    [JSON.stringify({ sub: who, role: "authenticated" })]);
  await c.query("set local role authenticated");
  try { return { ok: true, rows: (await c.query(sql, params)).rows }; }
  catch (e) { return { ok: false, error: e.message }; }
  finally { await c.query("rollback"); }
};

/** Act for real as somebody, so audit columns get filled. */
const acting = async (who, sql, params) => {
  await c.query("select set_config('request.jwt.claims',$1,false)",
    [JSON.stringify({ sub: who, role: "authenticated" })]);
  try { return (await c.query(sql, params)).rows; }
  finally { await c.query("select set_config('request.jwt.claims','',false)"); }
};

const driver     = await mkUser("crewdrv", "driver");
const driver2    = await mkUser("crewdrv2", "driver");
const seller     = await mkUser("crewsell", "salesperson");
const seller2    = await mkUser("crewsell2", "salesperson");
const manager    = await mkUser("crewmgr", "manager");
const rival      = await mkUser("crewrival", "admin", orgB);
const inactive   = await mkUser("crewgone", "salesperson");
await c.query(`update profiles set is_active = false where id = $1`, [inactive]);

// ---- a van with stock ----------------------------------------------
const wh = (await c.query(
  `insert into warehouses (org_id, code, name) values ($1,$2,'Crew Depot') returning id`,
  [orgA, `CRWH-${stamp}`.slice(0, 12)])).rows[0].id;
const cat = (await c.query(
  `insert into categories (org_id, name) values ($1,$2) returning id`,
  [orgA, `Crew Cat ${stamp}`])).rows[0].id;
const product = (await c.query(
  `insert into products (org_id, sku, name, category_id, unit_of_measure, cost_price, list_price, tax_rate)
   values ($1,$2,'Crew Product',$3,'case',10,100,0) returning id`,
  [orgA, `CRW-${stamp}`.slice(0, 20), cat])).rows[0].id;
const customer = (await c.query(
  `insert into customers (org_id, code, name, credit_limit) values ($1,$2,'Crew Customer',500000) returning id`,
  [orgA, `CRWC-${stamp}`.slice(0, 12)])).rows[0].id;
const van = (await c.query(
  `insert into vans (org_id, code, registration_no, home_warehouse_id) values ($1,$2,$3,$4) returning id`,
  [orgA, `CRWV-${stamp}`.slice(0, 12), `GC-${stamp}`.slice(0, 14), wh])).rows[0].id;
await c.query(
  `insert into stock_movements (org_id, product_id, warehouse_id, type, quantity, reason)
   values ($1,$2,$3,'receipt',2000,'Opening')`, [orgA, product, wh]);

// ====================================================================
console.log("\n-- a van has a crew, not a driver --");
// ====================================================================

await c.query(
  `insert into van_assignments (org_id, van_id, member_id, crew_role) values ($1,$2,$3,'driver')`,
  [orgA, van, driver]);
ok("a driver can be crewed", true);

await c.query(
  `insert into van_assignments (org_id, van_id, member_id, crew_role) values ($1,$2,$3,'salesperson')`,
  [orgA, van, seller]);
await c.query(
  `insert into van_assignments (org_id, van_id, member_id, crew_role) values ($1,$2,$3,'salesperson')`,
  [orgA, van, seller2]);
ok("and more than one salesperson alongside them", Number((await c.query(
  `select count(*)::int n from van_assignments
    where van_id=$1 and crew_role='salesperson' and unassigned_at is null`, [van])).rows[0].n) === 2);

const twoDrivers = await c.query(
  `insert into van_assignments (org_id, van_id, member_id, crew_role) values ($1,$2,$3,'driver')`,
  [orgA, van, driver2]).then(() => null, e => e.message);
ok("but only one driver", twoDrivers !== null, "a second is refused");

const sellerAsDriver = await c.query(
  `insert into van_assignments (org_id, van_id, member_id, crew_role) values ($1,$2,$3,'driver')`,
  [orgA, van, seller]).then(() => null, e => e.message);
ok("a salesperson cannot be crewed to drive", sellerAsDriver !== null,
   sellerAsDriver?.split("\n")[0]?.slice(0, 60));

const driverAsSeller = await c.query(
  `insert into van_assignments (org_id, van_id, member_id, crew_role) values ($1,$2,$3,'salesperson')`,
  [orgA, van, driver2]).then(() => null, e => e.message);
ok("nor a driver to sell", driverAsSeller !== null, "that would hand them the till");

const gone = await c.query(
  `insert into van_assignments (org_id, van_id, member_id, crew_role) values ($1,$2,$3,'salesperson')`,
  [orgA, van, inactive]).then(() => null, e => e.message);
ok("somebody deactivated cannot be crewed", gone !== null);

const foreign = await c.query(
  `insert into van_assignments (org_id, van_id, member_id, crew_role) values ($1,$2,$3,'salesperson')`,
  [orgA, van, rival]).then(() => null, e => e.message);
ok("nor somebody from another organization", foreign !== null);

// A second van, to prove somebody cannot be on two at once.
const van2 = (await c.query(
  `insert into vans (org_id, code, registration_no, home_warehouse_id) values ($1,$2,$3,$4) returning id`,
  [orgA, `CRWV2-${stamp}`.slice(0, 12), `GC2-${stamp}`.slice(0, 14), wh])).rows[0].id;
const twoVans = await c.query(
  `insert into van_assignments (org_id, van_id, member_id, crew_role) values ($1,$2,$3,'salesperson')`,
  [orgA, van2, seller]).then(() => null, e => e.message);
ok("and nobody is on two vans at once", twoVans !== null);

// ====================================================================
console.log("\n-- the van resolves for anybody aboard --");
// ====================================================================

const driverSees = await as(driver, `select my_van_id() v`);
ok("a driver's van resolves", driverSees.rows[0].v === van);

const sellerSees = await as(seller, `select my_van_id() v`);
ok("and so does a salesperson's", sellerSees.rows[0].v === van,
   "they need the stock to sell from it");

const strangerSees = await as(manager, `select my_van_id() v`);
ok("somebody not crewed has no van", strangerSees.rows[0].v === null);

const crewCheck = await as(seller, `select is_van_crew($1) v`, [van]);
ok("crew membership is answerable in one place", crewCheck.rows[0].v === true);
const notCrew = await as(seller, `select is_van_crew($1) v`, [van2]);
ok("and says no for a van they are not on", notCrew.rows[0].v === false);

// ====================================================================
console.log("\n-- a van does not go out without somebody to sell --");
// ====================================================================

const mkLoad = async (vanId, driverId) => {
  const load = (await c.query(
    `insert into van_loads (org_id, van_id, driver_id, warehouse_id, status, load_date,
       driver_confirmed_at, opening_float)
     values ($1,$2,$3,$4,'loaded',current_date, now(), 100) returning id, load_number`,
    [orgA, vanId, driverId, wh])).rows[0];
  await c.query(
    `insert into van_load_items (org_id, load_id, product_id, qty_loaded, unit_price, unit_cost)
     values ($1,$2,$3,500,100,10)`, [orgA, load.id, product]);
  return load;
};

// van2 has nobody on it at all.
await c.query(
  `insert into van_assignments (org_id, van_id, member_id, crew_role) values ($1,$2,$3,'driver')`,
  [orgA, van2, driver2]);
const lonely = await mkLoad(van2, driver2);
const noSeller = await c.query(`select dispatch_van_load($1)`, [lonely.id])
  .then(() => null, e => e.message);
ok("a van with a driver and nobody selling is refused", noSeller !== null,
   "goods would leave with no way to record what happened to them");
ok("and nothing moved", Number((await c.query(
  `select count(*)::int n from stock_movements where reference_type='van_load' and reference_id=$1`,
  [lonely.id])).rows[0].n) === 0);

const load = await mkLoad(van, driver);
await c.query(`select dispatch_van_load($1)`, [load.id]);
ok("a crewed van dispatches", (await c.query(
  `select status from van_loads where id=$1`, [load.id])).rows[0].status === "dispatched");

const snapshot = (await c.query(
  `select member_id, crew_role from van_load_crew where load_id=$1 order by crew_role`,
  [load.id])).rows;
ok("and the crew is snapshotted onto the load", snapshot.length === 3,
   `${snapshot.length} people recorded`);
ok("naming the driver", snapshot.some(r => r.crew_role === "driver" && r.member_id === driver));
ok("and both salespeople",
   snapshot.filter(r => r.crew_role === "salesperson").length === 2);

// ====================================================================
console.log("\n-- a sale belongs to whoever made it --");
// ====================================================================

const sell = async (who, qty, saleType = "cash") => {
  const rows = await acting(who,
    `insert into van_sales (org_id, load_id, van_id, customer_id, sale_type, status, sold_at)
     values ($1,$2,$3,$4,$5,'draft',now()) returning id, salesperson_id, driver_id`,
    [orgA, load.id, van, customer, saleType]);
  const sale = rows[0];
  await c.query(
    `insert into van_sale_items (org_id, sale_id, product_id, quantity, unit_price, tax_rate)
     values ($1,$2,$3,$4,100,0)`, [orgA, sale.id, product, qty]);
  return sale;
};

const sale = await sell(seller, 3);
ok("the salesperson is recorded as having made it", sale.salesperson_id === seller);
ok("and the driver as having driven", sale.driver_id === driver,
   "taken from the load, not asked for");

await acting(seller, `select complete_van_sale($1, 300)`, [sale.id]);
ok("the salesperson can complete their own sale", (await c.query(
  `select status from van_sales where id=$1`, [sale.id])).rows[0].status === "completed");

const theirs = await sell(seller, 2);
const driverCompletes = await as(driver, `select complete_van_sale($1, 200)`, [theirs.id]);
ok("the driver cannot complete somebody else's sale", !driverCompletes.ok,
   driverCompletes.error?.split("\n")[0]?.slice(0, 62));

const otherSeller = await as(seller2, `select complete_van_sale($1, 200)`, [theirs.id]);
ok("nor can another salesperson", !otherSeller.ok);

// A sale cannot be booked in somebody else's name.
const impersonate = await as(seller,
  `insert into van_sales (org_id, load_id, van_id, customer_id, salesperson_id, sale_type, status, sold_at)
   values ($1,$2,$3,$4,$5,'cash','draft',now()) returning id`,
  [orgA, load.id, van, customer, seller2]);
ok("a sale cannot be recorded in a colleague's name", !impersonate.ok || !impersonate.rows.length,
   "that is how a shortage gets moved onto somebody else");

// ====================================================================
console.log("\n-- the driver does not sell --");
// ====================================================================

const driverSells = await as(driver,
  `insert into van_sales (org_id, load_id, van_id, customer_id, sale_type, status, sold_at)
   values ($1,$2,$3,$4,'cash','draft',now()) returning id`,
  [orgA, load.id, van, customer]);
ok("a driver cannot open a sale", !driverSells.ok || driverSells.rows.length === 0,
   "the insert policy requires them to be the salesperson");

const driverReads = await as(driver,
  `select count(*)::int n from van_sales where id=$1`, [sale.id]);
ok("but can see what the round sold", driverReads.ok && driverReads.rows[0].n === 1,
   "it is their van");

// ====================================================================
console.log("\n-- history survived the change --");
// ====================================================================

const backfilled = (await c.query(
  `select count(*)::int n from van_sales where salesperson_id is null`)).rows[0].n;
ok("no sale is left without a salesperson", Number(backfilled) === 0);

const oldAssignments = (await c.query(
  `select count(*)::int n from van_assignments where crew_role is null`)).rows[0].n;
ok("every assignment has a job", Number(oldAssignments) === 0);

const perf = (await c.query(
  `select * from salesperson_performance where salesperson_id=$1`, [seller])).rows[0];
ok("performance is attributed to the seller", !!perf && Number(perf.sale_count) >= 1,
   `${perf?.sale_count} sales`);

// ====================================================================
console.log("\n-- mobile money knows its network --");
// ====================================================================

const momoSale = await sell(seller, 1);
await c.query(`select record_sale_payments($1,$2::jsonb)`,
  [momoSale.id, JSON.stringify([
    { method: "mobile_money", amount: 100, reference: "MM-4471", provider: "mtn" },
  ])]);
const recorded = (await c.query(
  `select method, provider, reference from van_sale_payments where sale_id=$1`,
  [momoSale.id])).rows[0];
ok("the network is recorded beside the reference", recorded.provider === "mtn");
await acting(seller, `select complete_van_sale($1, 100)`, [momoSale.id]);

const badProvider = await c.query(`select record_sale_payments($1,$2::jsonb)`,
  [(await sell(seller, 1)).id,
   JSON.stringify([{ method: "mobile_money", amount: 100, provider: "vodafone" }])])
  .then(() => null, e => e.message);
ok("an unknown network is refused", badProvider !== null, "networks rebrand; guesses do not");

const cashWithProvider = await c.query(
  `insert into van_sale_payments (org_id, sale_id, method, amount, provider)
   values ($1,$2,'cash',10,'mtn')`, [orgA, momoSale.id]).then(() => null, e => e.message);
ok("a network on a cash payment is refused", cashWithProvider !== null, "it is meaningless");

const recon = (await c.query(
  `select * from momo_reconciliation where provider='mtn' and salesperson_id=$1`, [seller])).rows[0];
ok("mobile money reconciles by network, van and salesperson", !!recon,
   `₵${recon?.total_amount} on ${recon?.provider_name}`);

// ====================================================================
console.log("\n-- who may change a crew --");
// ====================================================================

const sellerCrews = await as(seller,
  `insert into van_assignments (org_id, van_id, member_id, crew_role)
   values ($1,$2,$3,'salesperson') returning id`, [orgA, van2, seller2]);
ok("a salesperson cannot crew themselves onto a van",
   !sellerCrews.ok || sellerCrews.rows.length === 0);

const rivalReads = await as(rival,
  `select count(*)::int n from van_assignments where org_id=$1`, [orgA]);
ok("another organization sees none of this crew", rivalReads.ok && rivalReads.rows[0].n === 0);

console.log(`\n  ${pass} passed, ${fail} failed`);
await c.end();
process.exit(fail ? 1 : 0);
