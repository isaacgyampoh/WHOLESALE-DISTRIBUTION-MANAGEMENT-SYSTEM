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

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(here, "..", "supabase", "migrations");
const OUT = path.join(here, "WHOLESALE_DISTRIBUTION_DATABASE.sql");

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
  'damage', 'shortage',
  -- Appended by migration 0020, in the order those ALTERs yield.
  'opening_stock', 'stocktake_in', 'stocktake_out'
);`,
  },
];

const NEUTRALISED = {
  "0020_inventory_enum_extensions.sql": `-- Migration 0020 appends three movement types. As with 0010 they are
-- already part of the movement_type declaration in section 0001, for the
-- same single-transaction reason. Nothing to do here.`,
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
-- Source: supabase/migrations/0001 .. 0021
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

fs.writeFileSync(OUT, header + parts.join("") + "\n");

const text = fs.readFileSync(OUT, "utf8");
const leftovers = text.match(/alter type[^;]*add value/gi) ?? [];
if (leftovers.length) {
  throw new Error(`Installer still contains ${leftovers.length} enum ALTER(s); it cannot run in one transaction.`);
}

// ---------------------------------------------------------------- upgrades
//
// An existing installation cannot be re-run through the installer, so each
// migration that changes an installed database also ships as an upgrade
// script. These are copies of the migrations with a header explaining what
// they do and how to tell whether they have already been applied; they are
// generated here for the same reason the installer is, so they cannot drift
// from the migration they came from.
const UPGRADES = [
  {
    file: "0020_inventory_enum_extensions.sql",
    out: "UPGRADE_0020_MOVEMENT_TYPES.sql",
    title: "Opening stock and stock count movement types",
    // These three ALTERs must land in their own transaction before 0021
    // can use the values, which is why this is a separate paste.
    check: `select unnest(enum_range(null::public.movement_type));
--   If the list already contains opening_stock, this has been applied.`,
  },
  {
    file: "0021_crew_and_selling.sql",
    out: "UPGRADE_0021_CREW_AND_SELLING.sql",
    title: "Van crew, counter sales, and the ways stock enters",
    check: `select 1 from pg_type where typname = 'van_crew_role';
--   If that returns a row, this has been applied.`,
  },
];

for (const upgrade of UPGRADES) {
  const body = fs.readFileSync(path.join(MIGRATIONS, upgrade.file), "utf8");
  const header = `-- =====================================================================
-- UPGRADE: ${upgrade.title}
--
-- GENERATED FILE - do not edit by hand.
-- Source: supabase/migrations/${upgrade.file}
-- Regenerate: node database/build.mjs
--
-- FOR AN EXISTING INSTALLATION ONLY. A database installed from
-- WHOLESALE_DISTRIBUTION_DATABASE.sql already contains this.
--
-- RUN IT ONCE. Unlike the other upgrade scripts in this folder, this one
-- creates types, renames columns and replaces indexes, so a second run
-- fails partway with "already exists" rather than doing nothing. To check
-- whether it has already been applied, run:
--
--   ${upgrade.check}
--
-- Run ${UPGRADES[0].out} first, on its own: PostgreSQL cannot use a new
-- enum value in the transaction that added it.
-- =====================================================================

`;
  fs.writeFileSync(path.join(here, upgrade.out), header + body.trimEnd() + "\n");
  console.log(`wrote database/${upgrade.out}`);
}

console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
console.log(`  source migrations: ${files.length}`);
console.log(`  enum rewrites applied: ${applied}`);
console.log(`  size: ${(text.length / 1024).toFixed(1)} KB, ${text.split("\n").length} lines`);
console.log(`  residual "alter type ... add value": ${leftovers.length}`);
