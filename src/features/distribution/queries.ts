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
  /** Everybody selling from this van today. A van may have several. */
  salespeople: { id: string; name: string }[];
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
      .select("van_id, member_id, crew_role, profiles!van_assignments_driver_id_fkey(full_name)")
      .is("unassigned_at", null),
    supabase.from("van_stock_summary").select("van_id, qty_on_hand, stock_value"),
    supabase
      .from("van_loads")
      .select("van_id, load_number, status")
      .in("status", ["loaded", "dispatched"]),
  ]);

  if (vans.error) return failed("vans", vans.error, "Vans could not be loaded.");

  // One driver per van, any number of people selling from it.
  const driverBy = new Map<string, { id: string; name: string }>();
  const sellersBy = new Map<string, { id: string; name: string }[]>();

  for (const a of (assignments.data ?? []) as unknown as Record<string, unknown>[]) {
    const vanId = a.van_id as string;
    const member = {
      id: a.member_id as string,
      name: (a.profiles as { full_name?: string } | null)?.full_name ?? "Unnamed",
    };
    if (a.crew_role === "driver") driverBy.set(vanId, member);
    else sellersBy.set(vanId, [...(sellersBy.get(vanId) ?? []), member]);
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
        salespeople: sellersBy.get(id) ?? [],
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
export interface CrewOption { id: string; fullName: string; role: string }

/**
 * People who can be crewed onto a van, by the job they would do.
 *
 * The two lists differ because the jobs differ: a driver drives and a
 * salesperson handles the money. The database refuses a mismatch, so
 * offering the wrong people here would only produce a form that fails
 * on submit.
 *
 * Managers appear on both, because covering a round is ordinary.
 */
const DRIVER_ROLES = ["driver", "admin", "senior_manager", "manager"];
const SELLER_ROLES = ["salesperson", "sales_rep", "admin", "senior_manager", "manager"];

async function crewCandidates(roles: string[]): Promise<Result<CrewOption[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("is_active", true)
    .in("role", roles)
    .order("full_name");

  if (error) return failed("crew", error, "Staff could not be loaded.");

  return {
    ok: true,
    data: (data ?? []).map((p) => ({
      id: p.id as string,
      fullName: (p.full_name as string) ?? "Unnamed",
      role: p.role as string,
    })),
  };
}

export const listAssignableDrivers = () => crewCandidates(DRIVER_ROLES);
export const listAssignableSalespeople = () => crewCandidates(SELLER_ROLES);

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

// ===================================================================
// The crew on a van
// ===================================================================

export interface CrewMember {
  assignmentId: string;
  memberId: string;
  memberName: string;
  memberPhone: string | null;
  crewRole: "driver" | "salesperson";
  assignedAt: string;
}

export interface VanCrewDetail {
  vanId: string;
  vanCode: string;
  registrationNo: string;
  isActive: boolean;
  homeWarehouse: string | null;
  driver: CrewMember | null;
  salespeople: CrewMember[];
  /** Who has been on this van before, newest first. */
  history: {
    memberName: string;
    crewRole: string;
    assignedAt: string;
    unassignedAt: string;
  }[];
  /** Today, so the crew page answers "how is this van doing". */
  today: {
    saleCount: number;
    revenue: number;
    cash: number;
    mobileMoney: number;
    credit: number;
    stockUnits: number;
  };
  openLoad: string | null;
  loadStatus: string | null;
}

export async function getVanCrew(vanId: string): Promise<Result<VanCrewDetail | null>> {
  const { vanCrew } = await getCapabilities();
  if (!vanCrew) {
    return {
      ok: false,
      message:
        "Van crews need database upgrade 0032. " +
        "Run database/UPGRADE_0032_VAN_CREW.sql, then reload.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [van, active, past, sales, stock, load] = await Promise.all([
    supabase
      .from("vans")
      .select("id, code, registration_no, is_active, warehouses(name)")
      .eq("id", vanId)
      .maybeSingle(),
    supabase
      .from("van_assignments")
      .select("id, member_id, crew_role, assigned_at, profiles!van_assignments_driver_id_fkey(full_name, phone)")
      .eq("van_id", vanId)
      .is("unassigned_at", null),
    supabase
      .from("van_assignments")
      .select("crew_role, assigned_at, unassigned_at, profiles!van_assignments_driver_id_fkey(full_name)")
      .eq("van_id", vanId)
      .not("unassigned_at", "is", null)
      .order("unassigned_at", { ascending: false })
      .limit(20),
    supabase
      .from("van_sales")
      .select("total, amount_paid, sale_type, status")
      .eq("van_id", vanId)
      .eq("status", "completed")
      .gte("sold_at", startOfDay.toISOString()),
    supabase.from("van_stock_summary").select("qty_on_hand").eq("van_id", vanId),
    supabase
      .from("van_loads")
      .select("load_number, status")
      .eq("van_id", vanId)
      .in("status", ["loaded", "dispatched"])
      .maybeSingle(),
  ]);

  if (van.error) return failed("crew", van.error, "This van could not be loaded.");
  if (!van.data) return { ok: true, data: null };

  const crew = ((active.data ?? []) as unknown as Record<string, unknown>[]).map((a) => {
    const p = a.profiles as { full_name?: string; phone?: string } | null;
    return {
      assignmentId: a.id as string,
      memberId: a.member_id as string,
      memberName: p?.full_name ?? "Unnamed",
      memberPhone: p?.phone ?? null,
      crewRole: (a.crew_role as "driver" | "salesperson") ?? "salesperson",
      assignedAt: a.assigned_at as string,
    };
  });

  const rows = (sales.data ?? []) as unknown as Record<string, unknown>[];
  const sum = (f: (r: Record<string, unknown>) => number) => rows.reduce((s, r) => s + f(r), 0);

  const row = van.data as unknown as Record<string, unknown>;

  return {
    ok: true,
    data: {
      vanId: row.id as string,
      vanCode: row.code as string,
      registrationNo: row.registration_no as string,
      isActive: row.is_active as boolean,
      homeWarehouse: (row.warehouses as { name?: string } | null)?.name ?? null,
      driver: crew.find((c) => c.crewRole === "driver") ?? null,
      salespeople: crew.filter((c) => c.crewRole === "salesperson"),
      history: ((past.data ?? []) as unknown as Record<string, unknown>[]).map((h) => ({
        memberName: (h.profiles as { full_name?: string } | null)?.full_name ?? "Unnamed",
        crewRole: (h.crew_role as string) ?? "salesperson",
        assignedAt: h.assigned_at as string,
        unassignedAt: h.unassigned_at as string,
      })),
      today: {
        saleCount: rows.length,
        revenue: sum((r) => parseAmount(r.total as string)),
        // Cash and mobile money are told apart by the payment breakdown
        // where there is one; without it a cash sale is just cash.
        cash: sum((r) => (r.sale_type === "cash" ? parseAmount(r.amount_paid as string) : 0)),
        mobileMoney: 0,
        credit: sum((r) => (r.sale_type === "credit" ? parseAmount(r.total as string) : 0)),
        stockUnits: (stock.data ?? []).reduce((s, x) => s + Number(x.qty_on_hand ?? 0), 0),
      },
      openLoad: (load.data?.load_number as string) ?? null,
      loadStatus: (load.data?.status as string) ?? null,
    },
  };
}

export interface LoadLine {
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  loaded: number;
  sold: number;
  /** Still on the van now. */
  remaining: number;
  /** The loose half of each, never folded into the figure beside it. */
  loadedPieces: number;
  soldPieces: number;
  remainingPieces: number;
}

/**
 * One delivery of extra stock to a van already out on its round.
 *
 * The items come from the movements the top-up wrote, read by its own
 * reference - so the history is the ledger rather than a second copy of
 * it that could disagree.
 */
export interface LoadTopUp {
  id: string;
  createdAt: string;
  /** Who sent it. Null only if the account has since been removed. */
  byName: string | null;
  note: string | null;
  /** Distinct products on this delivery. */
  lineCount: number;
  units: number;
  pieces: number;
}

/**
 * Stock handed back to a warehouse during the round.
 *
 * Read from the movements it wrote, by its own reference - the ledger
 * is the history, and a second copy of it could only ever disagree.
 */
export interface LoadStockReturn {
  id: string;
  createdAt: string;
  byName: string | null;
  warehouseName: string | null;
  note: string | null;
  lineCount: number;
  units: number;
  pieces: number;
}

export interface LoadDetail {
  id: string;
  loadNumber: string;
  loadDate: string;
  status: string;
  vanId: string;
  vanCode: string;
  registrationNo: string;
  /** The depot this round draws from, and the one a top-up comes out of. */
  warehouseId: string;
  warehouseName: string | null;
  driverName: string | null;
  /** Everybody crewed to sell from this van. Empty is a real answer. */
  salespeople: string[];
  lines: LoadLine[];
  /**
   * Every mid-week delivery to this van, oldest first. Empty is the
   * ordinary case: most weeks a van goes out once.
   */
  topUps: LoadTopUp[];
  /**
   * Stock sent back mid-round, oldest first. Empty is the ordinary
   * case: most weeks nothing comes back before Friday.
   */
  stockReturns: LoadStockReturn[];
}

/**
 * What is actually inside a van.
 *
 * The loads list could say a load existed and never what was on it,
 * which is the one thing anybody opens a load to find out. Three numbers
 * per line, because they answer different questions: loaded is what the
 * warehouse signed out, sold is what the round has taken, remaining is
 * what is on the shelf now - and remaining is read from the van's own
 * balance rather than subtracted here, so it agrees with what the
 * salesperson sees.
 */
export async function getLoadDetail(loadId: string): Promise<Result<LoadDetail | null>> {
  const supabase = await createSupabaseServerClient();

  const loadCapabilities = await getCapabilities();

  const { data: loadRow, error } = await supabase
    .from("van_loads")
    .select(
      "id, load_number, load_date, status, van_id, warehouse_id, " +
      "vans(code, registration_no), warehouses(name), " +
      // Named explicitly: van_loads carries its own driver, and a bare
      // profiles embed cannot be resolved once a table has two routes
      // to that table.
      "driver:profiles!van_loads_driver_id_fkey(full_name)",
    )
    .eq("id", loadId)
    .maybeSingle();

  if (error) return failed("distribution", error, "That load could not be loaded.");
  if (!loadRow) return { ok: true, data: null };

  // Cast once: the embed alias with an explicit constraint name is more
  // than the generated types can follow, and every field is read
  // defensively below anyway.
  const load = loadRow as unknown as Record<string, unknown>;

  const van = load.vans as { code?: string; registration_no?: string } | null;
  const vanId = load.van_id as string;

  const [{ data: items }, { data: onVan }, { data: crew }, { data: sales },
         { data: topUpRows }, { data: returnRows }] = await Promise.all([
    supabase
      .from("van_load_items")
      .select(loadCapabilities.loosePieces
        ? "product_id, qty_loaded, qty_loaded_pieces, products(name, sku, unit_of_measure)"
        : "product_id, qty_loaded, products(name, sku, unit_of_measure)")
      .eq("load_id", loadId),
    supabase
      .from("van_stock_summary")
      .select(loadCapabilities.loosePieces
        ? "product_id, qty_on_hand, qty_pieces"
        : "product_id, qty_on_hand")
      .eq("van_id", vanId),
    supabase
      .from("van_assignments")
      .select("crew_role, profiles!van_assignments_driver_id_fkey(full_name)")
      .eq("van_id", vanId)
      .eq("crew_role", "salesperson")
      .is("unassigned_at", null),
    // What this load's own round has sold, so the figure belongs to the
    // load rather than to everything the van has ever done.
    supabase
      .from("van_sales")
      .select(loadCapabilities.loosePieces
        ? "id, van_sale_items(product_id, quantity, pieces)"
        : "id, van_sale_items(product_id, quantity)")
      .eq("load_id", loadId)
      .eq("status", "completed"),

    // Mid-week deliveries. Absent before 0064, where a load simply had
    // none - so an older database shows the page rather than an error.
    loadCapabilities.vanTopUps
      ? supabase
          .from("van_load_top_ups")
          .select("id, created_at, note, profiles(full_name)")
          .eq("load_id", loadId)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as unknown[] }),

    // Mid-round hand-backs. Absent before 0065, where a round simply had
    // none - so an older database shows the page rather than an error.
    loadCapabilities.vanMidweekReturns
      ? supabase
          .from("van_midweek_returns")
          .select("id, created_at, note, warehouses(name), profiles(full_name)")
          .eq("load_id", loadId)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const onVanRows = (onVan ?? []) as unknown as {
    product_id: string; qty_on_hand: number | null; qty_pieces?: number | null;
  }[];
  const remainingBy = new Map(onVanRows.map((r) => [r.product_id, Number(r.qty_on_hand ?? 0)]));
  const remainingPiecesBy = new Map(
    onVanRows.map((r) => [r.product_id, Number(r.qty_pieces ?? 0)]));

  const soldBy = new Map<string, number>();
  const soldPiecesBy = new Map<string, number>();
  for (const sale of (sales ?? []) as unknown as Record<string, unknown>[]) {
    for (const item of (sale.van_sale_items ?? []) as Record<string, unknown>[]) {
      const id = item.product_id as string;
      soldBy.set(id, (soldBy.get(id) ?? 0) + Number(item.quantity ?? 0));
      soldPiecesBy.set(id, (soldPiecesBy.get(id) ?? 0) + Number(item.pieces ?? 0));
    }
  }

  const lines: LoadLine[] = ((items ?? []) as unknown as Record<string, unknown>[]).map((i) => {
    const product = i.products as { name?: string; sku?: string; unit_of_measure?: string } | null;
    const id = i.product_id as string;
    return {
      productId: id,
      productName: product?.name ?? "Unknown product",
      sku: product?.sku ?? "",
      unit: product?.unit_of_measure ?? "unit",
      loaded: Number(i.qty_loaded ?? 0),
      sold: soldBy.get(id) ?? 0,
      remaining: remainingBy.get(id) ?? 0,
      // The loose half of each figure, kept beside its own number rather
      // than added in. A load of four cartons and ten singles that has
      // sold three singles is not a load of fourteen that has sold three.
      loadedPieces: Number(i.qty_loaded_pieces ?? 0),
      soldPieces: soldPiecesBy.get(id) ?? 0,
      remainingPieces: remainingPiecesBy.get(id) ?? 0,
    };
  }).sort((a, b) => a.productName.localeCompare(b.productName));

  // What each delivery contained, read from the movements it wrote.
  // One query for all of them rather than one per top-up, and only the
  // half arriving on the van, so nothing is counted twice.
  const topUpIds = ((topUpRows ?? []) as unknown as Record<string, unknown>[])
    .map((t) => t.id as string);
  const returnIds = ((returnRows ?? []) as unknown as Record<string, unknown>[])
    .map((t) => t.id as string);

  const contents = new Map<string, { lines: Set<string>; units: number; pieces: number }>();

  /**
   * What one delivery or hand-back contained.
   *
   * One query per kind rather than one per event, and only the half
   * that names the direction being counted - the arriving half for a
   * top-up, the leaving half for a return - so nothing is counted twice.
   */
  const readContents = async (kind: string, ids: string[], half: string) => {
    if (!ids.length) return;
    const { data: moves } = await supabase
      .from("stock_movements")
      .select("reference_id, product_id, quantity, pieces")
      .eq("reference_type", kind)
      .eq("type", half)
      .in("reference_id", ids);

    for (const row of (moves ?? []) as unknown as Record<string, unknown>[]) {
      const key = row.reference_id as string;
      const entry = contents.get(key) ?? { lines: new Set<string>(), units: 0, pieces: 0 };
      entry.lines.add(row.product_id as string);
      entry.units += Number(row.quantity ?? 0);
      entry.pieces += Number(row.pieces ?? 0);
      contents.set(key, entry);
    }
  };

  await Promise.all([
    readContents("van_top_up", topUpIds, "transfer_in"),
    readContents("van_midweek_return", returnIds, "transfer_out"),
  ]);

  const topUps: LoadTopUp[] = ((topUpRows ?? []) as unknown as Record<string, unknown>[])
    .map((t) => {
      const held = contents.get(t.id as string);
      return {
        id: t.id as string,
        createdAt: t.created_at as string,
        byName: (t.profiles as { full_name?: string } | null)?.full_name ?? null,
        note: (t.note as string | null) ?? null,
        lineCount: held?.lines.size ?? 0,
        units: held?.units ?? 0,
        pieces: held?.pieces ?? 0,
      };
    });

  const stockReturns: LoadStockReturn[] =
    ((returnRows ?? []) as unknown as Record<string, unknown>[]).map((t) => {
      const held = contents.get(t.id as string);
      return {
        id: t.id as string,
        createdAt: t.created_at as string,
        byName: (t.profiles as { full_name?: string } | null)?.full_name ?? null,
        warehouseName: (t.warehouses as { name?: string } | null)?.name ?? null,
        note: (t.note as string | null) ?? null,
        lineCount: held?.lines.size ?? 0,
        units: held?.units ?? 0,
        pieces: held?.pieces ?? 0,
      };
    });

  return {
    ok: true,
    data: {
      id: load.id as string,
      loadNumber: load.load_number as string,
      loadDate: load.load_date as string,
      status: load.status as string,
      vanId,
      vanCode: van?.code ?? "",
      registrationNo: van?.registration_no ?? "",
      warehouseId: load.warehouse_id as string,
      warehouseName: (load.warehouses as { name?: string } | null)?.name ?? null,
      driverName: (load.driver as { full_name?: string } | null)?.full_name ?? null,
      salespeople: (crew ?? [])
        .map((r) => (r.profiles as { full_name?: string } | null)?.full_name)
        .filter((n): n is string => Boolean(n)),
      lines,
      topUps,
      stockReturns,
    },
  };
}

export interface VanTransferContext {
  lines: {
    productId: string; name: string; sku: string;
    onHand: number;
    /** The loose half, kept apart from the units as everywhere else. */
    onHandPieces: number;
    unit: string;
  }[];
  otherVans: { id: string; code: string }[];
}

/**
 * What a van is carrying, and where it could go.
 *
 * For the breakdown case: the office needs to see what is stranded and
 * pick the vehicle taking over, in one place, without leaving the van
 * they are looking at.
 */
export async function getVanTransferContext(vanId: string): Promise<VanTransferContext> {
  const supabase = await createSupabaseServerClient();

  const transferCapabilities = await getCapabilities();

  const [{ data: stock }, { data: vans }] = await Promise.all([
    supabase
      .from("van_stock_summary")
      .select(transferCapabilities.loosePieces
        ? "product_id, product_name, sku, qty_on_hand, qty_pieces, unit_of_measure"
        : "product_id, product_name, sku, qty_on_hand")
      .eq("van_id", vanId)
      // Either half is stock worth rescuing. Filtering on full units
      // alone would leave a product that is nothing but singles off the
      // list, stranded on a van nobody is driving.
      .or(transferCapabilities.loosePieces
        ? "qty_on_hand.gt.0,qty_pieces.gt.0"
        : "qty_on_hand.gt.0")
      .order("product_name"),
    supabase
      .from("vans")
      .select("id, code")
      .eq("is_active", true)
      .neq("id", vanId)
      .order("code"),
  ]);

  return {
    lines: ((stock ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      productId: r.product_id as string,
      name: (r.product_name as string) ?? "Unknown product",
      sku: (r.sku as string) ?? "",
      onHand: Number(r.qty_on_hand ?? 0),
      onHandPieces: Number(r.qty_pieces ?? 0),
      unit: (r.unit_of_measure as string) ?? "unit",
    })),
    otherVans: (vans ?? []).map((v) => ({ id: v.id as string, code: v.code as string })),
  };
}

export interface LoadableProduct {
  id: string;
  name: string;
  sku: string;
  unit: string;
  listPrice: number;
  /** How many are in each warehouse, keyed by warehouse id. */
  availableBy: Record<string, number>;
  /** Loose pieces in each warehouse, kept apart from the full units. */
  piecesBy: Record<string, number>;
  /** 1 means this product is never split, and has no loose half. */
  piecesPerUnit: number;
}

/**
 * Everything that could go on a van, and where it actually is.
 *
 * The load form used to take page one of the product list - twenty-five
 * of sixty-eight - and then drop anything showing no stock, so most of
 * the catalogue was simply missing from the picker with nothing to say
 * why. It also summed availability across every warehouse, which meant
 * it could offer stock sitting somewhere the load was not coming from.
 *
 * Unpaginated on purpose: a picker that silently ends at twenty-five is
 * worse than a long list. A wholesale catalogue is hundreds of lines,
 * not thousands, and this is one read.
 */
export async function listLoadableProducts(): Promise<Result<LoadableProduct[]>> {
  const supabase = await createSupabaseServerClient();

  const capabilities = await getCapabilities();

  const [{ data: products, error }, { data: levels }] = await Promise.all([
    supabase
      .from("products_priced")
      .select("id, name, sku, unit_of_measure, units_per_case, list_price")
      .eq("is_active", true)
      .order("name"),
    // Per warehouse, because a load comes out of one of them and stock
    // in another is no use to it.
    supabase.from("inventory").select(capabilities.loosePieces
      ? "product_id, warehouse_id, qty_on_hand, qty_reserved, qty_pieces"
      : "product_id, warehouse_id, qty_on_hand, qty_reserved"),
  ]);

  if (error) return failed("distribution", error, "Products could not be loaded.");

  const rows = (levels ?? []) as unknown as {
    product_id: string; warehouse_id: string;
    qty_on_hand: number | null; qty_reserved: number | null; qty_pieces?: number | null;
  }[];

  const availability = new Map<string, Record<string, number>>();
  const looseBy = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const byWarehouse = availability.get(row.product_id) ?? {};
    byWarehouse[row.warehouse_id] =
      Number(row.qty_on_hand ?? 0) - Number(row.qty_reserved ?? 0);
    availability.set(row.product_id, byWarehouse);

    // Kept apart from the units and never netted against reserved:
    // nothing reserves a loose piece.
    const piecesHere = looseBy.get(row.product_id) ?? {};
    piecesHere[row.warehouse_id] = Number(row.qty_pieces ?? 0);
    looseBy.set(row.product_id, piecesHere);
  }

  return {
    ok: true,
    data: (products ?? []).map((p) => ({
      id: p.id as string,
      name: p.name as string,
      sku: (p.sku as string) ?? "",
      unit: (p.unit_of_measure as string) ?? "unit",
      listPrice: Number(p.list_price ?? 0),
      availableBy: availability.get(p.id as string) ?? {},
      piecesBy: looseBy.get(p.id as string) ?? {},
      piecesPerUnit: capabilities.loosePieces ? Number(p.units_per_case ?? 1) : 1,
    })),
  };
}
