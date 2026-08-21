const { Client, CONN } = require('./lib');
let pass = 0, fail = 0;
const ok = (n, c, extra='') => { c ? (pass++, console.log(`  PASS  ${n} ${extra}`)) : (fail++, console.log(`  FAIL  ${n} ${extra}`)); };
const q = async (c, s, p) => (await c.query(s, p)).rows;

(async () => {
  const c = new Client(CONN); await c.connect();

  // A real user, created the way Supabase Auth would.
  const defaultOrg = (await q(c, `select id from organizations where slug='default'`))[0].id;
  const u = (await q(c, `insert into auth.users (email, raw_user_meta_data)
    values ('rep@wdms.test', $1::jsonb) returning id`,
    [JSON.stringify({ full_name: 'Test Rep', role: 'sales_rep', org_id: defaultOrg })]))[0].id;
  const prof = (await q(c, `select role, full_name from profiles where id=$1`, [u]))[0];
  ok('signup trigger created profile', !!prof, `(role=${prof && prof.role})`);

  const wh  = (await q(c, `select id from warehouses where code='WH-ACC'`))[0].id;
  const cus = (await q(c, `select id from customers where code='CUS-001'`))[0].id;
  const pr  = (await q(c, `select id from products where sku='SKU-2001'`))[0].id;

  const lvl = async () => (await q(c,
    `select qty_on_hand h, qty_reserved r, qty_available a from inventory
     where product_id=$1 and warehouse_id=$2`, [pr, wh]))[0];

  const mk = async () => {
    const o = (await q(c, `insert into sales_orders (customer_id,warehouse_id,created_by)
                           values ($1,$2,$3) returning id, order_number, status`, [cus, wh, u]))[0];
    await q(c, `insert into sales_order_items (order_id,product_id,quantity,unit_price,tax_rate)
                values ($1,$2,30,89.00,15)`, [o.id, pr]);
    return o;
  };

  console.log('\n=== STEP 7: order status drives stock ===');
  const start = await lvl();
  console.log(`  baseline: on_hand=${start.h} reserved=${start.r}`);

  const o1 = await mk();
  ok('order number generated', /^SO-\d{4}-\d{6}$/.test(o1.order_number), `(${o1.order_number})`);

  const tot = (await q(c, `select subtotal, tax_total, total from sales_orders where id=$1`, [o1.id]))[0];
  ok('totals computed by trigger', Number(tot.subtotal) === 2670 && Number(tot.total) === 3070.5,
     `(subtotal=${tot.subtotal} tax=${tot.tax_total} total=${tot.total})`);

  let l = await lvl();
  ok('DRAFT -> no reservation', Number(l.r) === Number(start.r), `(reserved=${l.r})`);

  await q(c, `update sales_orders set status='confirmed' where id=$1`, [o1.id]);
  l = await lvl();
  ok('CONFIRMED -> reserved +30', Number(l.r) === Number(start.r) + 30, `(reserved=${l.r})`);
  ok('CONFIRMED -> on_hand unchanged', Number(l.h) === Number(start.h), `(on_hand=${l.h})`);
  ok('CONFIRMED -> available reduced', Number(l.a) === Number(start.a) - 30, `(available=${l.a})`);

  const before = (await q(c, `select count(*)::int n from stock_movements where reference_id=$1`, [o1.id]))[0].n;
  await q(c, `update sales_orders set status='shipped' where id=$1`, [o1.id]);
  l = await lvl();
  const after = (await q(c, `select count(*)::int n, coalesce(max(quantity),0) qty, max(type::text) t
                             from stock_movements where reference_id=$1`, [o1.id]))[0];
  ok('SHIPPED -> reservation released', Number(l.r) === Number(start.r), `(reserved=${l.r})`);
  ok('SHIPPED -> on_hand reduced by 30', Number(l.h) === Number(start.h) - 30, `(on_hand=${l.h})`);
  ok('SHIPPED -> issue movement posted', before === 0 && after.n === 1 && after.t === 'issue' && after.qty === 30,
     `(${after.n} movement, ${after.t} x${after.qty})`);
  const sd = (await q(c, `select shipped_date from sales_orders where id=$1`, [o1.id]))[0].shipped_date;
  ok('SHIPPED -> shipped_date stamped', !!sd);

  // Cancellation path
  const mid = await lvl();
  const o2 = await mk();
  await q(c, `update sales_orders set status='confirmed' where id=$1`, [o2.id]);
  l = await lvl();
  ok('second order reserves', Number(l.r) === Number(mid.r) + 30, `(reserved=${l.r})`);
  await q(c, `update sales_orders set status='cancelled' where id=$1`, [o2.id]);
  l = await lvl();
  ok('CANCELLED -> reservation released', Number(l.r) === Number(mid.r), `(reserved=${l.r})`);
  ok('CANCELLED -> no stock issued', Number(l.h) === Number(mid.h), `(on_hand=${l.h})`);

  // Confirming without a stock record must fail loudly
  const pr2 = (await q(c, `select id from products where sku='SKU-4001'`))[0].id;
  const whk = (await q(c, `select id from warehouses where code='WH-KUM'`))[0].id;
  const o3 = (await q(c, `insert into sales_orders (customer_id,warehouse_id,created_by)
                          values ($1,$2,$3) returning id`, [cus, whk, u]))[0].id;
  await q(c, `insert into sales_order_items (order_id,product_id,quantity,unit_price)
              values ($1,$2,5,130)`, [o3, pr2]);
  let raised = false, m = '';
  try { await q(c, `update sales_orders set status='confirmed' where id=$1`, [o3]); }
  catch (e) { raised = true; m = e.message; }
  ok('confirm without stock record raises', raised, `-> "${m.slice(0, 60)}"`);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await c.end();
  process.exit(fail ? 1 : 0);
})();
