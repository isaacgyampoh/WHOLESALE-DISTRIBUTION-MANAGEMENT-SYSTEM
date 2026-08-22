// Applies every migration to a clean database, then runs each suite.
const { execFileSync } = require('child_process');
const suites = [
  'test_stock', 'test_orders', 'test_rls', 'test_tenancy', 'test_van', 'test_scopes',
];
// Rebuilds its own database to simulate the hosted platform's grants, so
// it runs last and is named separately.
const hostedSims = ['test_identity.mjs', 'test_pin.mjs', 'test_admin_security.mjs', 'test_catalogue.mjs', 'test_sync.mjs', 'test_grants.mjs', 'test_installer.mjs'];
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
for (const s of hostedSims) {
  console.log(`\n${'#'.repeat(12)} ${s} ${'#'.repeat(12)}`);
  run(s);
}
process.exit(failed ? 1 : 0);
