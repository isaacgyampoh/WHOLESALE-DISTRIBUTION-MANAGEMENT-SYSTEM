/**
 * Step 8 gate: never run test data against a project holding real
 * business records.
 *
 * A freshly migrated project contains the demo rows from 0008_seed.sql.
 * Anything else is treated as real data and stops the run. The check is
 * deliberately conservative: it would rather refuse a development
 * project than write into a live one.
 */

// Exactly what 0008_seed.sql inserts.
const SEED = {
  warehouses: ["WH-ACC", "WH-KUM"],
  suppliers: ["SUP-001", "SUP-002"],
  customers: ["CUS-001", "CUS-002", "CUS-003"],
  products: ["SKU-1001", "SKU-1002", "SKU-2001", "SKU-2002", "SKU-3001", "SKU-4001"],
  categories: ["Beverages", "Dry Goods", "Household", "Personal Care"],
};

/** Rows this suite created on a previous run, safe to ignore and clean. */
export const TEST_PREFIX = "HTEST-";

export async function assessProject(admin) {
  const findings = [];
  let unknownRows = 0;

  for (const [table, known] of Object.entries(SEED)) {
    const column = table === "categories" ? "name" : "code";
    const { data, error } = await admin.from(table).select(`${column}`);

    if (error) {
      findings.push({ table, error: error.message });
      continue;
    }

    const values = (data ?? []).map((r) => r[column]);
    const unknown = values.filter(
      (v) => !known.includes(v) && !String(v).startsWith(TEST_PREFIX),
    );
    unknownRows += unknown.length;
    findings.push({
      table,
      total: values.length,
      seed: values.filter((v) => known.includes(v)).length,
      fromPreviousRun: values.filter((v) => String(v).startsWith(TEST_PREFIX)).length,
      unknown: unknown.length,
      sample: unknown.slice(0, 3),
    });
  }

  // Transactional history is the strongest signal of a live project.
  for (const table of ["van_sales", "invoices", "payments", "credit_transactions"]) {
    const { count, error } = await admin
      .from(table)
      .select("id", { count: "exact", head: true });
    if (error) {
      findings.push({ table, error: error.message });
      continue;
    }
    findings.push({ table, total: count ?? 0, transactional: true });
    if ((count ?? 0) > 0) unknownRows += count ?? 0;
  }

  return { findings, unknownRows, safe: unknownRows === 0 };
}

export function printAssessment({ findings, unknownRows, safe }) {
  for (const f of findings) {
    if (f.error) {
      console.log(`  ${String(f.table).padEnd(22)} could not read: ${f.error}`);
      continue;
    }
    if (f.transactional) {
      console.log(`  ${String(f.table).padEnd(22)} ${f.total} row(s)`);
      continue;
    }
    console.log(
      `  ${String(f.table).padEnd(22)} ${f.total} total  ` +
        `(${f.seed} demo, ${f.fromPreviousRun} from a previous test run, ${f.unknown} unrecognised)` +
        (f.sample?.length ? `  e.g. ${f.sample.join(", ")}` : ""),
    );
  }
  console.log(
    safe
      ? "\n  Project looks development-only: no unrecognised business data."
      : `\n  STOP: ${unknownRows} record(s) that are not demo seed or prior test data.`,
  );
  return safe;
}
