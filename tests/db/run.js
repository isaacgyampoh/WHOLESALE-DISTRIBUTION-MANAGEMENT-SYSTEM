// Applies every migration to a clean database, then runs each suite.
const { execFileSync } = require('child_process');
const suites = ['test_stock', 'test_orders', 'test_rls', 'test_tenancy', 'test_van', 'test_scopes'];
let failed = false;

const run = f => {
  try { execFileSync(process.execPath, [f], { cwd: __dirname, stdio: 'inherit' }); }
  catch { failed = true; }
};

run('migrate.js');
for (const s of suites) {
  console.log(`\n${'#'.repeat(12)} ${s} ${'#'.repeat(12)}`);
  run(`${s}.js`);
}
process.exit(failed ? 1 : 0);
