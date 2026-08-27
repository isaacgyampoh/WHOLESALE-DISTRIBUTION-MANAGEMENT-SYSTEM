// The upgrade path for a database that is already live.
//
// A running installation cannot be re-run through the installer, so the
// migrations that change an installed schema also ship as upgrade scripts
// under database/. This proves those scripts take a database installed at
// 0019 to exactly the schema the migrations produce - the same check
// test_installer.mjs makes for a fresh install, from the other direction.
//
// It builds its own database, so it runs after the suites that share one.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { Client, CONN, runFile } = require('./lib');

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const MIG = path.join(ROOT, 'supabase', 'migrations');
const DB = 'wdms_upgrade';

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => {
  c ? (pass++, console.log(`  PASS  ${n} ${extra}`)) : (fail++, console.log(`  FAIL  ${n} ${extra}`));
};

/** Everything the installer test compares, asked of one database. */
const SHAPE = `select
 (select count(*) from information_schema.tables
   where table_schema='public' and table_type='BASE TABLE')                as tables,
 (select count(*) from information_schema.views where table_schema='public') as views,
 (select count(distinct t.typname) from pg_type t
   join pg_enum e on e.enumtypid=t.oid
   join pg_namespace n on n.oid=t.typnamespace where n.nspname='public')   as enums,
 (select count(distinct p.proname) from pg_proc p
   join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
   and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')) as functions,
 (select count(*) from pg_policy p join pg_class c on c.oid=p.polrelid
   join pg_namespace n on n.oid=c.relnamespace where n.nspname='public')   as policies,
 (select count(*) from pg_trigger tg join pg_class c on c.oid=tg.tgrelid
   join pg_namespace n on n.oid=c.relnamespace
   where not tg.tgisinternal and n.nspname in ('public','auth'))           as triggers,
 (select count(*) from pg_indexes where schemaname='public')               as indexes,
 (select count(*) from pg_constraint con join pg_class c on c.oid=con.conrelid
   join pg_namespace n on n.oid=c.relnamespace where n.nspname='public')   as constraints`;

const ENUM = `select string_agg(e.enumlabel, ',' order by e.enumsortorder) as members
  from pg_type t join pg_enum e on e.enumtypid=t.oid
  join pg_namespace n on n.oid=t.typnamespace
  where n.nspname='public' and t.typname='movement_type'`;

const admin = new Client({ ...CONN, database: 'postgres' });
await admin.connect();
await admin.query(`drop database if exists ${DB}`);
await admin.query(`create database ${DB}`);
await admin.end();

const c = new Client({ ...CONN, database: DB });
await c.connect();

console.log('\n=== a database installed before the crew change ===');
await runFile(c, path.join(here, 'shim.sql'), 'shim.sql');
const before = fs.readdirSync(MIG).filter((f) => f.endsWith('.sql') && f < '0020').sort();
for (const f of before) await runFile(c, path.join(MIG, f), f);
ok(`installed through 0019 (${before.length} migrations)`, before.length > 0);

// The state the upgrade has to cope with: a driver assignment and a sale
// recorded under the old column names, which the rename has to carry.
const { rows: [org] } = await c.query(`select id from organizations where slug='default'`);
const { rows: [wh] } = await c.query(`select id from warehouses limit 1`);
const { rows: [prod] } = await c.query(`select id, list_price from products limit 1`);
const { rows: [cust] } = await c.query(`select id from customers limit 1`);
const { rows: [driver] } = await c.query(
  `insert into auth.users (email, raw_user_meta_data) values ('legacy-drv@wdms.test', $1::jsonb) returning id`,
  [JSON.stringify({ full_name: 'Legacy Driver', role: 'driver', org_id: org.id })]);
const { rows: [van] } = await c.query(
  `insert into vans (org_id, code, registration_no, home_warehouse_id) values ($1,'VAN-OLD','GT-OLD-24',$2) returning id`,
  [org.id, wh.id]);
await c.query(`insert into van_assignments (org_id, van_id, driver_id) values ($1,$2,$3)`,
  [org.id, van.id, driver.id]);
const { rows: [load] } = await c.query(
  `insert into van_loads (org_id, van_id, driver_id, warehouse_id, status) values ($1,$2,$3,$4,'dispatched') returning id`,
  [org.id, van.id, driver.id, wh.id]);
const { rows: [sale] } = await c.query(
  `insert into van_sales (org_id, load_id, van_id, driver_id, customer_id, sale_type, status)
   values ($1,$2,$3,$4,$5,'cash','completed') returning id, sale_number`,
  [org.id, load.id, van.id, driver.id, cust.id]);
ok('a sale exists under the old column names', Boolean(sale.id), `(${sale.sale_number})`);

console.log('\n=== applying the upgrade scripts ===');
for (const f of ['UPGRADE_0020_MOVEMENT_TYPES.sql', 'UPGRADE_0021_CREW_AND_SELLING.sql']) {
  try {
    await runFile(c, path.join(ROOT, 'database', f), f);
    ok(`${f} applied`, true);
  } catch (e) {
    ok(`${f} applied`, false, `(${e.message.slice(0, 60)})`);
  }
}

console.log('\n=== existing data survived the rename ===');
const { rows: [carried] } = await c.query(
  `select member_id, crew_role from van_assignments where van_id=$1 and unassigned_at is null`, [van.id]);
ok('the driver assignment became a driver crew row',
   carried?.member_id === driver.id && carried?.crew_role === 'driver',
   `(${carried?.crew_role})`);

const { rows: [kept] } = await c.query(
  `select salesperson_id, van_id, warehouse_id from van_sales where id=$1`, [sale.id]);
ok('the old sale kept its seller and its van',
   kept?.salesperson_id === driver.id && kept?.van_id === van.id && kept?.warehouse_id === null);

// The new location constraint has to be satisfied by rows that predate it.
const { rows: [violations] } = await c.query(
  `select count(*)::int n from van_sales
   where not ((van_id is not null and warehouse_id is null)
           or (van_id is null and warehouse_id is not null))`);
ok('no existing sale violates the new location rule', violations.n === 0, `(${violations.n})`);

console.log('\n=== the upgraded schema matches a fresh install ===');
const upgraded = (await c.query(SHAPE)).rows[0];
const upgradedEnum = (await c.query(ENUM)).rows[0].members;
await c.end();

const fresh = new Client(CONN);
await fresh.connect();
const current = (await fresh.query(SHAPE)).rows[0];
const currentEnum = (await fresh.query(ENUM)).rows[0].members;
await fresh.end();

for (const key of Object.keys(current)) {
  ok(`${key} match`, String(current[key]) === String(upgraded[key]),
     `upgraded=${upgraded[key]} fresh=${current[key]}`);
}
ok('movement_type members and order identical', upgradedEnum === currentEnum,
   upgradedEnum === currentEnum ? '' : `\n    upgraded: ${upgradedEnum}\n    fresh:    ${currentEnum}`);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
