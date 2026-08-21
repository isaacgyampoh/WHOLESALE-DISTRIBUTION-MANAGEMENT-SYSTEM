const { Client, CONN } = require('./lib');
let pass = 0, fail = 0;
const ok = (n, c, extra='') => { c ? (pass++, console.log(`  PASS  ${n} ${extra}`)) : (fail++, console.log(`  FAIL  ${n} ${extra}`)); };
const q = async (c, s, p) => (await c.query(s, p)).rows;

// Run one statement exactly as PostgREST would for a signed-in user.
async function as(c, uid, fn) {
  await c.query('begin');
  await c.query(`select set_config('request.jwt.claims', $1, true)`,
                [JSON.stringify({ sub: uid, role: 'authenticated' })]);
  await c.query('set local role authenticated');
  try { return { ok: true, value: await fn() }; }
  catch (e) { return { ok: false, error: e.message }; }
  finally { await c.query('rollback'); }
}

(async () => {
  const c = new Client(CONN); await c.connect();

  // Every user here stands for an administrator-issued invitation, which
  // is what carries org_id. Without it, migration 0017 creates the
  // account inactive and it can reach nothing - by design.
  const org = (await q(c, `select id from organizations where slug='default'`))[0].id;

  const users = {};
  for (const [role, email] of [['admin','admin@wdms.test'],['manager','mgr@wdms.test'],
       ['sales_rep','rep2@wdms.test'],['warehouse','wh@wdms.test'],['accountant','acct@wdms.test']]) {
    users[role] = (await q(c, `insert into auth.users (email, raw_user_meta_data)
      values ($1, $2::jsonb) returning id`,
      [email, JSON.stringify({ full_name: role, role, org_id: org })]))[0].id;
  }
  console.log('  created 5 users, one per role');

  const wh  = (await q(c, `select id from warehouses where code='WH-ACC'`))[0].id;
  const cus = (await q(c, `select id from customers where code='CUS-002'`))[0].id;
  const pr  = (await q(c, `select id from products where sku='SKU-3001'`))[0].id;

  // Two reps, one order each, to prove per-owner isolation.
  const repA = users.sales_rep;
  const repB = (await q(c, `insert into auth.users (email, raw_user_meta_data)
    values ('rep3@wdms.test', $1::jsonb) returning id`,
    [JSON.stringify({ full_name: 'Rep B', role: 'sales_rep', org_id: org })]))[0].id;
  const oA = (await q(c, `insert into sales_orders (customer_id,warehouse_id,created_by)
                          values ($1,$2,$3) returning id`, [cus, wh, repA]))[0].id;
  const oB = (await q(c, `insert into sales_orders (customer_id,warehouse_id,created_by)
                          values ($1,$2,$3) returning id`, [cus, wh, repB]))[0].id;

  console.log('\n=== sales_rep ===');
  let r = await as(c, repA, () => q(c, `select id from sales_orders`));
  ok('sees only own orders', r.ok && r.value.length === 1 && r.value[0].id === oA,
     `(${r.ok ? r.value.length + ' visible' : r.error})`);

  r = await as(c, repA, () => q(c, `select count(*)::int n from products`));
  ok('can read catalogue', r.ok && r.value[0].n > 0, `(${r.ok ? r.value[0].n + ' products' : r.error})`);

  r = await as(c, repA, () => q(c, `insert into products (sku,name) values ('HACK-1','x')`));
  ok('cannot create products', !r.ok, r.ok ? '(INSERT SUCCEEDED)' : '(blocked)');

  r = await as(c, repA, () => q(c, `insert into stock_movements (product_id,warehouse_id,type,quantity)
                                    values ($1,$2,'receipt',50)`, [pr, wh]));
  ok('cannot post stock movements', !r.ok, r.ok ? '(INSERT SUCCEEDED)' : '(blocked)');

  r = await as(c, repA, () => q(c, `update sales_orders set status='confirmed' where id=$1 returning id`, [oB]));
  ok("cannot modify another rep's order", !r.ok || r.value.length === 0,
     r.ok ? `(${r.value.length} rows)` : '(blocked)');

  r = await as(c, repA, () => q(c, `select count(*)::int n from payments`));
  ok('cannot read payments', r.ok && r.value[0].n === 0, `(${r.ok ? r.value[0].n + ' rows' : r.error})`);

  console.log('\n=== privilege escalation ===');
  r = await as(c, repA, () => q(c, `update profiles set role='admin' where id=$1 returning role`, [repA]));
  ok('rep cannot promote self to admin', !r.ok, r.ok ? `(BECAME ${r.value[0] && r.value[0].role})` : '(blocked)');

  r = await as(c, repA, () => q(c, `update profiles set is_active=false where id=$1 returning id`, [users.admin]));
  ok('rep cannot deactivate admin', !r.ok || r.value.length === 0,
     r.ok ? `(${r.value.length} rows)` : '(blocked)');

  console.log('\n=== warehouse ===');
  r = await as(c, users.warehouse, () => q(c, `insert into stock_movements (product_id,warehouse_id,type,quantity)
                                               values ($1,$2,'receipt',50) returning id`, [pr, wh]));
  ok('can post stock movements', r.ok, r.ok ? '(allowed)' : `(${r.error})`);

  r = await as(c, users.warehouse, () => q(c, `insert into products (sku,name) values ('HACK-2','x')`));
  ok('cannot create products', !r.ok, r.ok ? '(INSERT SUCCEEDED)' : '(blocked)');

  r = await as(c, users.warehouse, () => q(c, `select count(*)::int n from sales_orders`));
  ok('sees all orders for fulfilment', r.ok && r.value[0].n >= 2, `(${r.ok ? r.value[0].n : r.error})`);

  console.log('\n=== accountant ===');
  r = await as(c, users.accountant, () => q(c, `insert into invoices (customer_id,total) values ($1,100) returning id`, [cus]));
  ok('can create invoices', r.ok, r.ok ? '(allowed)' : `(${r.error})`);

  r = await as(c, users.accountant, () => q(c, `insert into stock_movements (product_id,warehouse_id,type,quantity)
                                                values ($1,$2,'receipt',5)`, [pr, wh]));
  ok('cannot post stock movements', !r.ok, r.ok ? '(INSERT SUCCEEDED)' : '(blocked)');

  console.log('\n=== admin ===');
  r = await as(c, users.admin, () => q(c, `select count(*)::int n from sales_orders`));
  ok('sees all orders', r.ok && r.value[0].n >= 2, `(${r.ok ? r.value[0].n : r.error})`);

  r = await as(c, users.admin, () => q(c, `update profiles set role='manager' where id=$1 returning role`, [repA]));
  ok('can change another user role', r.ok && r.value.length === 1, r.ok ? `(-> ${r.value[0].role})` : `(${r.error})`);

  r = await as(c, users.admin, () => q(c, `insert into products (sku,name) values ('ADM-1','ok') returning id`));
  ok('can create products', r.ok, r.ok ? '(allowed)' : `(${r.error})`);

  console.log('\n=== inactive user ===');
  await q(c, `update profiles set is_active=false where id=$1`, [users.manager]);
  r = await as(c, users.manager, () => q(c, `select count(*)::int n from products`));
  ok('deactivated user loses access', r.ok && r.value[0].n === 0, `(${r.ok ? r.value[0].n + ' rows' : r.error})`);
  await q(c, `update profiles set is_active=true where id=$1`, [users.manager]);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await c.end();
  process.exit(fail ? 1 : 0);
})();
