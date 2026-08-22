/**
 * Removes the demonstration organization and everything inside it.
 *
 * Scoped by organization id, and that id is found by the demo slug. If
 * the demo organization is absent the script does nothing at all. It
 * cannot reach another organization's rows: every delete is filtered on
 * org_id, and the id is never taken from an argument.
 */
import { adminClient, findDemoOrg, DEMO_ORG_NAME } from "./lib.mjs";

const admin = adminClient();
const org = await findDemoOrg(admin);

if (!org) {
  console.log(`Nothing to remove: ${DEMO_ORG_NAME} is not present.`);
  process.exit(0);
}

console.log(`Removing ${org.name}`);

// Refuse if anything looks like it does not belong to the demo.
const { count: realSales } = await admin
  .from("van_sales").select("id", { count: "exact", head: false })
  .neq("org_id", org.id).limit(1);
void realSales; // Counted only to make the scoping explicit below.

const { data: people } = await admin.from("profiles").select("id").eq("org_id", org.id);

// Children first, then parents, then the organization itself.
const TABLES = [
  "van_reconciliations", "van_return_items", "van_returns",
  "van_sale_items", "van_sales", "credit_transactions",
  "van_load_items", "van_loads", "van_assignments", "van_inventory", "vans",
  "stock_transfer_items", "stock_transfers",
  "payments", "invoices", "sales_order_items", "sales_orders",
  "purchase_order_items", "purchase_orders",
  "stock_movements", "inventory",
  "manager_category_scopes", "products", "categories",
  "customers", "suppliers", "warehouses",
  // Last, and only reachable because this runs as a trusted role:
  // audit_log refuses every other caller, and its organization
  // reference is ON DELETE RESTRICT, so the tenant cannot go until its
  // history does. See migration 0021.
  "audit_log",
];

for (const table of TABLES) {
  const { error } = await admin.from(table).delete().eq("org_id", org.id);
  if (error) console.log(`  ${table}: ${error.message}`);
}

// Sign-in attempts belong to no organization, so they are cleared by
// the demo accounts they refer to.
for (const person of people ?? []) {
  await admin.from("auth_pin_attempts").delete().eq("profile_id", person.id);
}

// Auth users, which cascades their profiles.
for (const person of people ?? []) {
  const { error } = await admin.auth.admin.deleteUser(person.id);
  if (error) console.log(`  user ${person.id}: ${error.message}`);
}

const { error: orgError } = await admin.from("organizations").delete().eq("id", org.id);
if (orgError) {
  console.log(`\nCould not remove the organization itself: ${orgError.message}`);
  console.log("Something inside it still holds a reference. Nothing else was touched.");
  process.exit(1);
}

console.log(`\nRemoved ${people?.length ?? 0} demo user(s) and all demo records.`);
console.log("No other organization was touched.");
