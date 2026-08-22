/**
 * Generates the consolidated installer from supabase/migrations.
 *
 * The migrations remain the authoritative source; this file is derived,
 * never hand-edited. Regenerate with:  node database/build.mjs
 *
 * One transformation is required. The Supabase SQL Editor runs a script
 * inside a single transaction, and PostgreSQL refuses to use a new enum
 * value in the transaction that added it. Migration 0010 appends values
 * to user_role and movement_type which migrations 0011-0013 then use in
 * policy expressions, so a literal concatenation aborts partway through.
 *
 * For a fresh install the ALTERs are unnecessary: the enums are declared
 * complete up front, in the same order the migration path produces, and
 * 0010 becomes a no-op. Nothing else is altered.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { idempotentSql, splitStatements } from "./sqlgen.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(here, "..", "supabase", "migrations");
const OUT = path.join(here, "WHOLESALE_DISTRIBUTION_DATABASE.sql");

/**
 * Upgrade scripts, for a database installed before a given migration.
 *
 * Generated from the migration rather than written alongside it. The
 * first one of these was hand-patched and shipped with a duplicated enum
 * label, so the rule now is that no upgrade file is authored directly:
 * the migration is the source, and this turns it into something safe to
 * run against a database that already has some of it.
 */
const UPGRADES = [
  {
    migration: "0022_offline_sync.sql",
    out: "UPGRADE_0022_OFFLINE_SYNC.sql",
    title: "UPGRADE 0022 - offline operation and synchronisation",
    summary: `-- WHAT IT ADDS
--
--   sync_operations   one row per offline mutation, keyed by a uuid the
--                     device generates before queueing. That key is the
--                     primary key, so a retried upload cannot apply the
--                     same sale twice.
--   sync_submit()     the single entry point for a queued operation.
--                     Re-derives authorization from the calling session
--                     and never from the payload.
--   sync_bootstrap()  the snapshot a phone caches so it can keep
--                     selling with no signal.
--
-- The driver PWA does not work without this. Everything else in the
-- application does.`,
    verify: `select 'sync_operations table' as check,
       case when to_regclass('public.sync_operations') is not null
            then 'PASS' else 'FAIL' end as result
union all
select 'sync_status has exactly applied/failed/conflict',
       case when (
         select array_agg(e.enumlabel order by e.enumsortorder)
           from pg_enum e join pg_type t on t.oid = e.enumtypid
          where t.typname = 'sync_status'
       ) = array['applied','failed','conflict']::name[]
            then 'PASS' else 'FAIL' end
union all
select 'row level security on',
       case when (select relrowsecurity from pg_class
                   where oid = 'public.sync_operations'::regclass)
            then 'PASS' else 'FAIL' end
union all
select 'sync_submit function',
       case when exists (select 1 from pg_proc p
                           join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'sync_submit')
            then 'PASS' else 'FAIL' end
union all
select 'sync_bootstrap function',
       case when exists (select 1 from pg_proc p
                           join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'sync_bootstrap')
            then 'PASS' else 'FAIL' end
union all
select 'history is append-only',
       case when exists (select 1 from pg_trigger
                          where tgrelid = 'public.sync_operations'::regclass
                            and tgname = 'sync_operations_no_edit')
            then 'PASS' else 'FAIL' end
union all
select 'authenticated cannot write it',
       case when not exists (
              select 1 from information_schema.role_table_grants
               where table_name = 'sync_operations' and grantee = 'authenticated'
                 and privilege_type in ('INSERT','UPDATE','DELETE'))
            then 'PASS' else 'FAIL' end;`,
  },
  {
    migration: "0023_cost_is_management_information.sql",
    out: "UPGRADE_0023_COST_SECURITY.sql",
    title: "UPGRADE 0023 - cost price is management information",
    summary: `-- WHAT IT CLOSES
--
-- A driver could read what the business pays for its goods:
--
--   select cost_price from products;
--   select stock_value from van_stock_summary;
--   select unit_cost from van_load_items;
--   select * from suppliers;
--
-- and the products screen rendered a Cost column to them. Every one of
-- those reads is available to anything holding the anon key and a
-- driver's session, so hiding the column in the interface would have
-- changed nothing.
--
-- WHAT IT ADDS
--
--   product_cost()     the one route to a cost figure. Returns NULL to
--                      any role outside admin, senior_manager, manager,
--                      accountant and warehouse.
--   products_priced    products with cost masked per caller. The
--                      application reads this instead of the table.
--
-- and it withdraws the raw cost columns from every Data API caller,
-- remasks stock_summary and van_stock_summary, and puts suppliers
-- behind the same roles.
--
-- AFTER RUNNING IT, redeploy the application. The version before this
-- reads products.cost_price directly and would fail on the products,
-- reports and warehouses screens.`,
    verify: `select 'product_cost function' as check,
       case when exists (select 1 from pg_proc p
                           join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'product_cost')
            then 'PASS' else 'FAIL' end as result
union all
select 'products_priced view',
       case when to_regclass('public.products_priced') is not null
            then 'PASS' else 'FAIL' end
union all
select 'raw cost withheld from authenticated',
       case when not exists (
              select 1 from information_schema.column_privileges
               where table_name = 'products' and column_name = 'cost_price'
                 and grantee = 'authenticated' and privilege_type = 'SELECT')
            then 'PASS' else 'FAIL' end
union all
select 'the selling price is still readable',
       case when exists (
              select 1 from information_schema.column_privileges
               where table_name = 'products' and column_name = 'list_price'
                 and grantee = 'authenticated' and privilege_type = 'SELECT')
            then 'PASS' else 'FAIL' end
union all
select 'suppliers are role-gated',
       case when exists (
              select 1 from pg_policies
               where tablename = 'suppliers' and policyname = 'suppliers_read'
                 and qual like '%has_role%')
            then 'PASS' else 'FAIL' end;`,
  },
];

/** Final enum members, in the order `alter type ... add value` yields. */
const ENUM_REWRITES = [
  {
    file: "0001_foundation.sql",
    from: `create type public.user_role as enum (
  'admin', 'manager', 'sales_rep', 'warehouse', 'accountant'
);`,
    to: `create type public.user_role as enum (
  'admin', 'manager', 'sales_rep', 'warehouse', 'accountant',
  -- Appended by migration 0010; declared here so the whole installer can
  -- run inside one transaction.
  'driver', 'senior_manager'
);`,
  },
  {
    file: "0001_foundation.sql",
    from: `create type public.movement_type as enum (
  'receipt', 'issue', 'adjustment_in', 'adjustment_out',
  'transfer_in', 'transfer_out', 'customer_return', 'supplier_return'
);`,
    to: `create type public.movement_type as enum (
  'receipt', 'issue', 'adjustment_in', 'adjustment_out',
  'transfer_in', 'transfer_out', 'customer_return', 'supplier_return',
  -- Appended by migration 0010, as above.
  'damage', 'shortage'
);`,
  },
];

const NEUTRALISED = {
  "0010_enum_extensions.sql": `-- Migration 0010 appends values to user_role and movement_type.
-- In this consolidated installer those values are already part of the
-- enum declarations in section 0001, because PostgreSQL cannot use a new
-- enum value in the transaction that added it. Nothing to do here.`,
};

const banner = (title) =>
  `\n\n-- ${"=".repeat(68)}\n-- ${title}\n-- ${"=".repeat(68)}\n`;

const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
let applied = 0;
const parts = [];

for (const file of files) {
  let sql = fs.readFileSync(path.join(MIGRATIONS, file), "utf8");

  if (NEUTRALISED[file]) {
    parts.push(banner(file) + NEUTRALISED[file] + "\n");
    continue;
  }

  for (const rule of ENUM_REWRITES) {
    if (rule.file !== file) continue;
    if (!sql.includes(rule.from)) {
      throw new Error(
        `Enum rewrite target not found in ${file}. The migration has changed; ` +
          `update database/build.mjs rather than editing the installer.`,
      );
    }
    sql = sql.replace(rule.from, rule.to);
    applied++;
  }

  parts.push(banner(file) + sql.trimEnd() + "\n");
}

if (applied !== ENUM_REWRITES.length) {
  throw new Error(`Expected ${ENUM_REWRITES.length} enum rewrites, applied ${applied}`);
}

const header = `-- =====================================================================
-- WHOLESALE DISTRIBUTION MANAGEMENT SYSTEM
-- Complete database installer for a fresh Supabase project
--
-- GENERATED FILE - do not edit by hand.
-- Source: supabase/migrations/0001 .. 0015
-- Regenerate: node database/build.mjs
--
-- HOW TO INSTALL
--   1. Open your Supabase project, then SQL Editor.
--   2. New query, paste this entire file, Run.
--   3. Run database/VERIFY_DATABASE.sql to confirm the result.
--   4. Create your first user in Authentication, then promote them:
--        update public.profiles set role = 'admin' where email = 'you@example.com';
--
-- WHAT THIS DOES NOT DO
--   It does not create auth.users. Supabase provides that schema, and a
--   trigger installed here creates a public.profiles row whenever a user
--   signs up. Running this against a database without Supabase Auth will
--   fail on that reference, which is intended.
--
-- SAFE TO RUN ON A FRESH PROJECT ONLY. It creates objects; it does not
-- drop an existing installation.
-- =====================================================================
`;

// The installer is for an empty project, but a CREATE TYPE that meets an
// existing type aborts the whole transaction with nothing to say about
// which one. Guarding them turns that into a message naming the type and
// both label lists. It does not make the installer re-runnable - the
// tables would still collide - it makes the failure legible.
const installer = idempotentSql(header + parts.join("") + "\n");
fs.writeFileSync(OUT, installer);

// ---- upgrade scripts, from the same migrations -----------------------
const upgradeSummaries = [];
for (const upgrade of UPGRADES) {
  const source = path.join(MIGRATIONS, upgrade.migration);
  if (!fs.existsSync(source)) {
    throw new Error(`Upgrade ${upgrade.out} names a migration that does not exist: ${upgrade.migration}`);
  }

  const body = idempotentSql(fs.readFileSync(source, "utf8"));
  const bar = "-- " + "=".repeat(68);
  const text = `${bar}
-- ${upgrade.title}
${bar}
--
-- For a database installed before migration ${upgrade.migration.slice(0, 4)}.
-- Run it in the Supabase SQL editor.
--
-- GENERATED FILE - do not edit by hand.
-- Source: supabase/migrations/${upgrade.migration}
-- Regenerate: node database/build.mjs
--
-- Safe to run twice. Every object is created behind an existence check,
-- so a second run reports success and changes nothing. An enum that
-- already exists is compared against what this script expects and the
-- script stops with both lists if they differ, rather than altering a
-- type other code may already depend on.
--
${upgrade.summary}

${body.trim()}

${bar}
-- Confirm it took. Every row should read PASS.
${bar}
${upgrade.verify}
`;

  const outPath = path.join(here, upgrade.out);
  fs.writeFileSync(outPath, text);
  upgradeSummaries.push(`  ${upgrade.out}  ${(text.length / 1024).toFixed(1)} KB`);
}

const text = fs.readFileSync(OUT, "utf8");
const leftovers = text.match(/alter type[^;]*add value/gi) ?? [];
if (leftovers.length) {
  throw new Error(`Installer still contains ${leftovers.length} enum ALTER(s); it cannot run in one transaction.`);
}

console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
console.log(`  source migrations: ${files.length}`);
console.log(`  enum rewrites applied: ${applied}`);
console.log(`  size: ${(text.length / 1024).toFixed(1)} KB, ${text.split("\n").length} lines`);
console.log(`  residual "alter type ... add value": ${leftovers.length}`);

// A duplicated enum label is what broke the first upgrade script. It is
// cheap to prove it cannot ship again.
for (const statement of splitStatements(text)) {
  const enumDecl = /create type public\.([a-z_]+) as enum \(([^)]*)\)/i.exec(statement);
  if (!enumDecl) continue;
  const labels = [...enumDecl[2].matchAll(/'([^']*)'/g)].map((m) => m[1]);
  const dup = labels.find((l, i) => labels.indexOf(l) !== i);
  if (dup) throw new Error(`Installer enum ${enumDecl[1]} repeats '${dup}'.`);
}

if (upgradeSummaries.length) {
  console.log(`\nwrote ${upgradeSummaries.length} upgrade script(s):`);
  for (const line of upgradeSummaries) console.log(line);
}
