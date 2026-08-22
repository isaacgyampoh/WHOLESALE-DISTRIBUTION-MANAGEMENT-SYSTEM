/**
 * The upgrade path: a database at 0001-0021 meeting UPGRADE_0022.
 *
 * This is the case that broke in production. An upgrade script had been
 * produced by patching substrings of the migration, and the patch landed
 * inside an enum declaration:
 *
 *     create type public.sync_status as enum (
 *       'applied', 'failed', 'applied', 'failed', 'conflict');
 *
 * PostgreSQL rejected it on the unique index over (enumtypid, enumlabel),
 * and nothing caught it because no test ever ran an upgrade script.
 *
 * So this runs it - against a database at exactly the version the script
 * is written for, then a second time. A duplicated enum label, policy,
 * trigger or index shows up on one run or the other.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const fs = require("fs");
const path = require("path");
const { Client, splitStatements } = require("./lib.js");

const CONN = { host: "127.0.0.1", port: 55432, user: "postgres" };
const DB = "gab_upgrade";
const MIGRATIONS = path.join("..", "..", "supabase", "migrations");
const UPGRADE = path.join("..", "..", "database", "UPGRADE_0022_OFFLINE_SYNC.sql");
const UPGRADE_COST = path.join("..", "..", "database", "UPGRADE_0023_COST_SECURITY.sql");
const UPGRADE_EXPIRY = path.join("..", "..", "database", "UPGRADE_0024_BATCHES_AND_EXPIRY.sql");
const UPGRADE_PAY = path.join("..", "..", "database", "UPGRADE_0025_PAYMENT_METHODS.sql");

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

const admin = new Client({ ...CONN, database: "postgres" }); await admin.connect();
await admin.query(`drop database if exists ${DB}`);
await admin.query(`create database ${DB}`);
await admin.end();

const c = new Client({ ...CONN, database: DB }); await c.connect();

const shim = fs.readFileSync("shim.sql", "utf8");
for (const s of splitStatements(shim)) await c.query(s);

// Everything up to but NOT including 0022.
const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()
  .filter((f) => !["0022", "0023", "0024", "0025"].some((n) => f.startsWith(n)));
for (const f of files) {
  const sql = fs.readFileSync(path.join(MIGRATIONS, f), "utf8");
  for (const s of splitStatements(sql)) {
    try { await c.query(s); }
    catch (e) { console.log(`  FAILED applying ${f}: ${e.message}`); process.exit(1); }
  }
}
console.log(`  migrations up to 0021 applied (${files.length} files)`);

const before = await c.query(
  `select count(*)::int n from pg_type where typname = 'sync_status'`);
ok("sync_status does not exist yet", before.rows[0].n === 0);

const upgradeSql = fs.readFileSync(UPGRADE, "utf8");

// Run 1 - as the SQL editor does, one implicit transaction.
try {
  await c.query(upgradeSql);
  ok("UPGRADE_0022 runs on a 0021 database", true);
} catch (e) {
  ok("UPGRADE_0022 runs on a 0021 database", false, `-> ${e.message}`);
}

const labels = (await c.query(
  `select array_agg(e.enumlabel order by e.enumsortorder)::text v
     from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'sync_status'`)).rows[0]?.v;
ok("sync_status is exactly applied, failed, conflict",
   labels === "{applied,failed,conflict}", labels);

for (const [what, sql] of [
  ["sync_operations exists", `select to_regclass('public.sync_operations') is not null v`],
  ["idempotency key is the primary key", `select exists (
      select 1 from pg_index i join pg_class t on t.oid = i.indrelid
        join pg_attribute a on a.attrelid = t.oid and a.attnum = any(i.indkey)
       where t.relname = 'sync_operations' and i.indisprimary and a.attname = 'id') v`],
  ["row level security is on", `select relrowsecurity v from pg_class where relname = 'sync_operations'`],
  ["the select policy exists", `select exists (select 1 from pg_policies
       where tablename = 'sync_operations' and policyname = 'sync_operations_select') v`],
  ["the append-only trigger exists", `select exists (select 1 from pg_trigger
       where tgrelid = 'public.sync_operations'::regclass and tgname = 'sync_operations_no_edit') v`],
  ["sync_submit exists", `select exists (select 1 from pg_proc p join pg_namespace n
       on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'sync_submit') v`],
  ["sync_bootstrap exists", `select exists (select 1 from pg_proc p join pg_namespace n
       on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'sync_bootstrap') v`],
  // Three declared indexes plus the primary key's own.
  ["the three declared indexes exist", `select count(*)::int = 3 v from pg_indexes
       where tablename = 'sync_operations'
         and indexname in ('sync_operations_org_time','sync_operations_profile','sync_operations_status')`],
  ["authenticated has SELECT only", `select not exists (
      select 1 from information_schema.role_table_grants
       where table_name = 'sync_operations' and grantee = 'authenticated'
         and privilege_type in ('INSERT','UPDATE','DELETE')) v`],
]) {
  const r = await c.query(sql);
  ok(what, r.rows[0].v === true);
}

// Run 2 - the whole point.
console.log("\n=== running it a second time ===");
try {
  await c.query(upgradeSql);
  ok("UPGRADE_0022 runs again with no duplicate errors", true);
} catch (e) {
  ok("UPGRADE_0022 runs again with no duplicate errors", false, `-> ${e.message}`);
}

const after = (await c.query(
  `select array_agg(e.enumlabel order by e.enumsortorder)::text v
     from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'sync_status'`)).rows[0]?.v;
ok("the enum is unchanged after a second run", after === "{applied,failed,conflict}", after);
ok("there is still exactly one sync_operations table",
   (await c.query(`select count(*)::int n from pg_class where relname='sync_operations' and relkind='r'`))
     .rows[0].n === 1);
ok("there is still exactly one select policy",
   (await c.query(`select count(*)::int n from pg_policies where tablename='sync_operations'`))
     .rows[0].n === 1);

// ---- 0023, on top of 0022 -----------------------------------------
console.log("\n=== UPGRADE_0023, then again ===");
const costSql = fs.readFileSync(UPGRADE_COST, "utf8");
try {
  await c.query(costSql);
  ok("UPGRADE_0023 runs on a 0022 database", true);
} catch (e) {
  ok("UPGRADE_0023 runs on a 0022 database", false, `-> ${e.message}`);
}
try {
  await c.query(costSql);
  ok("UPGRADE_0023 runs a second time", true);
} catch (e) {
  ok("UPGRADE_0023 runs a second time", false, `-> ${e.message}`);
}

for (const [what, sql] of [
  ["product_cost exists", `select exists (select 1 from pg_proc p join pg_namespace n
       on n.oid = p.pronamespace where n.nspname='public' and p.proname='product_cost') v`],
  ["products_priced exists", `select to_regclass('public.products_priced') is not null v`],
  ["raw cost is withheld", `select not exists (
      select 1 from information_schema.column_privileges
       where table_name='products' and column_name='cost_price'
         and grantee='authenticated' and privilege_type='SELECT') v`],
  ["the selling price is still granted", `select exists (
      select 1 from information_schema.column_privileges
       where table_name='products' and column_name='list_price'
         and grantee='authenticated' and privilege_type='SELECT') v`],
  ["suppliers are role-gated", `select exists (select 1 from pg_policies
       where tablename='suppliers' and policyname='suppliers_read' and qual like '%has_role%') v`],
]) {
  const r = await c.query(sql);
  ok(what, r.rows[0].v === true);
}

// ---- 0024, on top of 0023 -----------------------------------------
console.log("\n=== UPGRADE_0024, then again ===");
const expirySql = fs.readFileSync(UPGRADE_EXPIRY, "utf8");
for (const attempt of ["runs on a 0023 database", "runs a second time"]) {
  try {
    await c.query(expirySql);
    ok(`UPGRADE_0024 ${attempt}`, true);
  } catch (e) {
    ok(`UPGRADE_0024 ${attempt}`, false, `-> ${e.message}`);
  }
}

for (const [what, sql] of [
  ["product_batches exists", `select to_regclass('public.product_batches') is not null v`],
  ["tracking is off by default", `select (select column_default from information_schema.columns
       where table_name='products' and column_name='track_expiry') like 'false%' v`],
  ["batch_expiry_status exists", `select to_regclass('public.batch_expiry_status') is not null v`],
  ["expiry_summary exists", `select to_regclass('public.expiry_summary') is not null v`],
  ["receive_purchase_batch exists", `select exists (select 1 from pg_proc p
       join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='receive_purchase_batch') v`],
  ["dispatch refuses expired stock", `select (select pg_get_functiondef(p.oid) from pg_proc p
       join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='dispatch_van_load') like '%expired on%' v`],
  ["batches carry row level security", `select relrowsecurity v from pg_class
      where oid='public.product_batches'::regclass`],
  ["the warning period is configurable", `select exists (select 1 from information_schema.columns
      where table_name='organizations' and column_name='expiry_warning_days') v`],
]) {
  const r = await c.query(sql);
  ok(what, r.rows[0].v === true);
}

// ---- 0025, on top of 0024 -----------------------------------------
console.log("\n=== UPGRADE_0025, then again ===");
const paySql = fs.readFileSync(UPGRADE_PAY, "utf8");
for (const attempt of ["runs on a 0024 database", "runs a second time"]) {
  try {
    await c.query(paySql);
    ok(`UPGRADE_0025 ${attempt}`, true);
  } catch (e) {
    ok(`UPGRADE_0025 ${attempt}`, false, `-> ${e.message}`);
  }
}

for (const [what, sql] of [
  ["van_sale_payments exists", `select to_regclass('public.van_sale_payments') is not null v`],
  ["record_sale_payments exists", `select exists (select 1 from pg_proc p
       join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='record_sale_payments') v`],
  ["load_takings exists", `select to_regclass('public.load_takings') is not null v`],
  ["reconciliation counts momo apart", `select (select count(*) from information_schema.columns
      where table_name='van_reconciliations'
        and column_name in ('expected_momo','actual_momo','momo_variance')) = 3 v`],
  ["nobody writes a payment by hand", `select not exists (
      select 1 from information_schema.role_table_grants
       where table_name='van_sale_payments' and grantee='authenticated'
         and privilege_type in ('INSERT','UPDATE','DELETE')) v`],
]) {
  const r = await c.query(sql);
  ok(what, r.rows[0].v === true);
}

// An incompatible enum must stop the script rather than be ignored.
console.log("\n=== an incompatible existing enum is refused ===");
await c.query(`create type public.sync_status_probe as enum ('applied','failed')`);
const probe = fs.readFileSync(UPGRADE, "utf8")
  .replace(/sync_status/g, "sync_status_probe");
try {
  await c.query(probe.slice(0, probe.indexOf("end $enum$;") + 11));
  ok("a mismatched enum stops the script", false, "it was accepted");
} catch (e) {
  ok("a mismatched enum stops the script", /already exists with different values/.test(e.message),
     e.message.split("\n")[0].slice(0, 70));
}

// Leave the database as the upgrade found it, so VERIFY_DATABASE.sql can
// be run against it afterwards and see a real schema rather than this
// suite's scaffolding.
await c.query(`drop type if exists public.sync_status_probe`);
ok("the probe type is cleaned up",
   (await c.query(`select count(*)::int n from pg_type where typname like 'sync_%_probe'`))
     .rows[0].n === 0);

// The schema this suite leaves behind must satisfy the shipped
// verification script, which is what the owner runs after upgrading.
const verify = fs.readFileSync(path.join("..", "..", "database", "VERIFY_DATABASE.sql"), "utf8");
const report = await c.query(verify);
const notOk = (report.rows ?? []).filter((r) => r.status === "FAIL" || r.status === "CHECK");
ok("VERIFY_DATABASE.sql reports no FAIL or CHECK after the upgrade",
   notOk.length === 0,
   notOk.map((r) => `${r.check}: ${r.actual}`).join("; "));

console.log(`\n  ${pass} passed, ${fail} failed`);
await c.end();
process.exit(fail ? 1 : 0);
