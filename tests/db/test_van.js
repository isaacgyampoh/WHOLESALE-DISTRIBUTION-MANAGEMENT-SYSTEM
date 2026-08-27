const { Client, CONN } = require('./lib');
let pass = 0, fail = 0;
const ok = (n, c, extra='') => { c ? (pass++, console.log(`  PASS  ${n} ${extra}`)) : (fail++, console.log(`  FAIL  ${n} ${extra}`)); };
const q = async (c, s, p) => (await c.query(s, p)).rows;
const one = async (c, s, p) => (await q(c, s, p))[0];
const tryQ = async (c, s, p) => { try { return { ok: true, rows: await q(c, s, p) }; } catch (e) { return { ok: false, error: e.message }; } };

(async () => {
  const c = new Client(CONN); await c.connect();
  const org = (await one(c, `select id from organizations where slug='default'`)).id;
  const wh  = (await one(c, `select id from warehouses where code='WH-ACC'`)).id;
  const cus = (await one(c, `select id, credit_limit from customers where code='CUS-002'`));
  const p1  = await one(c, `select id, cost_price, list_price from products where sku='SKU-1001'`);
  const p2  = await one(c, `select id, cost_price, list_price from products where sku='SKU-2001'`);

  const driver = (await one(c, `insert into auth.users (email, raw_user_meta_data)
    values ('driver@wdms.test', $1::jsonb) returning id`,
    [JSON.stringify({ full_name: 'Kojo Driver', role: 'driver', org_id: org })])).id;
  const seller = (await one(c, `insert into auth.users (email, raw_user_meta_data)
    values ('seller@wdms.test', $1::jsonb) returning id`,
    [JSON.stringify({ full_name: 'Ama Seller', role: 'sales_rep', org_id: org })])).id;
  const mgr = (await one(c, `insert into auth.users (email, raw_user_meta_data)
    values ('sm@wdms.test', $1::jsonb) returning id`,
    [JSON.stringify({ full_name: 'Senior Mgr', role: 'senior_manager', org_id: org })])).id;

  const van = (await one(c, `insert into vans (org_id, code, registration_no, home_warehouse_id)
    values ($1,'VAN-01','GT-1234-24',$2) returning id`, [org, wh])).id;
  await q(c, `insert into van_assignments (org_id, van_id, member_id, crew_role, assigned_by)
              values ($1,$2,$3,'driver',$4)`, [org, van, driver, mgr]);
  ok('van assigned to driver', true);

  // The salesperson who rides with this van. The driver keeps the goods,
  // this is the person who sells them.
  await q(c, `insert into van_assignments (org_id, van_id, member_id, crew_role, assigned_by)
              values ($1,$2,$3,'salesperson',$4)`, [org, van, seller, mgr]);
  ok('salesperson crewed on the same van', true);

  // Only one active driver per van.
  let r = await tryQ(c, `insert into van_assignments (org_id, van_id, member_id, crew_role) values ($1,$2,$3,'driver')`,
                     [org, van, mgr]);
  ok('van cannot have two active drivers', !r.ok, r.ok ? '(ALLOWED)' : '(blocked)');

  // ...and nobody is crewed on two vans at once, in either seat.
  const spareVan = (await one(c, `insert into vans (org_id, code, registration_no)
    values ($1,'VAN-02','GT-2222-24') returning id`, [org])).id;
  r = await tryQ(c, `insert into van_assignments (org_id, van_id, member_id, crew_role) values ($1,$2,$3,'salesperson')`,
                 [org, spareVan, seller]);
  ok('a salesperson cannot crew two vans', !r.ok, r.ok ? '(ALLOWED)' : '(blocked)');

  console.log('\n=== van loading ===');
  const whBefore = (await one(c, `select qty_on_hand h from inventory where product_id=$1 and warehouse_id=$2`, [p1.id, wh])).h;

  const load = (await one(c, `insert into van_loads (org_id, van_id, driver_id, warehouse_id, status, opening_float, loaded_by)
    values ($1,$2,$3,$4,'loaded',200,$5) returning id, load_number`, [org, van, driver, wh, mgr]));
  ok('load number generated', /^LOAD-\d{4}-\d{6}$/.test(load.load_number), `(${load.load_number})`);

  await q(c, `insert into van_load_items (org_id, load_id, product_id, qty_loaded, unit_price, unit_cost)
              values ($1,$2,$3,60,$4,$5), ($1,$2,$6,40,$7,$8)`,
          [org, load.id, p1.id, p1.list_price, p1.cost_price, p2.id, p2.list_price, p2.cost_price]);

  r = await tryQ(c, `select * from dispatch_van_load($1)`, [load.id]);
  ok('dispatch blocked without driver confirmation', !r.ok, r.ok ? '(DISPATCHED)' : `-> "${r.error.slice(0,48)}"`);

  await q(c, `update van_loads set driver_confirmed_at=now() where id=$1`, [load.id]);
  r = await tryQ(c, `select status from dispatch_van_load($1)`, [load.id]);
  ok('dispatch succeeds after confirmation', r.ok && r.rows[0].status === 'dispatched',
     r.ok ? `(${r.rows[0].status})` : `(${r.error})`);

  const whAfter = (await one(c, `select qty_on_hand h from inventory where product_id=$1 and warehouse_id=$2`, [p1.id, wh])).h;
  const vanQty = (await one(c, `select qty_on_hand h from van_inventory where van_id=$1 and product_id=$2`, [van, p1.id])).h;
  ok('warehouse stock reduced by 60', whBefore - whAfter === 60, `(${whBefore} -> ${whAfter})`);
  ok('van stock increased to 60', vanQty === 60, `(van=${vanQty})`);

  const legs = await q(c, `select type, quantity, (warehouse_id is not null) at_wh from stock_movements
                           where reference_id=$1 and product_id=$2 order by type`, [load.id, p1.id]);
  ok('transfer posted as two ledger legs', legs.length === 2
     && legs.some(l => l.type === 'transfer_out' && l.at_wh)
     && legs.some(l => l.type === 'transfer_in' && !l.at_wh),
     `(${legs.map(l => l.type + (l.at_wh ? '@wh' : '@van')).join(', ')})`);

  console.log('\n=== cash sale ===');
  const s1 = (await one(c, `insert into van_sales (org_id, load_id, van_id, salesperson_id, customer_id, sale_type)
    values ($1,$2,$3,$4,$5,'cash') returning id, sale_number`, [org, load.id, van, seller, cus.id])).id;
  await q(c, `insert into van_sale_items (org_id, sale_id, product_id, quantity, unit_price, tax_rate)
              values ($1,$2,$3,10,$4,15)`, [org, s1, p1.id, p1.list_price]);
  const t1 = await one(c, `select total from van_sales where id=$1`, [s1]);
  ok('sale total computed', Number(t1.total) > 0, `(total=${t1.total})`);

  r = await tryQ(c, `select status from complete_van_sale($1, $2)`, [s1, 1]);
  ok('cash sale rejects short payment', !r.ok, r.ok ? '(ACCEPTED)' : `-> "${r.error.slice(0,44)}"`);

  r = await tryQ(c, `select status, amount_paid from complete_van_sale($1, $2)`, [s1, t1.total]);
  ok('cash sale completes on full payment', r.ok && r.rows[0].status === 'completed',
     r.ok ? `(paid ${r.rows[0].amount_paid})` : `(${r.error})`);

  const vanQty2 = (await one(c, `select qty_on_hand h from van_inventory where van_id=$1 and product_id=$2`, [van, p1.id])).h;
  ok('van stock reduced by sale', vanQty2 === 50, `(van=${vanQty2})`);

  console.log('\n=== credit sale and credit limit ===');
  const s2 = (await one(c, `insert into van_sales (org_id, load_id, van_id, salesperson_id, customer_id, sale_type)
    values ($1,$2,$3,$4,$5,'credit') returning id`, [org, load.id, van, seller, cus.id])).id;
  await q(c, `insert into van_sale_items (org_id, sale_id, product_id, quantity, unit_price, tax_rate)
              values ($1,$2,$3,10,$4,15)`, [org, s2, p2.id, p2.list_price]);
  r = await tryQ(c, `select status, due_date from complete_van_sale($1)`, [s2]);
  ok('credit sale completes within limit', r.ok && r.rows[0].status === 'completed',
     r.ok ? `(due ${r.rows[0].due_date && r.rows[0].due_date.toISOString().slice(0,10)})` : `(${r.error})`);

  const ct = await one(c, `select type, amount from credit_transactions where reference_id=$1`, [s2]);
  ok('credit ledger charged', ct && ct.type === 'charge' && Number(ct.amount) > 0, `(${ct && ct.amount})`);

  // Blow through the credit limit.
  const s3 = (await one(c, `insert into van_sales (org_id, load_id, van_id, salesperson_id, customer_id, sale_type)
    values ($1,$2,$3,$4,$5,'credit') returning id`, [org, load.id, van, seller, cus.id])).id;
  await q(c, `insert into van_sale_items (org_id, sale_id, product_id, quantity, unit_price)
              values ($1,$2,$3,25,$4)`, [org, s3, p2.id, 2000]);
  r = await tryQ(c, `select * from complete_van_sale($1)`, [s3]);
  ok('credit sale beyond limit rejected', !r.ok, r.ok ? '(ALLOWED)' : `-> "${r.error.slice(0,44)}"`);

  // Overselling the van.
  const s4 = (await one(c, `insert into van_sales (org_id, load_id, van_id, salesperson_id, customer_id, sale_type)
    values ($1,$2,$3,$4,$5,'cash') returning id`, [org, load.id, van, seller, cus.id])).id;
  await q(c, `insert into van_sale_items (org_id, sale_id, product_id, quantity, unit_price)
              values ($1,$2,$3,9999,$4)`, [org, s4, p1.id, 10]);
  r = await tryQ(c, `select * from complete_van_sale($1, 99999999)`, [s4]);
  ok('cannot sell more than the van carries', !r.ok, r.ok ? '(ALLOWED)' : `-> "${r.error.slice(0,44)}"`);

  console.log('\n=== payment collection ===');
  const before = (await one(c, `select coalesce(sum(amount),0) s from credit_transactions where customer_id=$1`, [cus.id])).s;
  await q(c, `select * from record_credit_payment($1, 300, 'cash', 'Field collection')`, [cus.id]);
  const after = (await one(c, `select coalesce(sum(amount),0) s from credit_transactions where customer_id=$1`, [cus.id])).s;
  ok('collection reduces outstanding', Number(after) === Number(before) - 300, `(${before} -> ${after})`);

  console.log('\n=== van return with damage and shortage ===');
  const onVan1 = (await one(c, `select qty_on_hand h from van_inventory where van_id=$1 and product_id=$2`, [van, p1.id])).h;
  const ret = (await one(c, `insert into van_returns (org_id, load_id, van_id, driver_id, warehouse_id, status)
    values ($1,$2,$3,$4,$5,'submitted') returning id, return_number`, [org, load.id, van, driver, wh]));
  // 50 expected: 45 good, 3 damaged, 2 unaccounted for.
  await q(c, `insert into van_return_items (org_id, return_id, product_id, qty_expected, qty_returned_good, qty_damaged, damage_reason)
              values ($1,$2,$3,$4,45,3,'Crushed cartons')`, [org, ret.id, p1.id, onVan1]);
  const missing = (await one(c, `select qty_missing m from van_return_items where return_id=$1`, [ret.id])).m;
  ok('missing quantity derived', missing === onVan1 - 48, `(expected=${onVan1} missing=${missing})`);

  const whBeforeRet = (await one(c, `select qty_on_hand h from inventory where product_id=$1 and warehouse_id=$2`, [p1.id, wh])).h;
  await c.query('begin');
  await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: mgr, role: 'authenticated' })]);
  r = await tryQ(c, `select status from approve_van_return($1)`, [ret.id]);
  ok('return approved by manager', r.ok && r.rows[0].status === 'approved', r.ok ? '' : `(${r.error})`);
  await c.query('commit');

  // A driver must not be able to approve their own return.
  await c.query('begin');
  await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: driver, role: 'authenticated' })]);
  const selfAppr = await tryQ(c, `select * from approve_van_return($1)`, [ret.id]);
  ok('driver cannot approve a return', !selfAppr.ok, selfAppr.ok ? '(APPROVED)' : '(blocked)');
  await c.query('rollback');

  const whAfterRet = (await one(c, `select qty_on_hand h from inventory where product_id=$1 and warehouse_id=$2`, [p1.id, wh])).h;
  ok('good stock returned to warehouse', whAfterRet - whBeforeRet === 45, `(+${whAfterRet - whBeforeRet})`);

  const vanFinal = (await one(c, `select qty_on_hand h from van_inventory where van_id=$1 and product_id=$2`, [van, p1.id])).h;
  ok('van emptied of that product', vanFinal === 0, `(van=${vanFinal})`);

  const dmg = await one(c, `select coalesce(sum(quantity),0) n from stock_movements where reference_id=$1 and type='damage'`, [ret.id]);
  const sht = await one(c, `select coalesce(sum(quantity),0) n from stock_movements where reference_id=$1 and type='shortage'`, [ret.id]);
  ok('damage movement posted', Number(dmg.n) === 3, `(${dmg.n})`);
  ok('shortage movement posted', Number(sht.n) === onVan1 - 48, `(${sht.n})`);

  console.log('\n=== reconciliation ===');
  r = await tryQ(c, `select * from build_reconciliation($1)`, [load.id]);
  ok('reconciliation built', r.ok, r.ok ? '' : `(${r.error})`);
  const rec = r.rows[0];
  const expectedCash = 200 + Number(rec.cash_sales_total) + Number(rec.collections_total);
  ok('expected cash = float + cash sales + collections',
     Number(rec.expected_cash) === expectedCash,
     `(float 200 + cash ${rec.cash_sales_total} + collected ${rec.collections_total} = ${rec.expected_cash})`);
  ok('missing/damaged valued', Number(rec.damaged_value) > 0 && Number(rec.missing_value) > 0,
     `(damaged=${rec.damaged_value} missing=${rec.missing_value})`);

  // Driver hands in short.
  await q(c, `update van_reconciliations set actual_cash=$1, status='submitted', submitted_at=now() where id=$2`,
          [expectedCash - 50, rec.id]);
  const v = await one(c, `select cash_variance, stock_variance from van_reconciliations where id=$1`, [rec.id]);
  ok('cash variance computed', Number(v.cash_variance) === -50, `(${v.cash_variance})`);
  ok('stock variance computed', Number(v.stock_variance) < 0, `(${v.stock_variance})`);

  console.log('\n=== approval controls ===');
  // Self-approval, attempted directly at the table.
  r = await tryQ(c, `update van_reconciliations set status='approved', approved_by=$1, approved_at=now() where id=$2`,
                 [driver, rec.id]);
  ok('driver cannot approve own reconciliation (constraint)', !r.ok,
     r.ok ? '(APPROVED)' : `-> "${(r.error || '').slice(0,44)}"`);

  r = await tryQ(c, `update van_reconciliations set status='approved', approved_at=now() where id=$1`, [rec.id]);
  ok('approval without approver rejected', !r.ok, r.ok ? '(APPROVED)' : '(blocked)');

  r = await tryQ(c, `update van_reconciliations set status='rejected' where id=$1`, [rec.id]);
  ok('rejection without reason rejected', !r.ok, r.ok ? '(REJECTED)' : '(blocked)');

  await c.query('begin');
  await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: mgr, role: 'authenticated' })]);
  const ap = await tryQ(c, `select status, approved_by from approve_reconciliation($1,'Checked and settled')`, [rec.id]);
  ok('manager can approve', ap.ok && ap.rows[0].status === 'approved', ap.ok ? '' : `(${ap.error})`);
  const ld = await one(c, `select status from van_loads where id=$1`, [load.id]);
  ok('load marked reconciled', ld.status === 'reconciled', `(${ld.status})`);
  await c.query('rollback');

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await c.end();
  process.exit(fail ? 1 : 0);
})();
