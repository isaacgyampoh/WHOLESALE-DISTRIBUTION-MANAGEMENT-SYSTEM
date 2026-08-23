/**
 * Removing the demonstration data before the business starts using this
 * system for real.
 *
 * Two things make this different from `demo:clean`, which simply removes
 * the demo organization:
 *
 *   It shows you exactly what it is about to delete, and stops. Nothing
 *   is removed until you run it again with --confirm. A destructive
 *   script whose first run is destructive is one somebody eventually
 *   runs by accident.
 *
 *   It refuses outright if what it is about to delete does not look like
 *   demonstration data. The scope is found by the demo slug, never taken
 *   from an argument, and the checks below are there to catch the case
 *   where somebody has been entering real business into the demo
 *   organization by mistake - which is exactly the situation where a
 *   confident delete would be a disaster.
 *
 * What it never touches: the schema, the migrations, functions, row
 * level security, grants, storage configuration, or any organization
 * other than the demonstration one.
 *
 *   npm run production:clean            # show what would go
 *   npm run production:clean -- --confirm
 */
import {
  adminClient, findDemoOrg, DEMO_ORG_NAME, DEMO_ORG_SLUG,
} from "../demo/lib.mjs";

const confirmed = process.argv.includes("--confirm");
const admin = adminClient();

const say = (m = "") => console.log(m);
const money = (n) => `₵${Number(n ?? 0).toLocaleString("en-GH", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})}`;

// ------------------------------------------------------------------
// What is here
// ------------------------------------------------------------------
const org = await findDemoOrg(admin);

if (!org) {
  say(`Nothing to remove: no organization with the slug "${DEMO_ORG_SLUG}".`);
  say("The demonstration data is already gone, or was never seeded here.");
  process.exit(0);
}

say(`Demonstration organization: ${org.name}`);
say(`  slug ${DEMO_ORG_SLUG}`);
say("");

/** Count rows belonging to the demo organization. */
async function count(table, column = "org_id") {
  const { count: n, error } = await admin
    .from(table).select("id", { count: "exact", head: true }).eq(column, org.id);
  if (error) return null;
  return n ?? 0;
}

const COUNTED = [
  ["Staff", "profiles"],
  ["Customers", "customers"],
  ["Suppliers", "suppliers"],
  ["Products", "products"],
  ["Categories", "categories"],
  ["Warehouses", "warehouses"],
  ["Vans", "vans"],
  ["Van crew assignments", "van_assignments"],
  ["Van loads", "van_loads"],
  ["Sales", "van_sales"],
  ["Payments taken", "van_sale_payments"],
  ["Invoices", "invoices"],
  ["Receipts", "payments"],
  ["Credit ledger entries", "credit_transactions"],
  ["Returns", "van_returns"],
  ["Reconciliations", "van_reconciliations"],
  ["Purchase orders", "purchase_orders"],
  ["Stock movements", "stock_movements"],
  ["Product batches", "product_batches"],
  ["Warehouse transfers", "stock_transfers"],
  ["Waybills", "waybills"],
  ["Supplier documents", "supplier_documents"],
  ["Supplier portal links", "supplier_portal_tokens"],
  ["Notifications", "notifications"],
  ["Audit entries", "audit_log"],
];

say("WHAT WILL BE REMOVED");
say("");

let total = 0;
for (const [label, table] of COUNTED) {
  const n = await count(table);
  if (n === null) {
    say(`  ${label.padEnd(24)} (table not present on this database)`);
    continue;
  }
  total += n;
  say(`  ${label.padEnd(24)} ${n}`);
}

// The people, by name, because "5 staff" is not something you can check
// and "Kojo Demo" is.
const { data: people } = await admin
  .from("profiles").select("id, full_name, role, email").eq("org_id", org.id);

say("");
say("STAFF ACCOUNTS THAT WILL BE DELETED");
say("");
for (const p of people ?? []) {
  say(`  ${(p.full_name ?? "Unnamed").padEnd(28)} ${String(p.role).padEnd(16)} ${p.email ?? ""}`);
}
if (!people?.length) say("  (none)");

// ------------------------------------------------------------------
// Does this actually look like demonstration data?
// ------------------------------------------------------------------
//
// The scope is already the demo organization, so this cannot reach real
// data. These checks are for the other mistake: somebody has been
// entering the real business into the demo organization, and deleting it
// would destroy work rather than tidy up.
const warnings = [];

const { data: recent } = await admin
  .from("van_sales")
  .select("sold_at, total")
  .eq("org_id", org.id)
  .order("sold_at", { ascending: false })
  .limit(1);

if (recent?.length) {
  const days = Math.floor((Date.now() - new Date(recent[0].sold_at).getTime()) / 86_400_000);
  if (days <= 1) {
    warnings.push(
      `A sale was recorded here ${days === 0 ? "today" : "yesterday"} ` +
      `(${money(recent[0].total)}). If people are trading in the demonstration ` +
      `organization, this is not demonstration data any more.`);
  }
}

const nonDemoStaff = (people ?? []).filter(
  (p) => !String(p.email ?? "").endsWith("@demo.invalid"));
if (nonDemoStaff.length) {
  warnings.push(
    `${nonDemoStaff.length} account(s) here were not created by the demo seed: ` +
    nonDemoStaff.map((p) => p.full_name ?? p.email).join(", ") + ".");
}

const { count: otherOrgs } = await admin
  .from("organizations").select("id", { count: "exact", head: true }).neq("id", org.id);

say("");
if (warnings.length) {
  say("WORTH CHECKING BEFORE YOU DO THIS");
  say("");
  for (const w of warnings) say(`  - ${w}`);
  say("");
}

say(`Other organizations on this database: ${otherOrgs ?? 0} (none will be touched)`);
say("");

// ------------------------------------------------------------------
// Doing it
// ------------------------------------------------------------------
if (!confirmed) {
  say("Nothing has been deleted.");
  say("");
  say(`  ${total} record(s) and ${people?.length ?? 0} account(s) would go.`);
  say("");
  say("Run it again to go ahead:");
  say("");
  say("  npm run production:clean -- --confirm");
  process.exit(0);
}

if (warnings.length) {
  say("REFUSED.");
  say("");
  say("The checks above suggest this organization holds real work rather than");
  say("demonstration data. Move that work to its own organization first, or");
  say("remove the rows by hand if you are certain.");
  say("");
  say("Nothing has been deleted.");
  process.exit(1);
}

say("Removing.");
say("");

// Children before parents. The order matters: several of these
// references are ON DELETE RESTRICT on purpose, so that a tenant cannot
// be removed while its history still points at it.
const TABLES = [
  "notifications",
  "van_load_crew",
  "van_reconciliations", "van_return_items", "van_returns",
  "van_sale_payments", "van_sale_items", "van_sales",
  "credit_transactions",
  "van_load_items", "van_loads", "van_assignments", "van_inventory", "vans",
  "waybill_items", "waybills",
  "stock_return_items", "stock_returns",
  "stock_transfer_items", "stock_transfers",
  "payments", "invoices", "sales_order_items", "sales_orders",
  "supplier_documents", "supplier_portal_tokens",
  "purchase_order_items", "purchase_orders",
  "product_batches",
  "stock_movements", "inventory",
  "manager_category_scopes", "products", "categories",
  "customers", "suppliers", "warehouses",
  // Last: audit_log refuses every other caller, and its organization
  // reference is ON DELETE RESTRICT, so the tenant cannot go until its
  // history does. See migration 0021.
  "audit_log",
];

for (const table of TABLES) {
  const { error } = await admin.from(table).delete().eq("org_id", org.id);
  // A table that is not on this database yet is not a failure: the
  // schema may be behind the application.
  if (error && !/does not exist|schema cache/i.test(error.message)) {
    say(`  ${table}: ${error.message}`);
  }
}

for (const person of people ?? []) {
  await admin.from("auth_pin_attempts").delete().eq("profile_id", person.id);
}

for (const person of people ?? []) {
  const { error } = await admin.auth.admin.deleteUser(person.id);
  if (error) say(`  user ${person.full_name}: ${error.message}`);
}

const { error: orgError } = await admin.from("organizations").delete().eq("id", org.id);
if (orgError) {
  say("");
  say(`Could not remove the organization itself: ${orgError.message}`);
  say("Something inside it still holds a reference. Everything else is gone.");
  process.exit(1);
}

say("");
say(`Removed ${DEMO_ORG_NAME}: ${total} record(s), ${people?.length ?? 0} account(s).`);
say("No other organization was touched. The schema is unchanged.");
say("");
say("Now run:  npm run production:verify");
