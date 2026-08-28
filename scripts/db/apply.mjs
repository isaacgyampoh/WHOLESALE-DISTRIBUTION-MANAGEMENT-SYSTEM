/**
 * Apply migrations to the hosted database.
 *
 * Not the same job as tests/db/migrate.js, which drops the database and
 * rebuilds it - that is right for a test run and would destroy this
 * business. This applies named files, in order, each in its own
 * transaction, and stops at the first failure with everything before it
 * committed and everything after it untouched.
 *
 * Each file is its own transaction on purpose. PostgreSQL will not let a
 * new enum label be used in the transaction that added it, which is why
 * 0049 and 0050 are separate files in the first place; wrapping the run
 * in one transaction would put them back together and fail.
 *
 *   node scripts/db/apply.mjs 0048 0049 0050
 *   node scripts/db/apply.mjs --from 0048
 *   node scripts/db/apply.mjs --from 0048 --dry-run
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectHosted } from "./hosted.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(HERE, "..", "..", "supabase", "migrations");

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const fromIndex = argv.indexOf("--from");
const from = fromIndex >= 0 ? argv[fromIndex + 1] : null;
// The value after --from is a number too, and would otherwise be read
// as a named migration - selecting only that one file rather than every
// file from it onwards.
const named = argv.filter(
  (a, i) => /^\d{4}/.test(a) && !(fromIndex >= 0 && i === fromIndex + 1),
);

const all = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

const chosen = named.length
  ? all.filter((f) => named.some((n) => f.startsWith(n)))
  : from
    ? all.filter((f) => f.slice(0, 4) >= from)
    : [];

if (!chosen.length) {
  console.error("Nothing selected. Pass migration numbers, or --from 0048.");
  process.exit(1);
}

/**
 * What must not change.
 *
 * Read before and after and compared. Everything in this work is meant
 * to add a second quantity without moving the first, so the run says so
 * out loud rather than leaving it to be discovered later.
 */
const CHECKS = [
  ["warehouse units", "select coalesce(sum(qty_on_hand),0)::text v from inventory"],
  ["van units", "select coalesce(sum(qty_on_hand),0)::text v from van_inventory"],
  ["movements", "select count(*)::text v from stock_movements"],
  ["van sale value", "select coalesce(sum(line_total),0)::text v from van_sale_items"],
  ["sales order value", "select coalesce(sum(line_total),0)::text v from sales_order_items"],
  ["purchase value", "select coalesce(sum(line_total),0)::text v from purchase_order_items"],
  ["products", "select count(*)::text v from products"],
  ["customers", "select count(*)::text v from customers"],
];

async function snapshot(client) {
  const out = {};
  for (const [label, sql] of CHECKS) {
    try { out[label] = (await client.query(sql)).rows[0].v; }
    catch { out[label] = "unavailable"; }
  }
  return out;
}

const { client } = await connectHosted();

console.log(`\n${chosen.length} migration(s) to apply:\n`);
for (const f of chosen) console.log(`  ${f}`);

const before = await snapshot(client);
console.log("\nBefore:");
for (const [k, v] of Object.entries(before)) console.log(`  ${k}: ${v}`);

if (dryRun) {
  console.log("\nDry run. Nothing applied.");
  await client.end();
  process.exit(0);
}

console.log("");
let applied = 0;
for (const file of chosen) {
  const sql = readFileSync(path.join(MIGRATIONS, file), "utf8");
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("commit");
    applied += 1;
    console.log(`  OK    ${file}`);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    console.error(`  FAIL  ${file}`);
    console.error(`        ${error.message}`);
    console.error(`\nStopped. ${applied} applied, this one rolled back, the rest untouched.`);
    await client.end();
    process.exit(1);
  }
}

const after = await snapshot(client);
console.log("\nAfter:");
let moved = false;
for (const [k, v] of Object.entries(after)) {
  const same = before[k] === v;
  if (!same) moved = true;
  console.log(`  ${k}: ${v}${same ? "" : `   <-- WAS ${before[k]}`}`);
}

console.log(moved
  ? "\nSomething moved. Read the lines marked above before going further."
  : "\nNothing moved. Every figure reads the same as it did before.");

await client.end();
process.exit(moved ? 1 : 0);
