const { Client, CONN } = require('./lib');
let pass = 0, fail = 0;
const ok = (n, c, extra='') => { c ? (pass++, console.log(`  PASS  ${n} ${extra}`)) : (fail++, console.log(`  FAIL  ${n} ${extra}`)); };
const q = async (c, s, p) => (await c.query(s, p)).rows;
const one = async (c, s, p) => (await q(c, s, p))[0];

async function as(c, uid, fn) {
  await c.query('begin');
  await c.query(`select set_config('request.jwt.claims',$1,true)`,
                [JSON.stringify({ sub: uid, role: 'authenticated' })]);
  await c.query('set local role authenticated');
  try { return { ok: true, value: await fn() }; }
  catch (e) { return { ok: false, error: e.message }; }
  finally { await c.query('rollback'); }
}

(async () => {
  const c = new Client(CONN); await c.connect();
  const org = (await one(c, `select id from organizations where slug='default'`)).id;
  const wh  = (await one(c, `select id from warehouses where code='WH-ACC'`)).id;

  const bev = (await one(c, `select id from categories where name='Beverages'`)).id;
  const dry = (await one(c, `select id from categories where name='Dry Goods'`)).id;

  const mk = async (role, email) => (await one(c, `insert into auth.users (email, raw_user_meta_data)
    values ($1,$2::jsonb) returning id`, [email, JSON.stringify({ role, org_id: org, full_name: role })])).id;

  const mgr1 = await mk('manager', 'mgr1@scope.test');
  const mgr2 = await mk('manager', 'mgr2@scope.test');
  const senior = await mk('senior_manager', 'senior@scope.test');
  const driver = await mk('driver', 'drv@scope.test');

  // Managers created after 0013 have no scopes; grant one category each.
  await q(c, `delete from manager_category_scopes where profile_id in ($1,$2)`, [mgr1, mgr2]);
  await q(c, `insert into manager_category_scopes (org_id, profile_id, category_id) values ($1,$2,$3)`, [org, mgr1, bev]);
  await q(c, `insert into manager_category_scopes (org_id, profile_id, category_id) values ($1,$2,$3)`, [org, mgr2, dry]);

  const nBev = (await one(c, `select count(*)::int n from products where category_id=$1`, [bev])).n;
  const nDry = (await one(c, `select count(*)::int n from products where category_id=$1`, [dry])).n;
  // Scoped to this organization: other tenants' products are invisible anyway.
  const nAll = (await one(c, `select count(*)::int n from products where org_id=$1`, [org])).n;
  console.log(`  catalogue: ${nAll} products (Beverages ${nBev}, Dry Goods ${nDry})`);

  console.log('\n=== category manager scoping ===');
  let r = await as(c, mgr1, () => q(c, `select count(*)::int n from products`));
  ok('manager 1 sees only Beverages', r.ok && r.value[0].n === nBev, `(${r.ok ? r.value[0].n : r.error})`);

  r = await as(c, mgr2, () => q(c, `select count(*)::int n from products`));
  ok('manager 2 sees only Dry Goods', r.ok && r.value[0].n === nDry, `(${r.ok ? r.value[0].n : r.error})`);

  r = await as(c, mgr1, () => q(c, `select count(*)::int n from products where category_id=$1`, [dry]));
  ok('manager 1 cannot see restricted category', r.ok && r.value[0].n === 0, `(${r.ok ? r.value[0].n : r.error})`);

  r = await as(c, senior, () => q(c, `select count(*)::int n from products`));
  ok('senior manager sees everything', r.ok && r.value[0].n === nAll, `(${r.ok ? r.value[0].n : r.error})`);

  const dryProd = (await one(c, `select id from products where category_id=$1 limit 1`, [dry])).id;
  r = await as(c, mgr1, () => q(c, `update products set name='hijacked' where id=$1 returning id`, [dryProd]));
  ok('manager 1 cannot edit out-of-scope product', r.ok && r.value.length === 0, r.ok ? `(${r.value.length} rows)` : '(blocked)');

  const bevProd = (await one(c, `select id from products where category_id=$1 limit 1`, [bev])).id;
  r = await as(c, mgr1, () => q(c, `update products set name='renamed ok' where id=$1 returning id`, [bevProd]));
  ok('manager 1 can edit in-scope product', r.ok && r.value.length === 1, r.ok ? '' : `(${r.error})`);

  console.log('\n=== scope escalation ===');
  r = await as(c, mgr1, () => q(c, `insert into manager_category_scopes (org_id, profile_id, category_id)
                                    values ($1,$2,$3) returning id`, [org, mgr1, dry]));
  ok('manager cannot grant themselves a category', !r.ok, r.ok ? '(GRANTED)' : '(blocked)');

  r = await as(c, mgr1, () => q(c, `update profiles set role='senior_manager' where id=$1 returning role`, [mgr1]));
  ok('manager cannot promote self', !r.ok, r.ok ? '(PROMOTED)' : '(blocked)');

  console.log('\n=== driver ===');
  const van = (await one(c, `insert into vans (org_id, code, registration_no, home_warehouse_id)
    values ($1,'VAN-99','GT-9999-24',$2) returning id`, [org, wh])).id;
  const otherVan = (await one(c, `insert into vans (org_id, code, registration_no)
    values ($1,'VAN-98','GT-9998-24') returning id`, [org])).id;
  await q(c, `insert into van_assignments (org_id, van_id, driver_id) values ($1,$2,$3)`, [org, van, driver]);

  // Put two products on the driver's van.
  const load = (await one(c, `insert into van_loads (org_id, van_id, driver_id, warehouse_id, status, driver_confirmed_at)
    values ($1,$2,$3,$4,'loaded',now()) returning id`, [org, van, driver, wh])).id;
  const twoProds = await q(c, `select id, cost_price, list_price from products where category_id=$1 limit 2`, [bev]);
  for (const p of twoProds) {
    await q(c, `insert into van_load_items (org_id, load_id, product_id, qty_loaded, unit_price, unit_cost)
                values ($1,$2,$3,20,$4,$5)`, [org, load, p.id, p.list_price, p.cost_price]);
  }
  await q(c, `select dispatch_van_load($1)`, [load]);

  r = await as(c, driver, () => q(c, `select count(*)::int n from vans`));
  ok('driver sees only their van', r.ok && r.value[0].n === 1, `(${r.ok ? r.value[0].n : r.error})`);

  r = await as(c, driver, () => q(c, `select count(*)::int n from vans where id=$1`, [otherVan]));
  ok('driver cannot see another van', r.ok && r.value[0].n === 0, `(${r.ok ? r.value[0].n : r.error})`);

  r = await as(c, driver, () => q(c, `select count(*)::int n from products`));
  ok('driver sees only stock on their van', r.ok && r.value[0].n === twoProds.length,
     `(${r.ok ? r.value[0].n : r.error} of ${nAll})`);

  r = await as(c, driver, () => q(c, `select count(*)::int n from van_inventory`));
  ok('driver sees own van stock', r.ok && r.value[0].n === twoProds.length, `(${r.ok ? r.value[0].n : r.error})`);

  r = await as(c, driver, () => q(c, `insert into customers (org_id, code, name) values ($1,'CUS-NEW','Field Customer') returning id`, [org]));
  ok('driver can create a customer', r.ok, r.ok ? '' : `(${r.error})`);

  r = await as(c, driver, () => q(c, `insert into van_sales (org_id, load_id, van_id, driver_id, customer_id, sale_type)
    select $1,$2,$3,$4,id,'cash' from customers limit 1 returning id`, [org, load, van, driver]));
  ok('driver can create a sale on own van', r.ok, r.ok ? '' : `(${r.error})`);

  r = await as(c, driver, () => q(c, `insert into van_sales (org_id, load_id, van_id, driver_id, customer_id, sale_type)
    select $1,$2,$3,$4,id,'cash' from customers limit 1 returning id`, [org, load, otherVan, driver]));
  ok('driver cannot sell from another van', !r.ok, r.ok ? '(ALLOWED)' : '(blocked)');

  r = await as(c, driver, () => q(c, `insert into credit_transactions (org_id, customer_id, type, amount)
    select $1, id, 'payment', -50 from customers limit 1 returning id`, [org]));
  ok('driver can record a collection', r.ok, r.ok ? '' : `(${r.error})`);

  r = await as(c, driver, () => q(c, `insert into stock_movements (org_id, product_id, warehouse_id, type, quantity)
    values ($1,$2,$3,'receipt',100) returning id`, [org, twoProds[0].id, wh]));
  ok('driver cannot modify warehouse stock', !r.ok, r.ok ? '(ALLOWED)' : '(blocked)');

  r = await as(c, driver, () => q(c, `insert into products (org_id, sku, name) values ($1,'DRV-1','x') returning id`, [org]));
  ok('driver cannot create products', !r.ok, r.ok ? '(ALLOWED)' : '(blocked)');

  r = await as(c, driver, () => q(c, `update profiles set role='admin' where id=$1 returning role`, [driver]));
  ok('driver cannot manage users', !r.ok, r.ok ? '(PROMOTED)' : '(blocked)');

  r = await as(c, driver, () => q(c, `insert into van_assignments (org_id, van_id, driver_id) values ($1,$2,$3) returning id`, [org, otherVan, driver]));
  ok('driver cannot assign themselves a van', !r.ok, r.ok ? '(ASSIGNED)' : '(blocked)');

  r = await as(c, driver, () => q(c, `select count(*)::int n from van_reconciliations`));
  ok('driver can view own reconciliations', r.ok, r.ok ? `(${r.value[0].n})` : `(${r.error})`);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await c.end();
  process.exit(fail ? 1 : 0);
})();
