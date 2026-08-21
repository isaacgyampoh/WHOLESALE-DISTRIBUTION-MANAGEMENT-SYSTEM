/**
 * Schema presence probing.
 *
 * A HEAD request (supabase-js `head: true`) is NOT evidence of existence:
 * PostgREST answers it with a bodiless 204 even for a relation that does
 * not exist, so supabase-js reports error=null and the caller concludes
 * the table is present. That produced a false "13/13 tables exposed"
 * against a project whose public schema was empty.
 *
 * Presence is therefore established only by a body-returning request,
 * where PGRST205 / HTTP 404 is returned for an unknown relation.
 */

/** Every base table migrations 0001-0015 create. */
export const EXPECTED_TABLES = [
  "categories", "credit_transactions", "customers", "inventory", "invoices",
  "manager_category_scopes", "organizations", "payments", "products", "profiles",
  "purchase_order_items", "purchase_orders", "sales_order_items", "sales_orders",
  "stock_movements", "stock_transfer_items", "stock_transfers", "suppliers",
  "van_assignments", "van_inventory", "van_load_items", "van_loads",
  "van_reconciliations", "van_return_items", "van_returns", "van_sale_items",
  "van_sales", "vans", "warehouses",
];

export const EXPECTED_VIEWS = [
  "customer_balances", "customer_credit_position", "customer_statement",
  "invoice_ageing", "reconciliation_variances", "stock_summary",
  "van_load_summary", "van_stock_summary",
];

/** Functions callable over RPC that take no arguments and only read. */
export const READONLY_PROBE_FUNCTIONS = [
  "auth_role", "auth_org_id", "is_trusted_context", "my_van_id", "is_staff",
];

/** Every function the migrations define, for the completeness report. */
export const EXPECTED_FUNCTIONS = [
  "apply_stock_movement", "approve_reconciliation", "approve_van_return",
  "assert_same_org", "auth_org_id", "auth_role", "block_movement_mutation",
  "build_reconciliation", "can_access_category", "can_access_product",
  "complete_van_sale", "dispatch_van_load", "fill_org_from_parent",
  "guard_org_change", "guard_role_change", "handle_new_user",
  "handle_order_status_change", "has_role", "is_staff", "is_trusted_context",
  "mark_overdue_invoices", "movement_direction", "my_van_id",
  "next_document_number", "recalc_invoice_payment", "recalc_order_totals",
  "recalc_po_totals", "recalc_van_sale_totals", "receive_purchase_line",
  "record_credit_payment", "require_role", "set_updated_at", "stamp_created_by",
];

/** PostgREST codes meaning "this relation is not in the schema cache". */
const NOT_FOUND = new Set(["PGRST205", "PGRST200", "42P01"]);

/**
 * Does this relation exist and is it reachable?
 *
 * Uses a body-returning select. An empty result with no error means the
 * relation exists and simply has no rows (or none visible), which is
 * still existence.
 */
export async function relationExists(client, name) {
  const { error } = await client.from(name).select("*").limit(1);
  if (!error) return { exists: true };
  if (NOT_FOUND.has(error.code) || /Could not find the table|does not exist/i.test(error.message)) {
    return { exists: false, reason: error.message };
  }
  // A different error (a permission failure, for instance) means the
  // relation is there but not usable by this role. Report it distinctly
  // rather than folding it into "missing".
  return { exists: true, degraded: true, reason: `${error.code}: ${error.message}` };
}

export async function functionExists(client, name, args = {}) {
  const { error } = await client.rpc(name, args);
  if (!error) return { exists: true };
  if (/Could not find the function/i.test(error.message)) {
    return { exists: false, reason: error.message };
  }
  // The function ran and raised its own error, which proves it exists.
  return { exists: true, raised: error.message };
}

/**
 * Guards the probe itself.
 *
 * Asks for relations that cannot exist. If any is reported present, the
 * probe is unsound and the caller must stop rather than report a green
 * schema. This is the regression test for the HEAD/204 false positive.
 */
export async function selfTest(client) {
  const impossible = [
    `__wdms_absent_${Date.now().toString(36)}`,
    "__wdms_definitely_not_a_table",
    "organizations_this_does_not_exist",
  ];

  const results = [];
  for (const name of impossible) {
    const r = await relationExists(client, name);
    results.push({ name, reportedPresent: r.exists === true });
  }

  const fn = await functionExists(client, `__wdms_absent_fn_${Date.now().toString(36)}`);

  const leaks = results.filter((r) => r.reportedPresent);
  return {
    sound: leaks.length === 0 && fn.exists === false,
    leaks,
    functionProbeSound: fn.exists === false,
  };
}
