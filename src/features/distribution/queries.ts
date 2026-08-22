import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseAmount } from "@/lib/utils/format";
import { type Result, failed } from "@/lib/query/result";
import { getCapabilities } from "@/lib/db/capabilities";
import { RETURN_REASONS, REASON_LABELS } from "./state";

export { RETURN_REASONS, REASON_LABELS };

/**
 * Vans, loads, returns and reconciliation.
 *
 * The distribution cycle: stock leaves a warehouse on a load, is sold
 * from the van, what is left comes back on a return, and the money and
 * the stock are then reconciled. Each stage is a row somebody signed
 * for, so these reads join to the person as well as the quantity.
 */

export const PAGE_SIZE = 25;

export interface VanRow {
  id: string;
  code: string;
  registrationNo: string;
  make: string | null;
  model: string | null;
  capacityKg: number | null;
  homeWarehouse: string | null;
  isActive: boolean;
  driverName: string | null;
  driverId: string | null;
  stockLines: number;
  stockUnits: number;
  stockValue: number;
  openLoad: string | null;
}

export async function listVans(): Promise<Result<VanRow[]>> {
  const supabase = await createSupabaseServerClient();

  // Three reads rather than one per van: the assignment, the stock and
  // the open load are each a single pass over a small table.
  const [vans, assignments, stock, loads] = await Promise.all([
    supabase
      .from("vans")
      .select("id, code, registration_no, make, model, capacity_kg, is_active, warehouses(name)")
      .order("code"),
    supabase
      .from("van_assignments")
      .select("van_id, driver_id, profiles(full_name)")
      .is("unassigned_at", null),
    supabase.from("van_stock_summary").select("van_id, qty_on_hand, stock_value"),
    supabase
      .from("van_loads")
      .select("van_id, load_number, status")
      .in("status", ["loaded", "dispatched"]),
  ]);

  if (vans.error) return failed("vans", vans.error, "Vans could not be loaded.");

  const driverBy = new Map<string, { id: string; name: string }>();
  for (const a of (assignments.data ?? []) as unknown as Record<string, unknown>[]) {
    driverBy.set(a.van_id as string, {
      id: a.driver_id as string,
      name: (a.profiles as { full_name?: string } | null)?.full_name ?? "Unnamed driver",
    });
  }

  const stockBy = new Map<string, { lines: number; units: number; value: number }>();
  for (const s of stock.data ?? []) {
    const id = s.van_id as string;
    const entry = stockBy.get(id) ?? { lines: 0, units: 0, value: 0 };
    entry.lines += 1;
    entry.units += Number(s.qty_on_hand ?? 0);
    entry.value += parseAmount(s.stock_value as string);
    stockBy.set(id, entry);
  }

  const loadBy = new Map<string, string>();
  for (const l of loads.data ?? []) loadBy.set(l.van_id as string, l.load_number as string);

  return {
    ok: true,
    data: ((vans.data ?? []) as unknown as Record<string, unknown>[]).map((v) => {
      const id = v.id as string;
      const totals = stockBy.get(id) ?? { lines: 0, units: 0, value: 0 };
      const driver = driverBy.get(id);
      return {
        id,
        code: v.code as string,
        registrationNo: v.registration_no as string,
        make: (v.make as string | null) ?? null,
        model: (v.model as string | null) ?? null,
        capacityKg: v.capacity_kg === null ? null : parseAmount(v.capacity_kg as string),
        homeWarehouse: (v.warehouses as { name?: string } | null)?.name ?? null,
        isActive: v.is_active as boolean,
        driverName: driver?.name ?? null,
        driverId: driver?.id ?? null,
        stockLines: totals.lines,
        stockUnits: totals.units,
        stockValue: totals.value,
        openLoad: loadBy.get(id) ?? null,
      };
    }),
  };
}

export interface LoadRow {
  id: string;
  loadNumber: string;
  loadDate: string;
  status: string;
  vanCode: string;
  driverName: string;
  driverId: string | null;
  openingFloat: number;
  lineCount: number;
  loadedValue: number;
  cashSales: number;
  creditSales: number;
  saleCount: number;
  cashVariance: number | null;
  stockVariance: number | null;
  reconciliationStatus: string | null;
}

export interface LoadFilters {
  status?: string;
  search?: string;
  driverId?: string;
  page?: number;
}

/**
 * Loads come from the reporting view, which already carries the sales
 * and variance totals for each one. Reading the tables directly would
 * mean summing van_sales per load in the application.
 */
export async function listLoads(
  filters: LoadFilters = {},
): Promise<Result<{ loads: LoadRow[]; total: number; page: number }>> {
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, Number(filters.page ?? 1));

  let query = supabase
    .from("van_load_summary")
    .select("*", { count: "exact" })
    .order("load_date", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (filters.status && filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.driverId) query = query.eq("driver_id", filters.driverId);

  const search = filters.search?.trim();
  if (search) query = query.ilike("load_number", `%${search.replace(/[%,()]/g, " ")}%`);

  const { data, error, count } = await query;
  if (error) return failed("loads", error, "Van loads could not be loaded.");

  const loads = (data ?? []).map(toLoad);
  return { ok: true, data: { loads, total: count ?? loads.length, page } };
}

function toLoad(row: Record<string, unknown>): LoadRow {
  return {
    id: row.load_id as string,
    loadNumber: row.load_number as string,
    loadDate: row.load_date as string,
    status: row.status as string,
    vanCode: (row.van_code as string) ?? "-",
    driverName: (row.driver_name as string) ?? "Unassigned",
    driverId: (row.driver_id as string | null) ?? null,
    openingFloat: parseAmount(row.opening_float as string),
    lineCount: Number(row.line_count ?? 0),
    loadedValue: parseAmount(row.loaded_value as string),
    cashSales: parseAmount(row.cash_sales as string),
    creditSales: parseAmount(row.credit_sales as string),
    saleCount: Number(row.sale_count ?? 0),
    cashVariance: row.cash_variance === null ? null : parseAmount(row.cash_variance as string),
    stockVariance: row.stock_variance === null ? null : parseAmount(row.stock_variance as string),
    reconciliationStatus: (row.reconciliation_status as string | null) ?? null,
  };
}

export interface ReturnRow {
  id: string;
  returnNumber: string;
  loadNumber: string;
  vanCode: string;
  driverName: string;
  warehouseName: string;
  status: string;
  returnedAt: string;
  approvedAt: string | null;
  lineCount: number;
  qtyGood: number;
  qtyDamaged: number;
  qtyMissing: number;
}

export async function listReturns(
  filters: { status?: string; search?: string; page?: number } = {},
): Promise<Result<{ returns: ReturnRow[]; total: number; page: number }>> {
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, Number(filters.page ?? 1));

  let query = supabase
    .from("van_returns")
    .select(
      "id, return_number, status, returned_at, approved_at, " +
      "van_loads(load_number), vans(code), profiles!van_returns_driver_id_fkey(full_name), " +
      "warehouses(name), van_return_items(qty_returned_good, qty_damaged, qty_missing)",
      { count: "exact" },
    )
    .order("returned_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (filters.status && filters.status !== "all") query = query.eq("status", filters.status);
  const search = filters.search?.trim();
  if (search) query = query.ilike("return_number", `%${search.replace(/[%,()]/g, " ")}%`);

  const { data, error, count } = await query;
  if (error) return failed("returns", error, "Van returns could not be loaded.");

  const returns = ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => {
    const items = (row.van_return_items as Array<Record<string, number>> | null) ?? [];
    return {
      id: row.id as string,
      returnNumber: row.return_number as string,
      loadNumber: (row.van_loads as { load_number?: string } | null)?.load_number ?? "-",
      vanCode: (row.vans as { code?: string } | null)?.code ?? "-",
      driverName: (row.profiles as { full_name?: string } | null)?.full_name ?? "Unknown driver",
      warehouseName: (row.warehouses as { name?: string } | null)?.name ?? "-",
      status: row.status as string,
      returnedAt: row.returned_at as string,
      approvedAt: (row.approved_at as string | null) ?? null,
      lineCount: items.length,
      qtyGood: items.reduce((s, i) => s + Number(i.qty_returned_good ?? 0), 0),
      qtyDamaged: items.reduce((s, i) => s + Number(i.qty_damaged ?? 0), 0),
      qtyMissing: items.reduce((s, i) => s + Number(i.qty_missing ?? 0), 0),
    };
  });

  return { ok: true, data: { returns, total: count ?? returns.length, page } };
}

export interface ReconciliationRow {
  id: string;
  reconNumber: string;
  status: string;
  vanCode: string;
  driverName: string;
  expectedCash: number;
  actualCash: number;
  cashVariance: number;
  expectedStockValue: number;
  actualStockValue: number;
  stockVariance: number;
  damagedValue: number;
  missingValue: number;
  totalVariance: number;
  explanation: string | null;
  submittedAt: string | null;
}

export async function listReconciliations(
  filters: { status?: string; search?: string; page?: number } = {},
): Promise<Result<{ reconciliations: ReconciliationRow[]; total: number; page: number }>> {
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, Number(filters.page ?? 1));

  let query = supabase
    .from("reconciliation_variances")
    .select("*", { count: "exact" })
    .order("submitted_at", { ascending: false, nullsFirst: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (filters.status && filters.status !== "all") query = query.eq("status", filters.status);
  const search = filters.search?.trim();
  if (search) query = query.ilike("recon_number", `%${search.replace(/[%,()]/g, " ")}%`);

  const { data, error, count } = await query;
  if (error) return failed("reconciliation", error, "Reconciliations could not be loaded.");

  const reconciliations = (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    reconNumber: row.recon_number as string,
    status: row.status as string,
    vanCode: (row.van_code as string) ?? "-",
    driverName: (row.driver_name as string) ?? "Unknown driver",
    expectedCash: parseAmount(row.expected_cash as string),
    actualCash: parseAmount(row.actual_cash as string),
    cashVariance: parseAmount(row.cash_variance as string),
    expectedStockValue: parseAmount(row.expected_stock_value as string),
    actualStockValue: parseAmount(row.actual_stock_value as string),
    stockVariance: parseAmount(row.stock_variance as string),
    damagedValue: parseAmount(row.damaged_value as string),
    missingValue: parseAmount(row.missing_value as string),
    totalVariance: parseAmount(row.total_variance as string),
    explanation: (row.explanation as string | null) ?? null,
    submittedAt: (row.submitted_at as string | null) ?? null,
  }));

  return { ok: true, data: { reconciliations, total: count ?? reconciliations.length, page } };
}

export interface VanStockRow {
  vanId: string;
  vanCode: string;
  sku: string;
  productName: string;
  qtyOnHand: number;
  stockValue: number;
}

export async function listVanStock(vanId?: string): Promise<Result<VanStockRow[]>> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("van_stock_summary")
    .select("van_id, van_code, sku, product_name, qty_on_hand, stock_value")
    .order("van_code");
  if (vanId) query = query.eq("van_id", vanId);

  const { data, error } = await query;
  if (error) return failed("van stock", error, "Van stock could not be loaded.");

  return {
    ok: true,
    data: (data ?? []).map((r) => ({
      vanId: r.van_id as string,
      vanCode: r.van_code as string,
      sku: r.sku as string,
      productName: r.product_name as string,
      qtyOnHand: Number(r.qty_on_hand ?? 0),
      stockValue: parseAmount(r.stock_value as string),
    })),
  };
}

export interface DriverOption { id: string; fullName: string; role: string }

/**
 * People who can be given a van.
 *
 * Not only the driver role: a sales rep or a manager covering a round is
 * ordinary, and the database's own driver policies key on the
 * assignment rather than on the role name.
 */
export async function listAssignableDrivers(): Promise<Result<DriverOption[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("is_active", true)
    .in("role", ["driver", "sales_rep", "manager"])
    .order("full_name");

  if (error) return failed("drivers", error, "Drivers could not be loaded.");

  return {
    ok: true,
    data: (data ?? []).map((p) => ({
      id: p.id as string,
      fullName: (p.full_name as string) ?? "Unnamed",
      role: p.role as string,
    })),
  };
}

// ===================================================================
// Returns that are not a van coming back
// ===================================================================

export interface StockReturnRow {
  id: string;
  returnNumber: string;
  direction: "customer" | "supplier";
  partyName: string;
  partyCode: string;
  warehouseName: string;
  reason: string;
  notes: string | null;
  recordedBy: string | null;
  createdAt: string;
  lineCount: number;
  totalQuantity: number;
}



/**
 * A customer bringing goods back, or goods going back to a supplier.
 *
 * Separate from van returns, which are a round coming in at the end of
 * the day. These two move stock in opposite directions and are recorded
 * against a party rather than a load.
 */
export async function listStockReturns(
  filters: { direction?: string; page?: number } = {},
): Promise<Result<{ returns: StockReturnRow[]; total: number; page: number }>> {
  const { supplierSubmissions } = await getCapabilities();
  if (!supplierSubmissions) {
    return {
      ok: false,
      message:
        "Customer and supplier returns need database upgrade 0031. " +
        "Run database/UPGRADE_0031_SUPPLIER_SUBMISSIONS.sql, then reload.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, Number(filters.page ?? 1));

  let query = supabase
    .from("stock_return_summary")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (filters.direction === "customer" || filters.direction === "supplier") {
    query = query.eq("direction", filters.direction);
  }

  const { data, error, count } = await query;
  if (error) return failed("returns", error, "Returns could not be loaded.");

  const returns = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    returnNumber: r.return_number as string,
    direction: (r.direction as "customer" | "supplier") ?? "customer",
    partyName: (r.party_name as string) ?? "Unknown",
    partyCode: (r.party_code as string) ?? "",
    warehouseName: (r.warehouse_name as string) ?? "",
    reason: (r.reason as string) ?? "other",
    notes: (r.notes as string) ?? null,
    recordedBy: (r.recorded_by as string) ?? null,
    createdAt: r.created_at as string,
    lineCount: Number(r.line_count ?? 0),
    totalQuantity: Number(r.total_quantity ?? 0),
  }));

  return { ok: true, data: { returns, total: count ?? returns.length, page } };
}

/** Warehouses, customers, suppliers and products, for recording one. */
export async function getStockReturnOptions(): Promise<Result<{
  warehouses: { id: string; label: string }[];
  customers: { id: string; label: string }[];
  suppliers: { id: string; label: string }[];
  products: { id: string; label: string }[];
}>> {
  const supabase = await createSupabaseServerClient();

  const [warehouses, customers, suppliers, products] = await Promise.all([
    supabase.from("warehouses").select("id, code, name").eq("is_active", true).order("name"),
    supabase.from("customers").select("id, code, name").eq("is_active", true).order("name"),
    supabase.from("suppliers").select("id, code, name").eq("is_active", true).order("name"),
    supabase.from("products").select("id, sku, name").eq("is_active", true).order("name"),
  ]);

  if (warehouses.error) {
    return failed("returns", warehouses.error, "Warehouses could not be loaded.");
  }

  const label = (row: Record<string, unknown>, key: string) =>
    `${row[key] ?? ""} · ${row.name ?? ""}`.replace(/^ · /, "");

  return {
    ok: true,
    data: {
      warehouses: (warehouses.data ?? []).map((w) => ({
        id: w.id as string,
        label: label(w as Record<string, unknown>, "code"),
      })),
      customers: (customers.data ?? []).map((c) => ({
        id: c.id as string,
        label: label(c as Record<string, unknown>, "code"),
      })),
      suppliers: (suppliers.data ?? []).map((s) => ({
        id: s.id as string,
        label: label(s as Record<string, unknown>, "code"),
      })),
      products: (products.data ?? []).map((p) => ({
        id: p.id as string,
        label: label(p as Record<string, unknown>, "sku"),
      })),
    },
  };
}
