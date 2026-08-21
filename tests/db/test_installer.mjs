import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
const { splitStatements } = require("./lib.js");

/**
 * Verifies database/WHOLESALE_DISTRIBUTION_DATABASE.sql actually installs.
 *
 * The file is sent as ONE multi-statement query over the simple query
 * protocol, which is how the Supabase SQL Editor executes a pasted
 * script: a single implicit transaction. Anything that cannot run that
 * way - notably adding an enum value and then using it - fails here.
 *
 * The target database is built without default-privilege grants, so it
 * matches Supabase's current behaviour of not auto-exposing new objects.
 */
const CONN = { host: "127.0.0.1", port: 55432, user: "postgres" };
const INSTALLER = path.join(process.cwd(), "..", "..", "database", "WHOLESALE_DISTRIBUTION_DATABASE.sql");
const installerPath = fs.existsSync(INSTALLER)
  ? INSTALLER
  : path.join(process.cwd(), "database", "WHOLESALE_DISTRIBUTION_DATABASE.sql");

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

const admin = new Client({ ...CONN, database: "postgres" });
await admin.connect();
await admin.query("drop database if exists installer_test");
await admin.query("create database installer_test");
await admin.end();

const c = new Client({ ...CONN, database: "installer_test" });
await c.connect();

// Supabase platform prerequisites only: auth schema, auth.uid(), roles.
// Default-privilege grants are stripped to match the hosted default.
let shim = fs.readFileSync(path.join(path.dirname(installerPath), "..", "tests", "db", "shim.sql"), "utf8")
  .replace(/alter default privileges in schema public[\s\S]*?;/g, "");
for (const s of splitStatements(shim)) await c.query(s);
console.log("Supabase prerequisites in place (auth schema, roles), no auto-grants\n");

console.log("=== installing as a single transaction, as the SQL Editor does ===");
const sql = fs.readFileSync(installerPath, "utf8");
let installed = false;
try {
  await c.query(sql);
  installed = true;
  ok("installer runs in one transaction", true, `(${(sql.length / 1024).toFixed(0)} KB)`);
} catch (e) {
  ok("installer runs in one transaction", false, `-> ${e.message}`);
  if (e.position) {
    const upto = sql.slice(0, Number(e.position));
    console.log(`    failed near line ${upto.split("\n").length}`);
    console.log(`    ${upto.split("\n").slice(-3).join("\n    ")}`);
  }
}

if (installed) {
  const q = async (s) => (await c.query(s)).rows[0].n;
  const counts = {
    tables: await q("select count(*)::int n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"),
    views: await q("select count(*)::int n from information_schema.views where table_schema='public'"),
    functions: await q("select count(distinct p.proname)::int n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')"),
    triggers: await q("select count(*)::int n from pg_trigger t join pg_class cl on cl.oid=t.tgrelid join pg_namespace ns on ns.oid=cl.relnamespace where not t.tgisinternal and ns.nspname in ('public','auth')"),
    policies: await q("select count(*)::int n from pg_policy p join pg_class cl on cl.oid=p.polrelid join pg_namespace ns on ns.oid=cl.relnamespace where ns.nspname='public'"),
    enums: await q("select count(distinct t.typname)::int n from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace ns on ns.oid=t.typnamespace where ns.nspname='public'"),
    rlsOn: await q("select count(*)::int n from pg_class cl join pg_namespace ns on ns.oid=cl.relnamespace where ns.nspname='public' and cl.relkind='r' and cl.relrowsecurity"),
    indexes: await q("select count(*)::int n from pg_indexes where schemaname='public'"),
    generated: await q("select count(*)::int n from information_schema.columns where table_schema='public' and is_generated='ALWAYS'"),
    constraints: await q("select count(*)::int n from pg_constraint con join pg_class cl on cl.oid=con.conrelid join pg_namespace ns on ns.oid=cl.relnamespace where ns.nspname='public'"),
  };

  // Compare against the database the migrations produce.
  const ref = new Client({ ...CONN, database: "wdms" });
  await ref.connect();
  const rq = async (s) => (await ref.query(s)).rows[0].n;
  const refCounts = {
    tables: await rq("select count(*)::int n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"),
    views: await rq("select count(*)::int n from information_schema.views where table_schema='public'"),
    functions: await rq("select count(distinct p.proname)::int n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')"),
    triggers: await rq("select count(*)::int n from pg_trigger t join pg_class cl on cl.oid=t.tgrelid join pg_namespace ns on ns.oid=cl.relnamespace where not t.tgisinternal and ns.nspname in ('public','auth')"),
    policies: await rq("select count(*)::int n from pg_policy p join pg_class cl on cl.oid=p.polrelid join pg_namespace ns on ns.oid=cl.relnamespace where ns.nspname='public'"),
    enums: await rq("select count(distinct t.typname)::int n from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace ns on ns.oid=t.typnamespace where ns.nspname='public'"),
    rlsOn: await rq("select count(*)::int n from pg_class cl join pg_namespace ns on ns.oid=cl.relnamespace where ns.nspname='public' and cl.relkind='r' and cl.relrowsecurity"),
    indexes: await rq("select count(*)::int n from pg_indexes where schemaname='public'"),
    generated: await rq("select count(*)::int n from information_schema.columns where table_schema='public' and is_generated='ALWAYS'"),
    constraints: await rq("select count(*)::int n from pg_constraint con join pg_class cl on cl.oid=con.conrelid join pg_namespace ns on ns.oid=cl.relnamespace where ns.nspname='public'"),
  };

  console.log("\n=== installer output vs migration output ===");
  for (const k of Object.keys(counts)) {
    ok(`${k} match`, counts[k] === refCounts[k], `installer=${counts[k]} migrations=${refCounts[k]}`);
  }

  // Object-level comparison, not just counts.
  const names = async (cl, sql) => (await cl.query(sql)).rows.map((r) => Object.values(r)[0]).sort();
  const TBL = "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE'";
  const VW = "select table_name from information_schema.views where table_schema='public'";
  const FN = "select distinct p.proname from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')";
  for (const [label, s] of [["table", TBL], ["view", VW], ["function", FN]]) {
    const a = await names(c, s), b = await names(ref, s);
    const missing = b.filter((x) => !a.includes(x));
    const extra = a.filter((x) => !b.includes(x));
    ok(`${label} names identical`, missing.length === 0 && extra.length === 0,
       missing.length || extra.length ? `missing=${missing.join(",")} extra=${extra.join(",")}` : "");
  }

  // Enum members must match exactly, including order.
  const enumsOf = async (cl) => (await cl.query(
    `select t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder) v
     from pg_type t join pg_enum e on e.enumtypid=t.oid
     join pg_namespace ns on ns.oid=t.typnamespace where ns.nspname='public'
     group by t.typname order by t.typname`)).rows;
  const ea = await enumsOf(c), eb = await enumsOf(ref);
  const enumMismatch = eb.filter((r, i) => !ea[i] || ea[i].typname !== r.typname || ea[i].v !== r.v);
  ok("enum members and order identical", enumMismatch.length === 0,
     enumMismatch.length ? enumMismatch.map((r) => r.typname).join(",") : "");

  await ref.end();
  console.log(`\n  installed: ${counts.tables} tables, ${counts.views} views, ${counts.functions} functions,`);
  console.log(`             ${counts.policies} policies, ${counts.triggers} triggers, ${counts.enums} enums,`);
  console.log(`             ${counts.indexes} indexes, ${counts.constraints} constraints, RLS on ${counts.rlsOn} tables`);
}

await c.end();
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
