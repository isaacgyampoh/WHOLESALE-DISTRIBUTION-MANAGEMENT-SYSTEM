const { Client, CONN, runFile } = require('./lib');
const fs = require('fs'), path = require('path');

const MIG = path.resolve(__dirname, '..', '..', 'supabase', 'migrations');

(async () => {
  // Recreate the database from scratch every run.
  const admin = new Client({ ...CONN, database: 'postgres' });
  await admin.connect();
  await admin.query('drop database if exists wdms');
  await admin.query('create database wdms');
  await admin.end();

  const c = new Client(CONN);
  await c.connect();

  console.log('applying supabase shim...');
  await runFile(c, path.join(__dirname, 'shim.sql'), 'shim.sql');
  console.log('  ok\n');

  const files = fs.readdirSync(MIG).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const n = await runFile(c, path.join(MIG, f), f);
    console.log(`  OK  ${f}  (${n} statements)`);
  }
  console.log('\nALL MIGRATIONS APPLIED');
  await c.end();
})().catch(e => { console.error('\nMIGRATION RUN FAILED'); process.exit(1); });
