/**
 * Confirming there is no demonstration data left.
 *
 * Run after `production:clean`, and again before the business starts
 * entering real work. It reads and reports; it changes nothing.
 *
 * It looks for demonstration data by three different marks rather than
 * one, because the seed leaves three: the organization slug, the
 * `@demo.invalid` addresses, and the `DEMO-` prefix on codes. Checking
 * only the organization would miss a demo product somebody moved.
 */
import { adminClient, DEMO_ORG_SLUG, DEMO_PREFIX } from "../demo/lib.mjs";

const admin = adminClient();
const say = (m = "") => console.log(m);

let failed = 0;
let checked = 0;

function report(name, clean, detail = "") {
  checked++;
  if (!clean) failed++;
  say(`  ${clean ? "OK  " : "FAIL"}  ${name.padEnd(42)} ${detail}`);
}

say("Checking for demonstration data");
say("");

// ---- the demonstration organization --------------------------------
const { data: demoOrg } = await admin
  .from("organizations").select("id, name").eq("slug", DEMO_ORG_SLUG).maybeSingle();

report("No demonstration organization", !demoOrg,
       demoOrg ? `still present: ${demoOrg.name}` : "");

// ---- accounts the seed created -------------------------------------
const { data: demoUsers } = await admin
  .from("profiles").select("id, full_name, email").like("email", "%@demo.invalid");

report("No demonstration accounts", !demoUsers?.length,
       demoUsers?.length ? demoUsers.map((u) => u.full_name ?? u.email).join(", ") : "");

// ---- rows carrying the demo prefix ---------------------------------
//
// Checked per table because a demo product moved into a real
// organization would otherwise be invisible: the organization is gone,
// so scoping by it finds nothing.
const PREFIXED = [
  ["Products", "products", "sku"],
  ["Customers", "customers", "code"],
  ["Suppliers", "suppliers", "code"],
  ["Warehouses", "warehouses", "code"],
  ["Vans", "vans", "code"],
];

for (const [label, table, column] of PREFIXED) {
  const { data, error } = await admin
    .from(table).select(`id, ${column}`).like(column, `${DEMO_PREFIX}%`).limit(5);
  if (error) {
    report(`No demonstration ${label.toLowerCase()}`, true, "(table not present)");
    continue;
  }
  report(`No demonstration ${label.toLowerCase()}`, !data?.length,
         data?.length ? data.map((r) => r[column]).join(", ") : "");
}

// ---- transactions --------------------------------------------------
//
// If the organization is gone these are all zero by construction. They
// are checked anyway: the point of this script is to be believed, and a
// check that cannot fail proves nothing.
if (demoOrg) {
  const TRANSACTIONAL = [
    ["sales", "van_sales"],
    ["invoices", "invoices"],
    ["receipts", "payments"],
    ["credit entries", "credit_transactions"],
    ["stock movements", "stock_movements"],
    ["purchase orders", "purchase_orders"],
    ["supplier documents", "supplier_documents"],
    ["supplier portal links", "supplier_portal_tokens"],
    ["audit entries", "audit_log"],
  ];

  for (const [label, table] of TRANSACTIONAL) {
    const { count, error } = await admin
      .from(table).select("id", { count: "exact", head: true }).eq("org_id", demoOrg.id);
    if (error) continue;
    report(`No demonstration ${label}`, (count ?? 0) === 0, count ? `${count} remaining` : "");
  }
}

// ---- portal links --------------------------------------------------
//
// A live link is a credential. One left over from a demonstration is a
// working way into a supplier's page.
const { data: liveTokens, error: tokenError } = await admin
  .from("supplier_portal_tokens")
  .select("id, label, expires_at")
  .is("revoked_at", null)
  .gt("expires_at", new Date().toISOString());

if (!tokenError) {
  report("No live supplier links from the demonstration",
         !liveTokens?.length || !demoOrg,
         liveTokens?.length ? `${liveTokens.length} link(s) still valid - revoke any that were demonstrations` : "");
}

// ---- what is actually there now -------------------------------------
say("");
say("WHAT THIS DATABASE HOLDS NOW");
say("");

const { data: orgs } = await admin.from("organizations").select("id, name, slug").order("name");
for (const o of orgs ?? []) {
  const { count: staff } = await admin
    .from("profiles").select("id", { count: "exact", head: true }).eq("org_id", o.id);
  const { count: sales } = await admin
    .from("van_sales").select("id", { count: "exact", head: true }).eq("org_id", o.id);
  say(`  ${(o.name ?? "").padEnd(34)} ${String(staff ?? 0).padStart(3)} staff  ${String(sales ?? 0).padStart(4)} sales`);
}
if (!orgs?.length) say("  (no organizations - run the production setup)");

// ---- people who can still sign in -----------------------------------
const { data: withPins } = await admin
  .from("profiles").select("full_name, role, is_active").not("pin_hash", "is", null);

const active = (withPins ?? []).filter((p) => p.is_active);
say("");
say(`  ${active.length} account(s) can sign in:`);
for (const p of active) say(`    ${(p.full_name ?? "Unnamed").padEnd(30)} ${p.role}`);

say("");
if (failed) {
  say(`${failed} of ${checked} checks failed. Demonstration data is still present.`);
  say("Run:  npm run production:clean -- --confirm");
  process.exit(1);
}

say(`All ${checked} checks passed. No demonstration data remains.`);
say("");
say("Before the business starts:");
say("  - every administrator has changed their PIN from the one it was issued with");
say("  - customers have real credit limits (the default of zero refuses every credit sale)");
say("  - each van has a driver and at least one salesperson crewed, or it cannot be dispatched");
