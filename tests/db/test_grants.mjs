import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Client } = require('pg');
const fs = require('fs');
const { splitStatements } = require('./lib.js');

// Rebuild a database the way hosted Supabase now behaves: no
// auto-exposure of new entities to the Data API roles.
const CONN = { host:'127.0.0.1', port:55432, user:'postgres' };
const admin = new Client({ ...CONN, database:'postgres' }); await admin.connect();
await admin.query('drop database if exists hosted_sim');
await admin.query('create database hosted_sim'); await admin.end();

const c = new Client({ ...CONN, database:'hosted_sim' }); await c.connect();
let shim = fs.readFileSync('shim.sql','utf8').replace(/alter default privileges in schema public[\s\S]*?;/g, '');
for (const s of splitStatements(shim)) await c.query(s);

// WDMS_FROM_INSTALLER proves the consolidated installer carries the same
// grants and anonymous-access protections as the migration path.
if (process.env.WDMS_FROM_INSTALLER) {
  const file = '../../database/WHOLESALE_DISTRIBUTION_DATABASE.sql';
  await c.query(fs.readFileSync(file, 'utf8'));
  console.log('consolidated installer applied to a no-auto-grant database\n');
} else {
  const dir = '../../supabase/migrations';
  for (const f of fs.readdirSync(dir).filter(f=>f.endsWith('.sql')).sort())
    for (const s of splitStatements(fs.readFileSync(`${dir}/${f}`,'utf8'))) await c.query(s);
  console.log('migrations 0001-0015 applied to a no-auto-grant database\n');
}

let pass=0, fail=0;
const ok=(n,c,x='')=>{c?(pass++,console.log(`  PASS  ${n} ${x}`)):(fail++,console.log(`  FAIL  ${n} ${x}`));};

async function as(role, claims, sql, params) {
  await c.query('begin');
  await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify(claims)]);
  await c.query(`set local role ${role}`);
  try { const r = await c.query(sql, params); return { ok:true, rows:r.rows }; }
  catch (e) { return { ok:false, error:e.message }; }
  finally { await c.query('rollback'); }
}

const uid = (await c.query(`insert into auth.users (email, raw_user_meta_data)
  values ('grants@test', '{"role":"admin"}'::jsonb) returning id`)).rows[0].id;
const authed = { sub: uid, role:'authenticated' };
const anon = { role:'anon' };

console.log('=== authenticated now reaches the Data API ===');
let r = await as('authenticated', authed, 'select count(*)::int n from products');
ok('SELECT products', r.ok, r.ok ? `(${r.rows[0].n} rows)` : `-> ${r.error}`);
r = await as('authenticated', authed, 'select count(*)::int n from stock_summary');
ok('SELECT view stock_summary', r.ok, r.ok ? '' : `-> ${r.error}`);
r = await as('authenticated', authed, `insert into customers (code,name) values ('GRANT-1','x') returning id`);
ok('INSERT customers (sequence + RLS ok)', r.ok, r.ok ? '' : `-> ${r.error}`);

console.log('\n=== append-only ledger: privilege withheld, not just triggered ===');
r = await as('authenticated', authed, `update stock_movements set quantity=1`);
ok('UPDATE stock_movements denied', !r.ok, r.ok ? '(ALLOWED)' : `-> ${r.error.slice(0,44)}`);
r = await as('authenticated', authed, `delete from stock_movements`);
ok('DELETE stock_movements denied', !r.ok, r.ok ? '(ALLOWED)' : `-> ${r.error.slice(0,44)}`);

console.log('\n=== anonymous is locked out entirely ===');
for (const [label, sql] of [
  ['SELECT products', 'select count(*) from products'],
  ['SELECT customers', 'select count(*) from customers'],
]) {
  const rr = await as('anon', anon, sql);
  ok(`anon ${label} denied`, !rr.ok, rr.ok ? '(READABLE)' : `-> ${rr.error.slice(0,40)}`);
}

console.log('\n=== the vulnerability: anon calling privileged functions ===');
for (const [name, sql] of [
  ['dispatch_van_load',      `select public.dispatch_van_load('00000000-0000-0000-0000-000000000000')`],
  ['approve_reconciliation', `select public.approve_reconciliation('00000000-0000-0000-0000-000000000000')`],
  ['approve_van_return',     `select public.approve_van_return('00000000-0000-0000-0000-000000000000')`],
  ['record_credit_payment',  `select public.record_credit_payment('00000000-0000-0000-0000-000000000000',100)`],
  ['complete_van_sale',      `select public.complete_van_sale('00000000-0000-0000-0000-000000000000')`],
]) {
  const rr = await as('anon', anon, sql);
  const denied = !rr.ok && /permission denied for function|Authentication required|Permission denied/i.test(rr.error);
  ok(`anon ${name} blocked`, denied, denied ? `-> ${rr.error.slice(0,42)}` : `-> ${(rr.error||'REACHED LOGIC').slice(0,50)}`);
}

console.log('\n=== authenticated non-manager still refused ===');
const drvId = (await c.query(`insert into auth.users (email, raw_user_meta_data)
  values ('drv-grants@test', '{"role":"driver"}'::jsonb) returning id`)).rows[0].id;
r = await as('authenticated', { sub: drvId, role:'authenticated' },
  `select public.approve_reconciliation('00000000-0000-0000-0000-000000000000')`);
// Must be refused on privilege, not on existence: a "not found" reply
// would tell an unauthorized caller which ids are real.
ok('driver approve_reconciliation refused on privilege',
   !r.ok && /Permission denied/i.test(r.error), `-> ${(r.error||'').slice(0,44)}`);
r = await as('authenticated', { sub: drvId, role:'authenticated' },
  `select public.approve_van_return('00000000-0000-0000-0000-000000000000')`);
ok('driver approve_van_return refused on privilege',
   !r.ok && /Permission denied/i.test(r.error), `-> ${(r.error||'').slice(0,44)}`);


// Defense in depth: if EXECUTE were ever granted to anon by mistake (or
// by a future migration's default privileges), the guard inside the
// function must still refuse. Grants are one layer, not the only one.
console.log('\n=== guard holds even when EXECUTE is granted to anon ===');
await c.query(`grant execute on function public.dispatch_van_load(uuid) to anon`);
await c.query(`grant execute on function public.approve_reconciliation(uuid, text) to anon`);
await c.query(`grant execute on function public.require_role(public.user_role[]) to anon`);
await c.query(`grant execute on function public.is_trusted_context() to anon`);

for (const [name, sql] of [
  ['dispatch_van_load',      `select public.dispatch_van_load('00000000-0000-0000-0000-000000000000')`],
  ['approve_reconciliation', `select public.approve_reconciliation('00000000-0000-0000-0000-000000000000')`],
]) {
  const rr = await as('anon', { role:'anon' }, sql);
  const denied = !rr.ok && /Authentication required|Permission denied/i.test(rr.error);
  ok(`anon ${name} still refused by guard`, denied, `-> ${(rr.error||'REACHED LOGIC').slice(0,46)}`);
}

// A keyless request with no JWT claims at all, over a connection that is
// genuinely 'authenticator' - exactly how PostgREST reaches the database.
const pr = new Client({ ...CONN, user:'authenticator', database:'hosted_sim' });
await pr.connect();
await pr.query('begin');
await pr.query(`set local role anon`);
let keyless;
try { await pr.query(`select public.dispatch_van_load('00000000-0000-0000-0000-000000000000')`); keyless = 'REACHED LOGIC'; }
catch (e) { keyless = e.message; }
await pr.query('rollback');
ok('keyless anon over authenticator refused', /Authentication required|Permission denied/i.test(keyless),
   `-> ${keyless.slice(0,46)}`);

// Prove the helper reports untrusted for a real Data API caller. Run it
// as 'authenticated' (anon and authenticator hold no EXECUTE, which is
// the migration behaving correctly).
await pr.query('begin');
await pr.query(`set local role authenticated`);
await pr.query(`select set_config('request.jwt.claims', $1, true)`,
  [JSON.stringify({ sub: uid, role: 'authenticated' })]);
const su = (await pr.query('select session_user as su, public.is_trusted_context() as t')).rows[0];
await pr.query('rollback');
ok('is_trusted_context false for a Data API caller', su.t === false,
   `(session_user=${su.su}, trusted=${su.t})`);

// ...and true for the service role, which servers legitimately use.
await pr.query('begin');
await pr.query(`set local role service_role`);
await pr.query(`select set_config('request.jwt.claims', $1, true)`,
  [JSON.stringify({ role: 'service_role' })]);
const sr = (await pr.query('select public.is_trusted_context() as t')).rows[0];
await pr.query('rollback');
ok('is_trusted_context true for service_role', sr.t === true, `(trusted=${sr.t})`);
await pr.end();

console.log(`\n  FINAL: ${pass} passed, ${fail} failed`);

await c.end();
process.exit(fail?1:0);
