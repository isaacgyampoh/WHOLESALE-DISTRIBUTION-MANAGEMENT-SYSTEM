/**
 * Creates a self-contained demonstration organization.
 *
 * Everything is fictional and lives in its own organization, so demo
 * records cannot mix with real ones: row level security keeps the two
 * apart exactly as it keeps any two customers apart.
 *
 * Idempotent. Running it twice changes nothing.
 *
 * The demo users sign in through the ordinary PIN flow. Their PINs are
 * written as digests exactly as the application would write them, so
 * 1024 is a real stored credential and not a bypass. Changing the Super
 * Administrator's PIN stops 1024 working, as it should.
 */
import { adminClient, findDemoOrg, digestPin, DEMO_ORG_NAME, DEMO_ORG_SLUG, DEMO_PREFIX } from "./lib.mjs";

const admin = adminClient();

const say = (m) => console.log(`  ${m}`);

let org = await findDemoOrg(admin);
if (!org) {
  const { data, error } = await admin
    .from("organizations")
    .insert({ name: DEMO_ORG_NAME, slug: DEMO_ORG_SLUG, country: "GH", currency: "GHS" })
    .select("id, name")
    .single();
  if (error) throw new Error(`could not create the demo organization: ${error.message}`);
  org = data;
  say(`created organization ${DEMO_ORG_NAME}`);
} else {
  say(`organization already present`);
}

/** Insert only when the business key is absent, so re-runs are silent. */
async function ensure(table, match, row, label) {
  const query = admin.from(table).select("id").eq("org_id", org.id);
  for (const [k, v] of Object.entries(match)) query.eq(k, v);
  const { data: existing } = await query.maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await admin
    .from(table).insert({ ...row, org_id: org.id }).select("id").single();
  if (error) throw new Error(`${label}: ${error.message}`);
  return data.id;
}

const wh = await ensure("warehouses", { code: `${DEMO_PREFIX}WH1` },
  { code: `${DEMO_PREFIX}WH1`, name: "Demo Depot, Accra", city: "Accra", is_default: false }, "warehouse");

const categories = {};
for (const name of ["Demo Beverages", "Demo Toiletries", "Demo Dry Goods"]) {
  categories[name] = await ensure("categories", { name }, { name }, "category");
}

const supplier = await ensure("suppliers", { code: `${DEMO_PREFIX}SUP1` },
  { code: `${DEMO_PREFIX}SUP1`, name: "Demo Supplies Ltd", contact_name: "Kwesi Demo",
    phone: "+233200000001", payment_terms_days: 30 }, "supplier");

const PRODUCTS = [
  [`${DEMO_PREFIX}SKU-101`, "Demo Sparkling Water 500ml", "Demo Beverages", 42, 58],
  [`${DEMO_PREFIX}SKU-102`, "Demo Cola 330ml", "Demo Beverages", 55, 74],
  [`${DEMO_PREFIX}SKU-201`, "Demo Bar Soap 150g", "Demo Toiletries", 96, 130],
  [`${DEMO_PREFIX}SKU-202`, "Demo Shower Gel 400ml", "Demo Toiletries", 88, 120],
  [`${DEMO_PREFIX}SKU-301`, "Demo Long Grain Rice 5kg", "Demo Dry Goods", 68, 89],
];
const productIds = [];
for (const [sku, name, category, cost, list] of PRODUCTS) {
  productIds.push(await ensure("products", { sku },
    { sku, name, category_id: categories[category], supplier_id: supplier,
      unit_of_measure: "case", units_per_case: 12, cost_price: cost, list_price: list,
      tax_rate: 15, reorder_point: 40, reorder_qty: 80 }, "product"));
}

const CUSTOMERS = [
  [`${DEMO_PREFIX}CUS1`, "Demo Madina Mart", "Accra", 50000, 30],
  [`${DEMO_PREFIX}CUS2`, "Demo Suame Provisions", "Kumasi", 25000, 14],
  [`${DEMO_PREFIX}CUS3`, "Demo Tema Cash & Carry", "Tema", 120000, 45],
];
for (const [code, name, city, limit, terms] of CUSTOMERS) {
  await ensure("customers", { code },
    { code, name, city, credit_limit: limit, payment_terms_days: terms,
      contact_name: "Demo Contact", phone: "+233200000002" }, "customer");
}

const van = await ensure("vans", { code: `${DEMO_PREFIX}VAN1` },
  { code: `${DEMO_PREFIX}VAN1`, registration_no: `${DEMO_PREFIX}GT-0001`,
    home_warehouse_id: wh }, "van");

// Opening stock through the ledger, never by setting a quantity.
const { count: movements } = await admin
  .from("stock_movements").select("id", { count: "exact", head: false })
  .eq("org_id", org.id).eq("reference_type", "demo_opening").limit(1);
if (!movements) {
  for (const productId of productIds) {
    const { error } = await admin.from("stock_movements").insert({
      org_id: org.id, product_id: productId, warehouse_id: wh,
      type: "receipt", quantity: 200, reference_type: "demo_opening",
      reason: "Demo opening stock",
    });
    if (error) throw new Error(`opening stock: ${error.message}`);
  }
  say("posted opening stock through the ledger");
}

// Demo people. Each signs in the ordinary way.
// Demo people, each with a real PIN they sign in with.
const USERS = [
  ["demo-admin@demo.invalid", "admin", "Demo Super Administrator", "1024"],
  ["demo-manager@demo.invalid", "manager", "Adwoa Demo", "2048"],
  ["demo-driver@demo.invalid", "driver", "Kojo Demo", "3072"],
  ["demo-accounts@demo.invalid", "accountant", "Efua Demo", "4096"],
  // The salesperson who rides with the van. The driver keeps the stock;
  // this is the person who sells it, so a demo without them cannot show
  // a sale at all.
  ["demo-seller@demo.invalid", "sales_rep", "Nana Demo", "5120"],
];
const issued = [];
for (const [email, role, fullName, pin] of USERS) {
  const { data: existing } = await admin
    .from("profiles").select("id, pin_set_at").eq("email", email).maybeSingle();

  let profileId = existing?.id;
  if (!profileId) {
    const { data: created, error } = await admin.auth.admin.createUser({
      email, email_confirm: true,
      user_metadata: { full_name: fullName, role, org_id: org.id },
    });
    if (error) throw new Error(`user ${email}: ${error.message}`);
    profileId = created.user.id;
    say(`created ${fullName} (${role})`);
  }

  // Only set the PIN if this account has none, so a demo administrator
  // who has changed theirs does not get it reset on the next seed.
  if (!existing?.pin_set_at) {
    const { error } = await admin
      .from("profiles").update({ pin_hash: digestPin(pin) }).eq("id", profileId);
    if (error) throw new Error(`pin for ${email}: ${error.message}`);
    issued.push([fullName, role, pin]);
  }
}

// Crew the demo van: a driver to keep it and a salesperson to sell from
// it. Both are rows in van_assignments, distinguished by crew_role.
async function crew(email, crewRole, label) {
  const { data: person } = await admin
    .from("profiles").select("id").eq("email", email).maybeSingle();
  if (!person) return;

  const { data: assignment } = await admin
    .from("van_assignments").select("id").eq("member_id", person.id)
    .is("unassigned_at", null).maybeSingle();
  if (assignment) return;

  const { error } = await admin.from("van_assignments").insert({
    org_id: org.id, van_id: van, member_id: person.id, crew_role: crewRole,
  });
  if (error) throw new Error(`crew ${email}: ${error.message}`);
  say(`assigned the demo ${label} to the demo van`);
}

await crew("demo-driver@demo.invalid", "driver", "driver");
await crew("demo-seller@demo.invalid", "salesperson", "salesperson");

console.log(`\nDemo data ready in ${DEMO_ORG_NAME}.`);
if (issued.length) {
  console.log("\n  Sign in with these PINs:\n");
  for (const [name, role, pin] of issued) {
    console.log(`    ${pin}   ${name} (${role})`);
  }
  console.log("\n  These are real stored credentials, not a bypass. Change the");
  console.log("  Super Administrator's PIN under Your account and 1024 stops working.");
} else {
  console.log("  All demo accounts already have a PIN; none were changed.");
}
