const { Client, CONN } = require('./lib');
let pass = 0, fail = 0;
const ok = (n, c, extra='') => { c ? (pass++, console.log(`  PASS  ${n} ${extra}`)) : (fail++, console.log(`  FAIL  ${n} ${extra}`)); };
const q = async (c, s, p) => (await c.query(s, p)).rows;

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

  const orgA = (await q(c, `select id from organizations where slug='default'`))[0].id;
  const orgB = (await q(c, `insert into organizations (name,slug) values ('Rival Distributors','rival') returning id`))[0].id;

  // Org B gets its own admin and its own data.
  const admB = (await q(c, `insert into auth.users (email, raw_user_meta_data) values
    ('admin@rival.test', $1::jsonb) returning id`,
    [JSON.stringify({ full_name: 'Rival Admin', role: 'admin', org_id: orgB })]))[0].id;
  const profB = (await q(c, `select org_id from profiles where id=$1`, [admB]))[0];
  ok('signup honours org_id from metadata', profB.org_id === orgB);

  const admA = (await q(c, `insert into auth.users (email, raw_user_meta_data) values
    ('admin@default.test', $1::jsonb) returning id`,
    [JSON.stringify({ full_name: 'Default Admin', role: 'admin', org_id: orgA })]))[0].id;

  await q(c, `insert into warehouses (org_id, code, name) values ($1,'WH-R1','Rival Depot')`, [orgB]);
  await q(c, `insert into customers (org_id, code, name) values ($1,'CUS-R1','Rival Customer')`, [orgB]);
  await q(c, `insert into products (org_id, sku, name, cost_price, list_price) values ($1,'SKU-R1','Rival Widget',10,20)`, [orgB]);

  console.log('\n=== tenant isolation (org A admin looking at org B) ===');
  for (const t of ['products','customers','warehouses','suppliers','inventory','stock_movements','sales_orders','invoices','payments']) {
    const r = await as(c, admA, () => q(c, `select count(*)::int n from ${t} where org_id=$1`, [orgB]));
    ok(`cannot see org B ${t}`, r.ok && r.value[0].n === 0, `(${r.ok ? r.value[0].n + ' rows' : r.error})`);
  }

  console.log('\n=== reverse direction (org B admin looking at org A) ===');
  for (const t of ['products','customers','warehouses']) {
    const r = await as(c, admB, () => q(c, `select count(*)::int n from ${t} where org_id=$1`, [orgA]));
    ok(`cannot see org A ${t}`, r.ok && r.value[0].n === 0, `(${r.ok ? r.value[0].n + ' rows' : r.error})`);
  }
  const own = await as(c, admB, () => q(c, `select count(*)::int n from products`));
  ok('org B sees only its own product', own.ok && own.value[0].n === 1, `(${own.ok ? own.value[0].n : own.error})`);

  console.log('\n=== write attacks ===');
  let r = await as(c, admA, () => q(c, `update products set name='pwned' where org_id=$1 returning id`, [orgB]));
  ok('cannot update another org rows', !r.ok || r.value.length === 0, r.ok ? `(${r.value.length} rows)` : '(blocked)');

  r = await as(c, admA, () => q(c, `delete from customers where org_id=$1 returning id`, [orgB]));
  ok('cannot delete another org rows', !r.ok || r.value.length === 0, r.ok ? `(${r.value.length} rows)` : '(blocked)');

  r = await as(c, admA, () => q(c, `insert into products (org_id, sku, name) values ($1,'SMUGGLE','x') returning id`, [orgB]));
  ok('cannot insert into another org', !r.ok, r.ok ? '(INSERT SUCCEEDED)' : '(blocked)');

  r = await as(c, admA, () => q(c, `update profiles set org_id=$1 where id=$2 returning id`, [orgB, admA]));
  ok('cannot move self to another org', !r.ok, r.ok ? '(MOVED)' : '(blocked)');

  console.log('\n=== cross-tenant reference guard ===');
  const cusA = (await q(c, `select id from customers where org_id=$1 limit 1`, [orgA]))[0].id;
  const whB  = (await q(c, `select id from warehouses where org_id=$1 limit 1`, [orgB]))[0].id;
  let raised = false, msg = '';
  try {
    await q(c, `insert into sales_orders (org_id, customer_id, warehouse_id, created_by)
                values ($1,$2,$3,$4)`, [orgA, cusA, whB, admA]);
  } catch (e) { raised = true; msg = e.message; }
  ok('order cannot reference another org warehouse', raised, `-> "${msg.slice(0, 58)}"`);

  const prB = (await q(c, `select id from products where org_id=$1 limit 1`, [orgB]))[0].id;
  raised = false; msg = '';
  try {
    await q(c, `insert into products (org_id, sku, name, category_id) values ($1,'X1','x',
      (select id from categories where org_id=$2 limit 1))`, [orgB, orgA]);
  } catch (e) { raised = true; msg = e.message; }
  ok('product cannot use another org category', raised, `-> "${msg.slice(0, 58)}"`);

  console.log('\n=== per-org uniqueness ===');
  raised = false;
  try { await q(c, `insert into products (org_id, sku, name) values ($1,'SKU-1001','Same SKU other tenant')`, [orgB]); }
  catch (e) { raised = true; msg = e.message; }
  ok('same SKU allowed in a different org', !raised, raised ? `(${msg.slice(0,50)})` : '(allowed)');

  raised = false;
  try { await q(c, `insert into products (org_id, sku, name) values ($1,'SKU-1001','Dup in same org')`, [orgA]); }
  catch (e) { raised = true; }
  ok('duplicate SKU still rejected within an org', raised);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await c.end();
  process.exit(fail ? 1 : 0);
})();
