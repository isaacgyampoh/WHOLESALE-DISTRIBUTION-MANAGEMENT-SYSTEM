const { Client, CONN } = require('./lib');
let pass = 0, fail = 0;
const ok = (n, c, extra='') => { c ? (pass++, console.log(`  PASS  ${n} ${extra}`)) : (fail++, console.log(`  FAIL  ${n} ${extra}`)); };
const q = async (c, s, p) => (await c.query(s, p)).rows;

(async () => {
  const c = new Client(CONN); await c.connect();
  const wh = (await q(c, `select id from warehouses where code='WH-KUM'`))[0].id;
  const pr = (await q(c, `select id, sku from products where sku='SKU-1001'`))[0];
  const level = async () => (await q(c,
    `select coalesce(qty_on_hand,0) h, coalesce(qty_reserved,0) r from inventory
     where product_id=$1 and warehouse_id=$2`, [pr.id, wh]))[0] || { h: 0, r: 0 };

  console.log('\n=== STEP 6: stock is derived, never set ===');
  const base = await level();
  ok('baseline empty in WH-KUM', base.h === 0, `(on_hand=${base.h})`);

  await q(c, `insert into stock_movements (product_id,warehouse_id,type,quantity,reason)
              values ($1,$2,'receipt',100,'test inbound')`, [pr.id, wh]);
  let l = await level();
  ok('receipt +100 -> inventory 100', l.h === 100, `(on_hand=${l.h})`);

  await q(c, `insert into stock_movements (product_id,warehouse_id,type,quantity,reason)
              values ($1,$2,'issue',20,'test outbound')`, [pr.id, wh]);
  l = await level();
  ok('issue -20 -> inventory 80', l.h === 80, `(on_hand=${l.h})`);

  const movs = await q(c, `select type,quantity from stock_movements
                           where product_id=$1 and warehouse_id=$2 order by created_at`, [pr.id, wh]);
  ok('ledger retains both movements', movs.length === 2,
     `(${movs.map(m => m.type + ':' + m.quantity).join(', ')})`);

  // Immutability
  let blocked = false, msg = '';
  try { await q(c, `update stock_movements set quantity=999 where product_id=$1 and warehouse_id=$2`, [pr.id, wh]); }
  catch (e) { blocked = true; msg = e.message; }
  ok('UPDATE on stock_movements rejected', blocked, `-> "${msg}"`);

  // Since migration 0035 a trusted role may DELETE, so that a tenant can
  // be removed at all - the cleanup used to be refused here and left the
  // database half-emptied. What must not have changed is anything a
  // signed-in user can do, or anyone's ability to rewrite an entry.
  const grants = (await q(c,
    `select privilege_type from information_schema.role_table_grants
      where table_name='stock_movements' and grantee='authenticated'`)).map((x) => x.privilege_type);
  ok('authenticated cannot delete or rewrite the ledger',
     !grants.includes('DELETE') && !grants.includes('UPDATE'),
     `(granted: ${grants.join(', ') || 'nothing'})`);

  // The guard is a row trigger, so an UPDATE has to match a row to prove
  // anything: one that hits nothing succeeds without firing it.
  blocked = false; msg = '';
  try { await q(c, `update stock_movements set quantity=1 where product_id=$1 and warehouse_id=$2`, [pr.id, wh]); }
  catch (e) { blocked = true; msg = e.message; }
  ok('not even a trusted role can rewrite a movement', blocked, `-> "${msg}"`);

  l = await level();
  ok('inventory unchanged after blocked writes', l.h === 80, `(on_hand=${l.h})`);

  // Correction via reversing movement
  await q(c, `insert into stock_movements (product_id,warehouse_id,type,quantity,reason)
              values ($1,$2,'adjustment_in',20,'reverse the test issue')`, [pr.id, wh]);
  l = await level();
  const n = (await q(c, `select count(*)::int n from stock_movements where product_id=$1 and warehouse_id=$2`, [pr.id, wh]))[0].n;
  ok('reversing movement restores 100', l.h === 100, `(on_hand=${l.h})`);
  ok('history preserved (3 rows, nothing rewritten)', n === 3, `(rows=${n})`);

  // And the purge path exists, which is the reason DELETE was opened at
  // all. Added and removed again, so the ledger is left as it was.
  const probe = (await q(c, `insert into stock_movements (product_id, warehouse_id, type, quantity, reason)
              values ($1,$2,'receipt',5,'purge probe') returning id`, [pr.id, wh]))[0].id;
  let purged = true;
  try { await q(c, `delete from stock_movements where id=$1`, [probe]); }
  catch { purged = false; }
  ok("a trusted role can clear a tenant's movements", purged,
     '(otherwise an organization can never be removed)');

  const after = (await q(c, `select count(*)::int n from stock_movements where product_id=$1 and warehouse_id=$2`, [pr.id, wh]))[0].n;
  ok('and the ledger is left exactly as it was', after === 3, `(rows=${after})`);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await c.end();
  process.exit(fail ? 1 : 0);
})();
