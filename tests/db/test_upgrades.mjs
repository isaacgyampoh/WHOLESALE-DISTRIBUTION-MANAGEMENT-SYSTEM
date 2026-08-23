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
const UPGRADE_DOCS = path.join("..", "..", "database", "UPGRADE_0026_DOCUMENTS.sql");
const UPGRADE_TRF = path.join("..", "..", "database", "UPGRADE_0027_TRANSFERS.sql");
const UPGRADE_NTF = path.join("..", "..", "database", "UPGRADE_0028_NOTIFICATIONS.sql");
const UPGRADE_DOCS_SUP = path.join("..", "..", "database", "UPGRADE_0029_SUPPLIER_DOCUMENTS.sql");
const UPGRADE_PORTAL = path.join("..", "..", "database", "UPGRADE_0030_SUPPLIER_PORTAL.sql");
const UPGRADE_SUBMIT = path.join("..", "..", "database", "UPGRADE_0031_SUPPLIER_SUBMISSIONS.sql");
const UPGRADE_ROLE = path.join("..", "..", "database", "UPGRADE_0032_SALESPERSON_ROLE.sql");
const UPGRADE_CREW = path.join("..", "..", "database", "UPGRADE_0033_VAN_CREW.sql");
const UPGRADE_MOMO = path.join("..", "..", "database", "UPGRADE_0034_MOMO_PROVIDER.sql");

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
  .filter((f) => !["0022", "0023", "0024", "0025", "0026", "0027", "0028", "0029", "0030",
                   "0031", "0032", "0033", "0034"].some((n) => f.startsWith(n)));
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

// ---- 0026, on top of 0025 -----------------------------------------
console.log("\n=== UPGRADE_0026, then again ===");
const docsSql = fs.readFileSync(UPGRADE_DOCS, "utf8");
for (const attempt of ["runs on a 0025 database", "runs a second time"]) {
  try {
    await c.query(docsSql);
    ok(`UPGRADE_0026 ${attempt}`, true);
  } catch (e) {
    ok(`UPGRADE_0026 ${attempt}`, false, `-> ${e.message}`);
  }
}

for (const [what, sql] of [
  ["invoices link to their sale", `select exists (select 1 from information_schema.columns
      where table_name='invoices' and column_name='van_sale_id') v`],
  ["one invoice per sale", `select exists (select 1 from pg_indexes
      where schemaname='public' and indexname='invoices_one_per_sale') v`],
  ["a credit sale raises its own", `select exists (select 1 from pg_trigger
      where tgname='van_sales_raise_invoice') v`],
  ["waybills exist", `select to_regclass('public.waybills') is not null v`],
  ["printable views exist", `select to_regclass('public.invoice_detail') is not null
      and to_regclass('public.receipt_detail') is not null v`],
  ["no cost on a customer document", `select not exists (
      select 1 from information_schema.columns
       where table_name in ('invoice_detail','receipt_detail')
         and column_name ilike '%cost%') v`],
]) {
  const r = await c.query(sql);
  ok(what, r.rows[0].v === true);
}

// ---- 0027, on top of 0026 -----------------------------------------
console.log("\n=== UPGRADE_0027, then again ===");
const trfSql = fs.readFileSync(UPGRADE_TRF, "utf8");
for (const attempt of ["runs on a 0026 database", "runs a second time"]) {
  try {
    await c.query(trfSql);
    ok(`UPGRADE_0027 ${attempt}`, true);
  } catch (e) {
    ok(`UPGRADE_0027 ${attempt}`, false, `-> ${e.message}`);
  }
}

for (const [what, sql] of [
  ["the lifecycle has an approved state", `select exists (
      select 1 from pg_constraint
       where conrelid='public.stock_transfers'::regclass
         and conname='stock_transfers_status_check'
         and pg_get_constraintdef(oid) like '%approved%') v`],
  ["all four transfer functions exist", `select (select count(*) from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname in
       ('approve_stock_transfer','dispatch_stock_transfer',
        'receive_stock_transfer','cancel_stock_transfer')) = 4 v`],
  ["what arrived is recorded", `select exists (select 1 from information_schema.columns
      where table_name='stock_transfer_items' and column_name='qty_received') v`],
  ["stock in transit is reportable", `select to_regclass('public.stock_in_transit') is not null v`],
  ["a batch may be in two warehouses", `select (select indexdef from pg_indexes
      where schemaname='public' and indexname='product_batches_unique')
      like '%warehouse_id%' v`],
  // The widened index leaves receive_purchase_batch() naming a conflict
  // target that no longer exists. The upgrade has to carry the fix, or
  // the next batch-tracked delivery fails outright.
  ["receiving a purchase still names a real index", `select position(
      'warehouse_id' in (select pg_get_functiondef(p.oid) from pg_proc p
        join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='receive_purchase_batch'
       limit 1)) > 0 v`],
]) {
  const r = await c.query(sql);
  ok(what, r.rows[0].v === true);
}

// ---- 0028, on top of 0027 -----------------------------------------
console.log("\n=== UPGRADE_0028, then again ===");
const ntfSql = fs.readFileSync(UPGRADE_NTF, "utf8");
for (const attempt of ["runs on a 0027 database", "runs a second time"]) {
  try {
    await c.query(ntfSql);
    ok(`UPGRADE_0028 ${attempt}`, true);
  } catch (e) {
    ok(`UPGRADE_0028 ${attempt}`, false, `-> ${e.message}`);
  }
}

for (const [what, sql] of [
  ["notifications exist", `select to_regclass('public.notifications') is not null v`],
  ["a condition is one row, not one a day", `select exists (select 1 from pg_indexes
      where schemaname='public' and indexname='notifications_standing_unique') v`],
  ["refresh_standing_alerts exists", `select exists (select 1 from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='refresh_standing_alerts') v`],
  ["events are written by trigger", `select (select count(*) from pg_trigger
      where tgname in ('reconciliations_notify','van_returns_notify',
                       'stock_transfers_notify','stock_transfers_notify_short')) = 4 v`],
  ["nobody writes their own", `select not exists (
      select 1 from information_schema.role_table_grants
       where table_name='notifications' and grantee='authenticated'
         and privilege_type in ('INSERT','DELETE')) v`],
  // Running it against an organization's real data is the part that
  // cannot be checked by looking at the schema.
  ["refreshing conditions works on live data", `select refresh_standing_alerts(
      (select id from public.organizations limit 1)) >= 0 v`],
]) {
  const r = await c.query(sql);
  ok(what, r.rows[0].v === true);
}

// ---- 0029 and 0030, on top of 0028 --------------------------------
console.log("\n=== UPGRADE_0029 and UPGRADE_0030, then again ===");
for (const [name, file] of [["0029", UPGRADE_DOCS_SUP], ["0030", UPGRADE_PORTAL],
                            ["0031", UPGRADE_SUBMIT],
                            // 0032 is the enum label on its own: PostgreSQL
                            // will not let 0033 use it in the same
                            // transaction that created it.
                            ["0032", UPGRADE_ROLE], ["0033", UPGRADE_CREW],
                            ["0034", UPGRADE_MOMO]]) {
  const sql = fs.readFileSync(file, "utf8");
  for (const attempt of ["runs in order", "runs a second time"]) {
    try {
      await c.query(sql);
      ok(`UPGRADE_${name} ${attempt}`, true);
    } catch (e) {
      ok(`UPGRADE_${name} ${attempt}`, false, `-> ${e.message}`);
    }
  }
}

for (const [what, sql] of [
  ["the document bucket is private", `select exists (select 1 from storage.buckets
      where id='supplier-documents' and public=false) v`],
  ["supplier_documents exists", `select to_regclass('public.supplier_documents') is not null v`],
  ["the files have policies of their own", `select (select count(*) from pg_policies
      where schemaname='storage' and tablename='objects'
        and policyname like 'supplier_documents_objects%') = 3 v`],
  ["portal links are a digest only", `select exists (select 1 from information_schema.columns
      where table_name='supplier_portal_tokens' and column_name='token_hash')
    and not exists (select 1 from information_schema.columns
      where table_name='supplier_portal_tokens'
        and column_name in ('token','secret','plaintext')) v`],
  ["every link expires", `select exists (select 1 from pg_constraint
      where conrelid='public.supplier_portal_tokens'::regclass
        and conname='supplier_portal_tokens_expiry_ahead') v`],
  ["redeeming is server-side only", `select not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='resolve_supplier_token'
         and (has_function_privilege('anon', p.oid, 'EXECUTE')
              or has_function_privilege('authenticated', p.oid, 'EXECUTE'))) v`],
  // ---- the crew model, applied as an upgrade ----
  ["a van assignment names a job", `select (select count(*) from information_schema.columns
      where table_name='van_assignments' and column_name in ('member_id','crew_role')) = 2 v`],
  ["one driver per van", `select exists (select 1 from pg_indexes
      where indexname='van_assignments_one_active_driver_per_van') v`],
  ["a sale records who sold it", `select exists (select 1 from information_schema.columns
      where table_name='van_sales' and column_name='salesperson_id') v`],
  ["no sale is left unattributed", `select not exists (
      select 1 from public.van_sales where salesperson_id is null) v`],
  // The trap this migration fell into: policies are permissive and OR
  // together, so the old driver rule had to be dropped, not outvoted.
  ["the old driver-insert policy is gone", `select not exists (select 1 from pg_policies
      where tablename='van_sales' and policyname='van_sales_driver_insert') v`],
  ["selling is gated on being crewed to sell", `select exists (select 1 from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='is_van_salesperson') v`],
  ["salesperson is a role", `select exists (select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid
      where t.typname='user_role' and e.enumlabel='salesperson') v`],
  ["user_role has no duplicate labels", `select (
      select count(*) = count(distinct e.enumlabel) from pg_enum e join pg_type t on t.oid=e.enumtypid
       where t.typname='user_role') v`],
  ["mobile money knows its network", `select (select count(*) from information_schema.columns
      where table_name in ('van_sale_payments','payments') and column_name='provider') = 2 v`],
  ["the Ghanaian networks are listed", `select (select count(*) from public.momo_providers
      where code in ('mtn','telecel','airteltigo')) = 3 v`],

  ["a supplier can submit their own invoice", `select exists (select 1 from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='submit_supplier_document') v`],
  ["submitting is server-side only", `select not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='submit_supplier_document'
         and (has_function_privilege('anon', p.oid, 'EXECUTE')
              or has_function_privilege('authenticated', p.oid, 'EXECUTE'))) v`],
  ["a review workflow exists", `select exists (
      select 1 from pg_type where typname='document_review_status') v`],
  ["invoices carry a discount", `select exists (select 1 from information_schema.columns
      where table_name='invoices' and column_name='discount') v`],
  ["waybills record shortages", `select (select count(*) from information_schema.columns
      where table_name='waybill_items'
        and column_name in ('qty_received','qty_damaged','qty_short')) = 3 v`],
  ["returns have a structured reason", `select exists (
      select 1 from pg_type where typname='return_reason') v`],
  ["customer and supplier returns move stock", `select to_regclass('public.stock_returns')
      is not null and exists (select 1 from pg_proc p
        join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='record_stock_return') v`],
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
