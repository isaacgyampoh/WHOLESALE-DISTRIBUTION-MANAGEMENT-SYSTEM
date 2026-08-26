// The workflow the business actually runs:
//   warehouse -> van -> salesperson -> customer, with the driver
//   answering for the van but never selling from it.
//
// Also covers the other half of the same problem: getting stock into the
// system at all, which used to mean going through a stock count.
const { Client, CONN } = require('./lib');
let pass = 0, fail = 0;
const ok = (n, c, extra = '') => {
  c ? (pass++, console.log(`  PASS  ${n} ${extra}`)) : (fail++, console.log(`  FAIL  ${n} ${extra}`));
};
const q = async (c, s, p) => (await c.query(s, p)).rows;
const one = async (c, s, p) => (await q(c, s, p))[0];
const tryQ = async (c, s, p) => {
  try { return { ok: true, rows: await q(c, s, p) }; }
  catch (e) { return { ok: false, error: e.message }; }
};

// Unlike the rollback-based helper in test_scopes, these change who the
// session is for good: this suite builds up state across several people.
const actAs = async (c, uid) => {
  await c.query('reset role');
  await c.query(`select set_config('request.jwt.claims', $1, false)`,
                [JSON.stringify({ sub: uid, role: 'authenticated' })]);
  await c.query('set role authenticated');
};
const actAsOwner = async (c) => {
  await c.query('reset role');
  await c.query(`select set_config('request.jwt.claims', '', false)`);
};

(async () => {
  const c = new Client(CONN); await c.connect();

  const org = (await one(c, `select id from organizations where slug='default'`)).id;
  const wh = (await one(c, `select id from warehouses where code='WH-ACC'`)).id;
  const shop = (await one(c, `insert into warehouses (org_id, code, name, is_active)
    values ($1,'SHOP-01','Accra Shop Counter',true) returning id`, [org])).id;

  const mk = async (role, email, name) => (await one(c,
    `insert into auth.users (email, raw_user_meta_data) values ($1,$2::jsonb) returning id`,
    [email, JSON.stringify({ role, org_id: org, full_name: name })])).id;

  const admin = await mk('admin', 'admin@flow.test', 'Ada Admin');
  const manager = await mk('senior_manager', 'mgr@flow.test', 'Mensah Manager');
  const driverA = await mk('driver', 'kofi@flow.test', 'Kofi Driver');
  const sellerA = await mk('sales_rep', 'nana@flow.test', 'Nana Salesperson');
  const sellerB = await mk('sales_rep', 'yaw@flow.test', 'Yaw Salesperson');
  const shopSeller = await mk('sales_rep', 'esi@flow.test', 'Esi Counter');
  const loner = await mk('sales_rep', 'kwame@flow.test', 'Kwame Unassigned');

  const customer = (await one(c, `insert into customers (org_id, code, name, credit_limit, payment_terms_days)
    values ($1,'CUS-FLOW','Adjoa Provisions', 5000, 14) returning id`, [org])).id;

  // =================================================================
  console.log('\n=== opening stock at product creation ===');
  // =================================================================
  await actAs(c, admin);

  let r = await tryQ(c, `select id, sku, name from create_product_with_stock(
    p_sku := 'TOM-001', p_name := 'Tomatoes',
    p_warehouse_id := $1, p_opening_qty := 100,
    p_unit_of_measure := 'pieces', p_cost_price := 6, p_list_price := 10,
    p_reorder_point := 10)`, [wh]);
  ok('admin creates a product with opening stock', r.ok, r.ok ? '' : `(${r.error})`);
  const tomatoes = r.ok ? r.rows[0].id : null;

  let bal = await one(c, `select coalesce(qty_on_hand,0) h from inventory
                          where product_id=$1 and warehouse_id=$2`, [tomatoes, wh]);
  ok('stock is there immediately', Number(bal && bal.h) === 100, `(${bal && bal.h})`);

  const opening = await one(c, `select type, quantity, reason from stock_movements
                                where product_id=$1`, [tomatoes]);
  ok('opening balance is a ledger entry, not a column',
     opening && opening.type === 'opening_stock' && opening.quantity === 100,
     `(${opening && opening.type} ${opening && opening.quantity})`);

  r = await tryQ(c, `select id from create_product_with_stock(
    p_sku := 'MILK-001', p_name := 'Milk', p_warehouse_id := $1, p_opening_qty := 60,
    p_unit_of_measure := 'packs', p_cost_price := 8, p_list_price := 12)`, [wh]);
  const milk = r.ok ? r.rows[0].id : null;
  ok('second product created', r.ok, r.ok ? '' : `(${r.error})`);

  // =================================================================
  console.log('\n=== correcting stock keeps the history ===');
  // =================================================================
  await actAs(c, manager);
  r = await tryQ(c, `select type, quantity from adjust_stock_to($1,$2,90,'Correction after recount')`,
                 [tomatoes, wh]);
  ok('manager corrects 100 to 90', r.ok && r.rows[0].type === 'adjustment_out' && r.rows[0].quantity === 10,
     r.ok ? `(${r.rows[0].type} ${r.rows[0].quantity})` : `(${r.error})`);

  bal = await one(c, `select qty_on_hand h from inventory where product_id=$1 and warehouse_id=$2`, [tomatoes, wh]);
  ok('stock now reads 90', Number(bal.h) === 90, `(${bal.h})`);

  const history = await q(c, `select type, quantity, reason from stock_movements
                              where product_id=$1 order by created_at`, [tomatoes]);
  ok('both the opening balance and the correction survive', history.length === 2,
     `(${history.map(h => `${h.type}:${h.quantity}`).join(', ')})`);
  ok('the correction says why', history[1] && history[1].reason === 'Correction after recount',
     `("${history[1] && history[1].reason}")`);

  r = await tryQ(c, `select * from adjust_stock_to($1,$2,80,'')`, [tomatoes, wh]);
  ok('an adjustment without a reason is refused', !r.ok, r.ok ? '(ALLOWED)' : `-> "${r.error.slice(0, 40)}"`);

  await actAs(c, sellerA);
  r = await tryQ(c, `select * from adjust_stock_to($1,$2,10,'I want more')`, [tomatoes, wh]);
  ok('a salesperson cannot adjust stock', !r.ok, r.ok ? '(ADJUSTED)' : `-> "${r.error.slice(0, 40)}"`);

  await actAs(c, driverA);
  r = await tryQ(c, `select * from adjust_stock_to($1,$2,10,'Van needs more')`, [tomatoes, wh]);
  ok('a driver cannot adjust stock', !r.ok, r.ok ? '(ADJUSTED)' : `-> "${r.error.slice(0, 40)}"`);

  // =================================================================
  console.log('\n=== stock count is still stock count ===');
  // =================================================================
  await actAs(c, manager);
  r = await tryQ(c, `select record_stocktake($1, $2::jsonb, 'Monthly count') n`,
                 [wh, JSON.stringify([{ product_id: tomatoes, counted: 87 }, { product_id: milk, counted: 60 }])]);
  ok('a count posts only the lines that differ', r.ok && Number(r.rows[0].n) === 1,
     r.ok ? `(${r.rows[0].n} of 2 lines moved)` : `(${r.error})`);

  const take = await one(c, `select type, quantity from stock_movements
    where product_id=$1 and type in ('stocktake_in','stocktake_out')`, [tomatoes]);
  ok('the shortfall is a stocktake movement', take && take.type === 'stocktake_out' && take.quantity === 3,
     `(${take && take.type} ${take && take.quantity})`);

  // =================================================================
  console.log('\n=== warehouse -> van -> crew ===');
  // =================================================================
  await actAsOwner(c);
  await q(c, `select add_stock($1,$2,100,'Restock for the round')`, [tomatoes, wh]);
  await q(c, `select add_stock($1,$2,100,'Restock for the round')`, [milk, wh]);

  const vanA = (await one(c, `insert into vans (org_id, code, registration_no, home_warehouse_id)
    values ($1,'VAN-001','GT-0001-26',$2) returning id`, [org, wh])).id;
  const vanB = (await one(c, `insert into vans (org_id, code, registration_no, home_warehouse_id)
    values ($1,'VAN-002','GT-0002-26',$2) returning id`, [org, wh])).id;

  await q(c, `insert into van_assignments (org_id, van_id, member_id, crew_role) values
    ($1,$2,$3,'driver'), ($1,$2,$4,'salesperson'), ($1,$5,$6,'salesperson')`,
    [org, vanA, driverA, sellerA, vanB, sellerB]);
  ok('van 001 has a driver and a salesperson; van 002 has its own salesperson', true);

  const loadFor = async (van, tomQty, milkQty) => {
    const load = (await one(c, `insert into van_loads (org_id, van_id, driver_id, warehouse_id, status,
      driver_confirmed_at, opening_float) values ($1,$2,$3,$4,'loaded',now(),100) returning id`,
      [org, van, driverA, wh])).id;
    await q(c, `insert into van_load_items (org_id, load_id, product_id, qty_loaded, unit_price, unit_cost)
      values ($1,$2,$3,$4,10,6), ($1,$2,$5,$6,12,8)`, [org, load, tomatoes, tomQty, milk, milkQty]);
    await q(c, `select dispatch_van_load($1)`, [load]);
    return load;
  };
  // VAN-002 needs its own driver for its own load.
  const driverB = await mk('driver', 'kojo@flow.test', 'Kojo Driver');
  await q(c, `insert into van_assignments (org_id, van_id, member_id, crew_role) values ($1,$2,$3,'driver')`,
          [org, vanB, driverB]);
  const loadA = await loadFor(vanA, 50, 30);
  await q(c, `insert into van_loads (org_id, van_id, driver_id, warehouse_id, status, driver_confirmed_at)
    values ($1,$2,$3,$4,'loaded',now()) returning id`, [org, vanB, driverB, wh]);
  const loadB = (await one(c, `select id from van_loads where van_id=$1 and status='loaded'`, [vanB])).id;
  await q(c, `insert into van_load_items (org_id, load_id, product_id, qty_loaded, unit_price, unit_cost)
    values ($1,$2,$3,100,10,6)`, [org, loadB, tomatoes]);
  await q(c, `select dispatch_van_load($1)`, [loadB]);

  const vanQty = async (van, product) => Number((await one(c,
    `select coalesce(qty_on_hand,0) h from van_inventory where van_id=$1 and product_id=$2`,
    [van, product])) ?.h ?? 0);

  ok('VAN-001 loaded with 50 tomatoes', await vanQty(vanA, tomatoes) === 50);
  ok('VAN-002 loaded with 100 tomatoes', await vanQty(vanB, tomatoes) === 100);

  // =================================================================
  console.log('\n=== the driver: sees everything, sells nothing ===');
  // =================================================================
  await actAs(c, driverA);

  const driverStock = await q(c, `select product_name, qty_on_hand from van_stock_summary order by product_name`);
  ok('driver sees their van stock', driverStock.length === 2
     && Number(driverStock.find(s => s.product_name === 'Tomatoes').qty_on_hand) === 50,
     `(${driverStock.map(s => `${s.product_name} ${s.qty_on_hand}`).join(', ')})`);

  const otherVanRows = await q(c, `select count(*)::int n from van_inventory where van_id=$1`, [vanB]);
  ok('driver cannot see the other van', otherVanRows[0].n === 0, `(${otherVanRows[0].n})`);

  r = await tryQ(c, `select * from record_sale($1, $2::jsonb, 'cash')`,
                 [customer, JSON.stringify([{ product_id: tomatoes, quantity: 1 }])]);
  ok('driver cannot record a sale', !r.ok, r.ok ? '(SOLD)' : `-> "${r.error.slice(0, 46)}"`);

  r = await tryQ(c, `insert into van_sales (org_id, van_id, salesperson_id, customer_id, sale_type)
    values ($1,$2,$3,$4,'cash') returning id`, [org, vanA, driverA, customer]);
  ok('driver cannot write a sale row directly either', !r.ok, r.ok ? '(INSERTED)' : '(blocked)');

  r = await tryQ(c, `insert into stock_movements (org_id, product_id, van_id, type, quantity)
    values ($1,$2,$3,'adjustment_out',5) returning id`, [org, tomatoes, vanA]);
  ok('driver cannot take stock off the van by hand', !r.ok, r.ok ? '(ALLOWED)' : '(blocked)');

  // =================================================================
  console.log('\n=== the salesperson sells from their own van ===');
  // =================================================================
  await actAs(c, sellerA);

  const visible = await q(c, `select name from products order by name`);
  ok('field salesperson sees only what is on their van',
     visible.length === 2 && visible.every(p => ['Tomatoes', 'Milk'].includes(p.name)),
     `(${visible.map(p => p.name).join(', ')})`);

  const seenVanStock = await q(c, `select van_id, qty_on_hand from van_inventory`);
  ok("and only their own van's quantities",
     seenVanStock.length === 2 && seenVanStock.every(s => s.van_id === vanA),
     `(${seenVanStock.length} rows, all van 001: ${seenVanStock.every(s => s.van_id === vanA)})`);

  r = await tryQ(c, `select id, sale_number, total, status, van_id, warehouse_id, salesperson_id
    from record_sale($1, $2::jsonb, 'cash')`,
    [customer, JSON.stringify([{ product_id: tomatoes, quantity: 5 }])]);
  ok('salesperson completes a cash sale', r.ok && r.rows[0].status === 'completed',
     r.ok ? `(${r.rows[0].sale_number}, GHS ${r.rows[0].total})` : `(${r.error})`);
  const sale1 = r.ok ? r.rows[0] : null;

  ok('the sale is stamped with the salesperson, not the driver',
     sale1 && sale1.salesperson_id === sellerA);
  ok('the sale is against the van, not the warehouse',
     sale1 && sale1.van_id === vanA && sale1.warehouse_id === null);

  await actAsOwner(c);
  ok('van stock fell from 50 to 45', await vanQty(vanA, tomatoes) === 45,
     `(${await vanQty(vanA, tomatoes)})`);
  ok('the other van was untouched', await vanQty(vanB, tomatoes) === 100);

  const whAfterSale = await one(c, `select qty_on_hand h from inventory where product_id=$1 and warehouse_id=$2`,
                                [tomatoes, wh]);
  ok('the warehouse was not double-counted', Number(whAfterSale.h) === 87 + 100 - 50 - 100,
     `(warehouse=${whAfterSale.h})`);

  const mv = await one(c, `select van_id, warehouse_id, type, quantity from stock_movements
    where reference_type='van_sale' and reference_id=$1`, [sale1.id]);
  ok('the movement is against the van', mv && mv.van_id === vanA && mv.warehouse_id === null
     && mv.type === 'issue' && mv.quantity === 5,
     `(${mv && mv.type} ${mv && mv.quantity} @${mv && mv.van_id ? 'van' : 'warehouse'})`);

  // =================================================================
  console.log('\n=== the driver sees what the salesperson sold ===');
  // =================================================================
  await actAs(c, driverA);
  const activity = await q(c, `select product_name, qty_before_sales, qty_sold_today, qty_remaining
    from van_day_activity order by product_name`);
  const tomRow = activity.find(a => a.product_name === 'Tomatoes');
  ok('driver dashboard shows 50 before sales, 5 sold, 45 left',
     tomRow && Number(tomRow.qty_before_sales) === 50 && Number(tomRow.qty_sold_today) === 5
     && Number(tomRow.qty_remaining) === 45,
     tomRow ? `(${tomRow.qty_before_sales} - ${tomRow.qty_sold_today} = ${tomRow.qty_remaining})` : '(no row)');

  const driverSees = await q(c, `select sale_number, salesperson_name, quantity from sale_lines`);
  ok('driver can read the sale made from their van',
     driverSees.length === 1 && driverSees[0].salesperson_name === 'Nana Salesperson',
     `(${driverSees.map(s => `${s.sale_number} by ${s.salesperson_name}`).join(', ')})`);

  // =================================================================
  console.log('\n=== overselling ===');
  // =================================================================
  // Counted with row level security out of the way, so "before" and
  // "after" are the same population.
  await actAsOwner(c);
  const salesBefore = Number((await one(c, `select count(*)::int n from van_sales`)).n);

  await actAs(c, sellerA);
  r = await tryQ(c, `select * from record_sale($1, $2::jsonb, 'cash')`,
                 [customer, JSON.stringify([{ product_id: tomatoes, quantity: 46 }])]);
  ok('selling 46 of 45 is refused', !r.ok, r.ok ? '(SOLD)' : `-> "${r.error.slice(0, 50)}"`);
  ok('and the message says how many there are',
     !r.ok && /Only 45 units of Tomatoes/.test(r.error), `(${!r.ok ? r.error.slice(0, 40) : ''})`);

  await actAsOwner(c);
  const salesAfter = Number((await one(c, `select count(*)::int n from van_sales`)).n);
  ok('the rejected sale left nothing behind', salesAfter === salesBefore,
     `(${salesBefore} -> ${salesAfter})`);
  ok('and did not move any stock', await vanQty(vanA, tomatoes) === 45);

  // =================================================================
  console.log("\n=== one van's salesperson cannot reach another van ===");
  // =================================================================
  await actAs(c, sellerB);
  const bStock = await q(c, `select van_id, qty_on_hand from van_inventory`);
  ok('van 002 salesperson sees only van 002', bStock.every(s => s.van_id === vanB) && bStock.length > 0,
     `(${bStock.length} rows)`);

  r = await tryQ(c, `select van_id, total from record_sale($1, $2::jsonb, 'cash')`,
                 [customer, JSON.stringify([{ product_id: tomatoes, quantity: 3 }])]);
  ok('their sale comes off their own van, whatever they ask for',
     r.ok && r.rows[0].van_id === vanB, r.ok ? '' : `(${r.error})`);

  await actAsOwner(c);
  ok('van 002 stock fell', await vanQty(vanB, tomatoes) === 97, `(${await vanQty(vanB, tomatoes)})`);
  ok('van 001 stock did not', await vanQty(vanA, tomatoes) === 45);

  // =================================================================
  console.log('\n=== the in-shop salesperson ===');
  // =================================================================
  await actAsOwner(c);
  await q(c, `update profiles set sales_warehouse_id=$1 where id=$2`, [shop, shopSeller]);
  await q(c, `select add_stock($1,$2,40,'Counter stock')`, [tomatoes, shop]);

  await actAs(c, shopSeller);
  r = await tryQ(c, `select id, van_id, warehouse_id, total, status from record_sale($1, $2::jsonb, 'cash')`,
                 [customer, JSON.stringify([{ product_id: tomatoes, quantity: 4 }])]);
  ok('counter salesperson sells without a van',
     r.ok && r.rows[0].warehouse_id === shop && r.rows[0].van_id === null,
     r.ok ? `(GHS ${r.rows[0].total})` : `(${r.error})`);

  // A shop seller naming someone else's warehouse still sells their own.
  r = await tryQ(c, `select warehouse_id from record_sale($1, $2::jsonb, 'cash', null, $3)`,
                 [customer, JSON.stringify([{ product_id: tomatoes, quantity: 1 }]), wh]);
  ok('a warehouse id from the request is ignored', r.ok && r.rows[0].warehouse_id === shop,
     r.ok ? '' : `(${r.error})`);

  await actAsOwner(c);
  const shopLeft = await one(c, `select qty_on_hand h from inventory where product_id=$1 and warehouse_id=$2`,
                             [tomatoes, shop]);
  ok('shop stock fell by 5, main warehouse untouched', Number(shopLeft.h) === 35, `(shop=${shopLeft.h})`);

  await actAs(c, shopSeller);
  r = await tryQ(c, `update profiles set sales_warehouse_id=$1 where id=$2 returning id`, [wh, shopSeller]);
  ok('a seller cannot move themselves to another location', !r.ok || r.rows.length === 0,
     r.ok ? '(MOVED)' : '(blocked)');

  // =================================================================
  console.log('\n=== a salesperson with nowhere to sell from ===');
  // =================================================================
  await actAs(c, loner);
  r = await tryQ(c, `select * from record_sale($1, $2::jsonb, 'cash')`,
                 [customer, JSON.stringify([{ product_id: tomatoes, quantity: 1 }])]);
  ok('unassigned salesperson is told what is missing', !r.ok && /no van assignment/.test(r.error),
     r.ok ? '(SOLD)' : `-> "${r.error.slice(0, 44)}"`);

  // =================================================================
  console.log('\n=== credit sale ===');
  // =================================================================
  await actAs(c, sellerA);
  r = await tryQ(c, `select id, sale_number, total, balance, due_date, status
    from record_sale($1, $2::jsonb, 'credit', 0)`,
    [customer, JSON.stringify([{ product_id: milk, quantity: 2 }])]);
  ok('credit sale completes', r.ok && r.rows[0].status === 'completed', r.ok ? '' : `(${r.error})`);
  const creditSale = r.ok ? r.rows[0] : null;
  ok('it carries a balance and a due date',
     creditSale && Number(creditSale.balance) > 0 && creditSale.due_date !== null,
     creditSale ? `(balance ${creditSale.balance}, due ${String(creditSale.due_date).slice(0, 10)})` : '');

  await actAsOwner(c);
  const charge = await one(c, `select type, amount from credit_transactions where reference_id=$1`, [creditSale.id]);
  ok('the customer ledger is charged', charge && charge.type === 'charge'
     && Number(charge.amount) === Number(creditSale.total), `(${charge && charge.amount})`);

  // A customer whose limit the next sale would break. The stock is on
  // the van, so a refusal here can only be about the credit.
  const tightCustomer = (await one(c, `insert into customers (org_id, code, name, credit_limit)
    values ($1,'CUS-TIGHT','Small Kiosk', 10) returning id`, [org])).id;
  await actAs(c, sellerA);
  r = await tryQ(c, `select * from record_sale($1,$2::jsonb,'credit',0)`,
    [tightCustomer, JSON.stringify([{ product_id: milk, quantity: 2 }])]);
  ok('a credit sale beyond the limit is refused', !r.ok && /Credit limit/.test(r.error || ''),
     r.ok ? '(ALLOWED)' : `-> "${r.error.slice(0, 44)}"`);

  await actAsOwner(c);
  const orphans = Number((await one(c,
    `select count(*)::int n from van_sales where customer_id=$1`, [tightCustomer])).n);
  ok('the refused credit sale left no half-written sale behind', orphans === 0, `(${orphans})`);

  // =================================================================
  console.log('\n=== a sale cannot slip past a manager category scope ===');
  // =================================================================
  // record_sale is SECURITY DEFINER, so the products policy does not
  // apply inside it. A scoped manager must still be held to their
  // categories, or selling would be the way around the scope.
  await actAsOwner(c);
  const scopedMgr = await mk('manager', 'scoped@flow.test', 'Kofi Scoped');
  await q(c, `delete from manager_category_scopes where profile_id=$1`, [scopedMgr]);
  const someCategory = (await one(c, `select id from categories limit 1`)).id;
  await q(c, `insert into manager_category_scopes (org_id, profile_id, category_id) values ($1,$2,$3)`,
          [org, scopedMgr, someCategory]);

  await actAs(c, scopedMgr);
  r = await tryQ(c, `select * from record_sale($1, $2::jsonb, 'cash', null, $3)`,
    [customer, JSON.stringify([{ product_id: tomatoes, quantity: 1 }]), wh]);
  ok('a scoped manager cannot sell outside their categories', !r.ok,
     r.ok ? '(SOLD)' : `-> "${r.error.slice(0, 44)}"`);

  console.log('\n=== a malformed sale is refused, not half-written ===');
  await actAs(c, sellerA);
  r = await tryQ(c, `select * from record_sale($1, $2::jsonb, 'cash')`,
    [customer, JSON.stringify([{ product_id: tomatoes, quantity: 0 }])]);
  ok('a zero quantity is refused by name', !r.ok && /positive number/.test(r.error || ''),
     r.ok ? '(SOLD)' : `-> "${r.error.slice(0, 44)}"`);

  r = await tryQ(c, `select * from record_sale($1, $2::jsonb, 'cash')`, [customer, JSON.stringify([])]);
  ok('an empty sale is refused', !r.ok, r.ok ? '(SOLD)' : `-> "${r.error.slice(0, 44)}"`);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await actAsOwner(c);
  await c.end();
  process.exit(fail ? 1 : 0);
})();
