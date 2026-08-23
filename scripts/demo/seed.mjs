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

/** Dates for the demo, relative to the day it is run. */
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const daysAhead = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const hoursAgo = (n) => new Date(Date.now() - n * 3_600_000).toISOString();


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

// Enough breadth to exercise the catalogue, and deliberate variety in
// stock so low-stock and out-of-stock states are visible without anyone
// having to arrange them.
//        sku,  name,                          category,        unit,    cost, list, reorder, opening
const PRODUCTS = [
  ["SKU-101", "Demo Sparkling Water 500ml",  "Demo Beverages",  "case",   42,   58,  40, 240],
  ["SKU-102", "Demo Cola 330ml",             "Demo Beverages",  "case",   55,   74,  40, 180],
  ["SKU-103", "Demo Orange Juice 1L",        "Demo Beverages",  "carton", 62,   85,  30,  25],
  ["SKU-104", "Demo Malt Drink 330ml",       "Demo Beverages",  "case",   58,   79,  40,   0],
  ["SKU-201", "Demo Bar Soap 150g",          "Demo Toiletries", "carton", 96,  130,  50, 320],
  ["SKU-202", "Demo Shower Gel 400ml",       "Demo Toiletries", "case",   88,  120,  30, 140],
  ["SKU-203", "Demo Toothpaste 100ml",       "Demo Toiletries", "box",    74,  102,  40,  35],
  ["SKU-204", "Demo Tissue Roll 10 pack",    "Demo Toiletries", "pack",   45,   64,  60,   0],
  ["SKU-301", "Demo Long Grain Rice 5kg",    "Demo Dry Goods",  "bag",    68,   89,  50, 200],
  ["SKU-302", "Demo Vegetable Oil 5L",       "Demo Dry Goods",  "piece",  95,  124,  30, 110],
  ["SKU-303", "Demo Tomato Paste 400g",      "Demo Dry Goods",  "carton", 52,   71,  40,  28],
  ["SKU-304", "Demo Sugar 2kg",              "Demo Dry Goods",  "bag",    38,   54,  50, 160],
];
const productIds = [];
const openingByProduct = new Map();
for (const [code, name, category, unit, cost, list, reorder, opening] of PRODUCTS) {
  const sku = `${DEMO_PREFIX}${code}`;
  const id = await ensure("products", { sku },
    { sku, name, category_id: categories[category], supplier_id: supplier,
      unit_of_measure: unit, units_per_case: 12, cost_price: cost, list_price: list,
      tax_rate: 15, reorder_point: reorder, reorder_qty: Math.max(reorder * 2, 40) }, "product");
  productIds.push(id);
  openingByProduct.set(id, opening);
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
//
// Checked per product rather than once for the whole organization: a
// later seed that adds products would otherwise leave them with no
// stock, because some other product already had an opening entry.
const { data: alreadyOpened } = await admin
  .from("stock_movements").select("product_id")
  .eq("org_id", org.id).eq("reference_type", "demo_opening");
const opened = new Set((alreadyOpened ?? []).map((m) => m.product_id));

let posted = 0;
for (const productId of productIds) {
  if (opened.has(productId)) continue;
  const opening = openingByProduct.get(productId) ?? 0;
  if (opening === 0) continue;   // Left out of stock on purpose.

  const { error } = await admin.from("stock_movements").insert({
    org_id: org.id, product_id: productId, warehouse_id: wh,
    type: "receipt", quantity: opening, reference_type: "demo_opening",
    reason: "Opening stock count",
  });
  if (error) throw new Error(`opening stock: ${error.message}`);
  posted++;
}

const { count: historyCount } = await admin
  .from("stock_movements").select("id", { count: "exact", head: false })
  .eq("org_id", org.id).eq("reference_type", "demo_history").limit(1);

if (!historyCount) {

  // A little history, so the movement ledger is not a single entry per
  // product. Quantities stay well inside what was received.
  const [first, second, third] = productIds;
  const history = [
    [first, "issue", 40, "Sold to trade counter"],
    [second, "adjustment_out", 12, "Stock count correction"],
    [third, "damage", 3, "Damaged in handling"],
    [first, "adjustment_in", 15, "Recount after delivery"],
  ];
  for (const [productId, type, quantity, reason] of history) {
    if (!productId) continue;
    const { error } = await admin.from("stock_movements").insert({
      org_id: org.id, product_id: productId, warehouse_id: wh,
      type, quantity, reference_type: "demo_history", reason,
    });
    if (error) throw new Error(`demo movement: ${error.message}`);
  }

  say(`posted ${history.length} later movements through the ledger`);
}
if (posted) say(`posted opening stock for ${posted} product(s)`);

// Demo people. Each signs in the ordinary way.
// Demo people, each with a real PIN they sign in with.
// 3072 stays the driver, as it always was. 5120 is new: since a driver
// is no longer the salesperson, the demo needs both people to show the
// round at all - the driver cannot sell and the salesperson cannot
// dispatch.
const USERS = [
  ["demo-admin@demo.invalid", "admin", "Demo Super Administrator", "1024"],
  ["demo-manager@demo.invalid", "manager", "Adwoa Demo", "2048"],
  ["demo-driver@demo.invalid", "driver", "Kojo Demo", "3072"],
  ["demo-accounts@demo.invalid", "accountant", "Efua Demo", "4096"],
  ["demo-sales@demo.invalid", "salesperson", "Yaw Demo", "5120"],
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

// The van needs a crew: one to drive it and one to sell from it. It
// cannot be dispatched without both.
const crew = [
  ["demo-driver@demo.invalid", "driver"],
  ["demo-sales@demo.invalid", "salesperson"],
];

for (const [email, crewRole] of crew) {
  const { data: member } = await admin
    .from("profiles").select("id").eq("email", email).maybeSingle();
  if (!member) continue;

  const { data: existing } = await admin
    .from("van_assignments").select("id").eq("member_id", member.id)
    .is("unassigned_at", null).maybeSingle();
  if (existing) continue;

  const { error } = await admin.from("van_assignments").insert({
    org_id: org.id, van_id: van, member_id: member.id, crew_role: crewRole,
  });
  if (error) {
    say(`could not crew ${crewRole} (${error.message}) - apply UPGRADE_0032 and 0033`);
  } else {
    say(`crewed the demo ${crewRole} onto the demo van`);
  }
}

// Whoever sells in this demo. Sales are attributed to them, not to the
// person driving.
const { data: salesperson } = await admin
  .from("profiles").select("id").eq("email", "demo-sales@demo.invalid").maybeSingle();
const salespersonId = salesperson?.id ?? null;

// ===================================================================
// A complete distribution cycle, so every screen has something real on
// it: goods bought in, loaded onto the van, sold, brought back, and
// settled.
//
// Each stage is created through the same functions the application
// calls, not by writing the resulting quantities. That is the point of
// the demo: if the workflow were broken, seeding would fail rather than
// producing a tidy set of numbers nothing actually earned.
// ===================================================================

const driverId = (await admin
  .from("profiles").select("id").eq("email", "demo-driver@demo.invalid").maybeSingle()).data?.id;

const { data: existingCycle } = await admin
  .from("van_loads").select("id").eq("org_id", org.id).limit(1).maybeSingle();

if (existingCycle) {
  say("distribution cycle already present");
} else if (!driverId) {
  say("skipped the distribution cycle: no demo driver");
} else {
  const products = (await admin
    .from("products").select("id, sku, name, cost_price, list_price")
    .eq("org_id", org.id).like("sku", `${DEMO_PREFIX}%`).order("sku")).data ?? [];
  const bySku = new Map(products.map((p) => [p.sku.replace(DEMO_PREFIX, ""), p]));
  const customerRows = (await admin
    .from("customers").select("id, name").eq("org_id", org.id).like("code", `${DEMO_PREFIX}%`)
    .order("code")).data ?? [];

  // ---- Inbound: a purchase order, part received -------------------
  const po = (await admin.from("purchase_orders").insert({
    org_id: org.id, supplier_id: supplier, warehouse_id: wh, status: "submitted",
    order_date: daysAgo(9), expected_date: daysAgo(2),
    notes: "Weekly replenishment",
  }).select("id").single()).data;

  const poLines = [["SKU-103", 120], ["SKU-203", 80], ["SKU-303", 100]];
  for (const [code, quantity] of poLines) {
    const product = bySku.get(code);
    if (!product) continue;
    const { error } = await admin.from("purchase_order_items").insert({
      org_id: org.id, po_id: po.id, product_id: product.id,
      quantity, unit_cost: product.cost_price, tax_rate: 15,
    });
    if (error) throw new Error(`purchase line: ${error.message}`);
  }

  // Receive one line in full so the order sits part-received, which is
  // the state a warehouse actually spends most of its time looking at.
  const firstLine = (await admin
    .from("purchase_order_items").select("id, quantity").eq("po_id", po.id).limit(1).maybeSingle()).data;
  if (firstLine) {
    const { error } = await admin.rpc("receive_purchase_line", {
      p_item_id: firstLine.id, p_quantity: firstLine.quantity,
    });
    if (error) throw new Error(`receiving goods: ${error.message}`);
  }
  say("raised a purchase order and received part of it");

  // ---- Outbound: a van load, dispatched ---------------------------
  const load = (await admin.from("van_loads").insert({
    org_id: org.id, van_id: van, driver_id: driverId, warehouse_id: wh,
    status: "draft", load_date: daysAgo(1), opening_float: 200,
    notes: "Accra central round",
  }).select("id, load_number").single()).data;

  const loadLines = [["SKU-101", 60], ["SKU-102", 48], ["SKU-201", 40], ["SKU-301", 30]];
  for (const [code, qty] of loadLines) {
    const product = bySku.get(code);
    if (!product) continue;
    const { error } = await admin.from("van_load_items").insert({
      org_id: org.id, load_id: load.id, product_id: product.id,
      qty_loaded: qty, unit_price: product.list_price, unit_cost: product.cost_price,
    });
    if (error) throw new Error(`load line: ${error.message}`);
  }

  // A load is built as a draft and marked loaded once the lines are on
  // it. The driver then confirms what is physically on the van, and the
  // database refuses to dispatch until they have: a load nobody signed
  // for is exactly the thing reconciliation cannot settle later.
  await admin.from("van_loads").update({
    status: "loaded", driver_confirmed_at: hoursAgo(26),
  }).eq("id", load.id);

  // Dispatching is what moves the stock off the warehouse and onto the
  // van. Doing it by hand would put the quantities somewhere the ledger
  // never agreed to.
  const dispatched = await admin.rpc("dispatch_van_load", { p_load_id: load.id });
  if (dispatched.error) throw new Error(`dispatching the load: ${dispatched.error.message}`);
  say(`dispatched ${load.load_number} to the demo van`);

  // The document that travels with the goods. Skipped rather than fatal
  // when the database has not had upgrade 0026 yet: the rest of the
  // demo is still worth seeding.
  const waybill = await admin.rpc("issue_waybill_for_load", { p_load_id: load.id });
  if (waybill.error) {
    say(`no waybill issued (${waybill.error.message}) - apply UPGRADE_0026 for waybills`);
  } else {
    say(`issued a waybill for ${load.load_number}`);
  }

  // ---- Selling from the van ---------------------------------------
  const sales = [
    { customer: 0, type: "cash",   lines: [["SKU-101", 12], ["SKU-201", 6]] },
    { customer: 1, type: "credit", lines: [["SKU-102", 10], ["SKU-301", 5]] },
    { customer: 0, type: "cash",   lines: [["SKU-101", 8]] },
    // Already past its terms. A credit screen where everything is
    // current shows nothing about how ageing actually works, and this
    // is the case the business most needs to see.
    { customer: 2, type: "credit", lines: [["SKU-201", 9], ["SKU-102", 6]], overdueBy: 45 },
  ];

  let soldCount = 0;
  for (const [index, spec] of sales.entries()) {
    const customer = customerRows[spec.customer % Math.max(1, customerRows.length)];
    if (!customer) continue;

    const sale = (await admin.from("van_sales").insert({
      org_id: org.id, load_id: load.id, van_id: van, driver_id: driverId,
      salesperson_id: salespersonId ?? driverId,
      customer_id: customer.id, sale_type: spec.type, status: "draft",
      sold_at: hoursAgo(20 - index * 3),
      due_date: spec.type === "credit"
        ? (spec.overdueBy ? daysAgo(spec.overdueBy) : daysAhead(14))
        : null,
    }).select("id").single()).data;

    for (const [code, quantity] of spec.lines) {
      const product = bySku.get(code);
      if (!product) continue;
      const { error } = await admin.from("van_sale_items").insert({
        org_id: org.id, sale_id: sale.id, product_id: product.id,
        quantity, unit_price: product.list_price, tax_rate: 15,
      });
      if (error) throw new Error(`sale line: ${error.message}`);
    }

    // Completing the sale is what takes the stock off the van and puts
    // a credit sale on the customer's ledger.
    const { error } = await admin.rpc("complete_van_sale", { p_sale_id: sale.id });
    if (error) throw new Error(`completing a sale: ${error.message}`);
    soldCount++;
  }
  say(`recorded ${soldCount} van sales, cash and credit`);

  // ---- A collection against one of the credit sales ----------------
  const owing = (await admin
    .from("customer_credit_position").select("customer_id, ledger_balance")
    .eq("org_id", org.id).gt("ledger_balance", 0).limit(1).maybeSingle()).data;
  if (owing) {
    const part = Math.max(1, Math.round(Number(owing.ledger_balance) * 0.4 * 100) / 100);
    const { error } = await admin.rpc("record_credit_payment", {
      p_customer_id: owing.customer_id, p_amount: part,
      p_method: "mobile_money", p_notes: "Part payment on account",
    });
    if (error) throw new Error(`recording a collection: ${error.message}`);
    say("recorded a collection against a credit sale");
  }

  // ---- The van comes back -----------------------------------------
  const onVan = (await admin
    .from("van_inventory").select("product_id, qty_on_hand")
    .eq("org_id", org.id).eq("van_id", van).gt("qty_on_hand", 0)).data ?? [];

  if (onVan.length) {
    const ret = (await admin.from("van_returns").insert({
      org_id: org.id, return_number: undefined, load_id: load.id, van_id: van,
      driver_id: driverId, warehouse_id: wh, status: "draft",
      returned_at: hoursAgo(2), notes: "End of round",
    }).select("id, return_number").single()).data;

    for (const [index, row] of onVan.entries()) {
      // One line comes back a little short and one damaged, so the
      // reconciliation has something real to explain.
      const expected = Number(row.qty_on_hand);
      const damaged = index === 0 ? Math.min(2, expected) : 0;
      const short = index === 1 ? Math.min(1, expected - damaged) : 0;
      const good = expected - damaged - short;
      const { error } = await admin.from("van_return_items").insert({
        org_id: org.id, return_id: ret.id, product_id: row.product_id,
        qty_expected: expected, qty_returned_good: good, qty_damaged: damaged,
        damage_reason: damaged ? "Crushed in transit" : null,
      });
      if (error) throw new Error(`return line: ${error.message}`);
    }

    await admin.from("van_returns").update({ status: "submitted" }).eq("id", ret.id);
    const approved = await admin.rpc("approve_van_return", { p_return_id: ret.id });
    if (approved.error) throw new Error(`approving the return: ${approved.error.message}`);
    say(`approved ${ret.return_number}, good stock back to the warehouse`);
  }

  // ---- End of day --------------------------------------------------
  const recon = await admin.rpc("build_reconciliation", { p_load_id: load.id });
  if (recon.error) throw new Error(`building the reconciliation: ${recon.error.message}`);

  const reconRow = Array.isArray(recon.data) ? recon.data[0] : recon.data;
  if (reconRow?.id) {
    // The driver hands over slightly less than expected. A demo where
    // everything balances perfectly shows none of the controls working.
    const expected = Number(reconRow.expected_cash ?? 0);
    await admin.from("van_reconciliations").update({
      status: "submitted",
      actual_cash: Math.max(0, Math.round((expected - 15) * 100) / 100),
      explanation: "Short by the cost of a replacement crate lid.",
      submitted_by: driverId,
      submitted_at: hoursAgo(1),
    }).eq("id", reconRow.id);
    say("submitted the end of day reconciliation, left awaiting approval");
  }

  // ---- A transfer between the two depots, waiting on a manager ------
  //
  // Left at draft on purpose. The approval step is the point of the
  // feature, and a demo where everything is already approved shows none
  // of it.
  const depots = (await admin
    .from("warehouses").select("id, name").eq("org_id", org.id).limit(2)).data ?? [];

  if (depots.length === 2) {
    const transfer = await admin.from("stock_transfers").insert({
      org_id: org.id,
      from_warehouse_id: depots[0].id,
      to_warehouse_id: depots[1].id,
      notes: "Topping up the second depot before the weekend.",
    }).select("id, transfer_number").maybeSingle();

    if (transfer.error) {
      say(`no transfer raised (${transfer.error.message}) - apply UPGRADE_0027 for transfers`);
    } else if (transfer.data) {
      const movable = (await admin
        .from("inventory")
        .select("product_id, qty_available")
        .eq("warehouse_id", depots[0].id)
        .gt("qty_available", 20)
        .limit(2)).data ?? [];

      for (const line of movable) {
        await admin.from("stock_transfer_items").insert({
          org_id: org.id,
          transfer_id: transfer.data.id,
          product_id: line.product_id,
          quantity: 10,
        });
      }
      say(`raised ${transfer.data.transfer_number}, waiting on a manager to approve it`);
    }
  }

  // ---- A customer bringing something back ---------------------------
  const returningCustomer = customerRows[0];
  const homeDepot = depots[0];
  const returnable = homeDepot
    ? (await admin
        .from("inventory").select("product_id")
        .eq("warehouse_id", homeDepot.id).limit(1)).data ?? []
    : [];

  if (returningCustomer && homeDepot && returnable.length) {
    const returned = await admin.rpc("record_stock_return", {
      p_warehouse_id: homeDepot.id,
      p_reason: "wrong_item",
      p_lines: [{ product_id: returnable[0].product_id, quantity: 3 }],
      p_customer_id: returningCustomer.id,
      p_supplier_id: null,
      p_notes: "Ordered the 500ml, delivered the 300ml.",
    });
    if (returned.error) {
      say(`no customer return (${returned.error.message}) - apply UPGRADE_0031`);
    } else {
      say("recorded a customer return, stock back on the warehouse");
    }
  }

  // ---- A supplier invoice waiting to be checked ---------------------
  //
  // Written directly rather than through the portal function: seeding
  // has no link to redeem, and the point is that the review queue has
  // something in it when the demo opens.
  const supplierRow = (await admin
    .from("suppliers").select("id, name").eq("org_id", org.id).limit(1).maybeSingle()).data;

  if (supplierRow) {
    const submitted = await admin.from("supplier_documents").insert({
      org_id: org.id,
      supplier_id: supplierRow.id,
      kind: "invoice",
      title: "Invoice GT-20841",
      reference: "GT-20841",
      document_date: daysAgo(2),
      amount: 8450,
      storage_path: `${org.id}/${supplierRow.id}/demo-invoice`,
      file_name: "invoice-GT-20841.pdf",
      mime_type: "application/pdf",
      size_bytes: 148_000,
      status: "received",
      submitted_company: `${supplierRow.name} Limited`,
      submitted_by_name: "Ama Boateng",
      submitted_at: hoursAgo(6),
    });

    if (submitted.error) {
      say(`no supplier invoice (${submitted.error.message}) - apply UPGRADE_0031`);
    } else {
      say("a supplier invoice is waiting in the review queue");
    }
  }
}

// ===================================================================
// Batches and expiry.
//
// Some lines expire and some do not, which is the point: a crate of
// bottles has no shelf life and should not be made to carry a date.
// Three states are seeded so all of them can be shown - stock well
// inside date, stock inside the warning period, and stock that has
// gone off and is blocking dispatch until it is written off.
// ===================================================================
const { data: existingBatches, error: batchProbe } = await admin
  .from("product_batches").select("id").eq("org_id", org.id).limit(1).maybeSingle();

if (batchProbe) {
  // The table is not there. Said plainly rather than skipped in
  // silence, because a demonstration missing its expiry examples looks
  // like the feature is broken.
  say("skipped batches: migration 0024 is not on this database");
  say("  run database/UPGRADE_0024_BATCHES_AND_EXPIRY.sql, then seed again");
} else if (existingBatches) {
  say("batches already present");
} else {
  // Which of the demo lines actually perish.
  const PERISHABLE = [
    ["SKU-101", 120],   // sparkling water
    ["SKU-102", 90],    // cola
    ["SKU-103", 60],    // orange juice
    ["SKU-104", 120],   // malt
  ];
  for (const [code, shelfLife] of PERISHABLE) {
    await admin.from("products")
      .update({ track_batches: true, track_expiry: true, shelf_life_days: shelfLife })
      .eq("org_id", org.id).eq("sku", `${DEMO_PREFIX}${code}`);
  }
  // Toiletries get batch numbers but no expiry: a recall needs the
  // batch, the soap does not go off.
  for (const code of ["SKU-201", "SKU-202"]) {
    await admin.from("products")
      .update({ track_batches: true, track_expiry: false })
      .eq("org_id", org.id).eq("sku", `${DEMO_PREFIX}${code}`);
  }

  const { data: perishables } = await admin
    .from("products").select("id, sku, name")
    .eq("org_id", org.id).eq("track_expiry", true);
  const bySku = new Map((perishables ?? []).map((p) => [p.sku.replace(DEMO_PREFIX, ""), p]));

  // Written directly rather than through receiving: the goods are
  // already in the warehouse from the opening stock above, and putting
  // them through a purchase order again would double the quantity.
  // The dates are what matters here.
  const BATCHES = [
    ["SKU-101", "B-2026-0411", 120, daysAhead(95)],   // comfortable
    ["SKU-102", "B-2026-0288", 80,  daysAhead(12)],   // inside the warning period
    ["SKU-103", "B-2026-0117", 25,  daysAgo(3)],      // gone off
  ];
  let written = 0;
  for (const [code, batchNumber, qty, date] of BATCHES) {
    const product = bySku.get(code);
    if (!product) continue;
    const { error } = await admin.from("product_batches").insert({
      org_id: org.id, product_id: product.id, warehouse_id: wh,
      batch_number: batchNumber,
      expires_on: date,
      qty_received: qty, qty_remaining: qty,
      supplier_id: supplier,
      notes: "Opening batch record",
    });
    if (error) throw new Error(`batch ${batchNumber}: ${error.message}`);
    written++;
  }
  say(`recorded ${written} batches: one comfortable, one expiring, one already expired`);
}

// ===================================================================
// Today's round, left open on purpose.
//
// The cycle above is finished history - it gives the driver a day of
// sales, a return and a reconciliation to look back on. But a finished
// round means signing in as the driver shows an empty van and a Sell
// button that does nothing, which is no use for a demonstration and no
// use to a real driver on their first morning.
//
// So the van is loaded again and dispatched, and left that way.
// ===================================================================
// Scoped to the demo van, not to the organization: a load left open on
// some other van - by a test, or by a real round in a shared project -
// is not a reason to leave the demo driver with nothing to sell.
const { data: openLoad } = await admin
  .from("van_loads").select("id, load_number")
  .eq("org_id", org.id).eq("van_id", van)
  .in("status", ["loaded", "dispatched"]).maybeSingle();

if (openLoad) {
  say(`van already out on ${openLoad.load_number}`);
} else if (!driverId) {
  say("skipped today's round: no demo driver");
} else {
  const products = (await admin
    .from("products").select("id, sku, list_price, cost_price")
    .eq("org_id", org.id).like("sku", `${DEMO_PREFIX}%`).order("sku")).data ?? [];
  const bySku = new Map(products.map((p) => [p.sku.replace(DEMO_PREFIX, ""), p]));

  const load = (await admin.from("van_loads").insert({
    org_id: org.id, van_id: van, driver_id: driverId, warehouse_id: wh,
    status: "draft", load_date: new Date().toISOString().slice(0, 10),
    opening_float: 300, notes: "Today's round",
  }).select("id, load_number").single()).data;

  // A spread a driver would actually take out: fast movers in depth,
  // slower lines in smaller numbers.
  const todayLines = [
    ["SKU-101", 40], ["SKU-102", 30], ["SKU-201", 25],
    ["SKU-202", 20], ["SKU-301", 18], ["SKU-302", 12],
  ];
  let loaded = 0;
  for (const [code, qty] of todayLines) {
    const product = bySku.get(code);
    if (!product) continue;

    // Only what the warehouse can actually spare, so the seed cannot
    // ask dispatch for stock that is not there.
    const { data: level } = await admin
      .from("inventory").select("qty_on_hand, qty_reserved")
      .eq("product_id", product.id).eq("warehouse_id", wh).maybeSingle();
    const available = Number(level?.qty_on_hand ?? 0) - Number(level?.qty_reserved ?? 0);
    const take = Math.min(qty, Math.max(0, available));
    if (take === 0) continue;

    const { error } = await admin.from("van_load_items").insert({
      org_id: org.id, load_id: load.id, product_id: product.id,
      qty_loaded: take, unit_price: product.list_price, unit_cost: product.cost_price,
    });
    if (error) throw new Error(`today's load line: ${error.message}`);
    loaded++;
  }

  if (loaded === 0) {
    await admin.from("van_loads").delete().eq("id", load.id);
    say("skipped today's round: the warehouse has nothing to spare");
  } else {
    await admin.from("van_loads").update({
      status: "loaded", driver_confirmed_at: hoursAgo(2),
    }).eq("id", load.id);

    const { error } = await admin.rpc("dispatch_van_load", { p_load_id: load.id });
    if (error) throw new Error(`dispatching today's round: ${error.message}`);

    say(`dispatched ${load.load_number} with ${loaded} product lines - the driver can sell straight away`);
  }
}

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
