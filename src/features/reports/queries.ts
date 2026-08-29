import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseAmount } from "@/lib/utils/format";
import { type Result, failed } from "@/lib/query/result";
import { getCapabilities } from "@/lib/db/capabilities";

/**
 * Reporting reads.
 *
 * Tables, not charts. What an operator needs from this screen is a list
 * they can act on or hand to somebody - which line to reorder, which
 * customer to call - and a bar chart of the same numbers answers
 * neither question faster.
 *
 * Every figure comes from a view the database already maintains, so a
 * report and the screen it summarises cannot drift apart.
 */

export interface SalesByProductRow {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  /** Loose pieces sold, counted apart from the units as everywhere else. */
  pieces: number;
  revenue: number;
}

export async function salesByProduct(periodDays = 30): Promise<Result<SalesByProductRow[]>> {
  const supabase = await createSupabaseServerClient();
  const since = new Date(Date.now() - periodDays * 86_400_000).toISOString();

  const { data, error } = await supabase
    .from("van_sale_items")
    .select(((await getCapabilities()).loosePieces
      ? "product_id, quantity, pieces, line_total, "
      : "product_id, quantity, line_total, ") +
      "products(sku, name), van_sales!inner(sold_at, status)")
    .gte("van_sales.sold_at", since)
    .neq("van_sales.status", "void");

  if (error) return failed("reports", error, "The sales report could not be built.");

  const by = new Map<string, SalesByProductRow>();
  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    const id = row.product_id as string;
    const product = row.products as { sku?: string; name?: string } | null;
    const entry = by.get(id) ?? {
      productId: id,
      sku: product?.sku ?? "",
      name: product?.name ?? "Unknown product",
      quantity: 0,
      pieces: 0,
      revenue: 0,
    };
    entry.quantity += Number(row.quantity ?? 0);
    entry.pieces += Number(row.pieces ?? 0);
    entry.revenue += parseAmount(row.line_total as string);
    by.set(id, entry);
  }

  return { ok: true, data: [...by.values()].sort((a, b) => b.revenue - a.revenue) };
}

// A driver drives; a salesperson sells. This report counts sales, so it
// groups by the person who made them.
export interface SalesBySalespersonRow {
  salespersonId: string;
  salespersonName: string;
  saleCount: number;
  revenue: number;
  cash: number;
  credit: number;
  outstanding: number;
}

export async function salesBySalesperson(periodDays = 30): Promise<Result<SalesBySalespersonRow[]>> {
  const supabase = await createSupabaseServerClient();
  const since = new Date(Date.now() - periodDays * 86_400_000).toISOString();

  const { data, error } = await supabase
    .from("van_sales")
    // Attributed to whoever made the sale. van_sales has two foreign
    // keys to profiles since the crew model, so the embed has to say
    // which - and the salesperson is the one who sold it.
    .select("salesperson_id, sale_type, total, balance, status, profiles!van_sales_salesperson_id_fkey(full_name)")
    .gte("sold_at", since)
    .neq("status", "void");

  if (error) return failed("reports", error, "The driver report could not be built.");

  const by = new Map<string, SalesBySalespersonRow>();
  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    const id = row.salesperson_id as string;
    const entry = by.get(id) ?? {
      salespersonId: id,
      salespersonName: (row.profiles as { full_name?: string } | null)?.full_name ?? "Unknown",
      saleCount: 0, revenue: 0, cash: 0, credit: 0, outstanding: 0,
    };
    const total = parseAmount(row.total as string);
    entry.saleCount += 1;
    entry.revenue += total;
    if (row.sale_type === "cash") entry.cash += total; else entry.credit += total;
    entry.outstanding += parseAmount(row.balance as string);
    by.set(id, entry);
  }

  return { ok: true, data: [...by.values()].sort((a, b) => b.revenue - a.revenue) };
}

export interface LowStockRow {
  productId: string;
  sku: string;
  name: string;
  available: number;
  reorderPoint: number;
  reorderQty: number;
  stockValue: number;
}

export async function lowStockReport(): Promise<Result<LowStockRow[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("stock_summary")
    .select("product_id, sku, name, qty_available, reorder_point, reorder_qty, stock_value, needs_reorder, is_active")
    .eq("is_active", true)
    .order("qty_available");

  if (error) return failed("reports", error, "The low stock report could not be built.");

  return {
    ok: true,
    data: (data ?? [])
      .filter((r) => r.needs_reorder)
      .map((r) => ({
        productId: r.product_id as string,
        sku: r.sku as string,
        name: r.name as string,
        available: Number(r.qty_available ?? 0),
        reorderPoint: Number(r.reorder_point ?? 0),
        reorderQty: Number(r.reorder_qty ?? 0),
        stockValue: parseAmount(r.stock_value as string),
      })),
  };
}

export interface CustomerBalanceRow {
  customerId: string;
  code: string;
  name: string;
  creditLimit: number;
  balance: number;
  creditAvailable: number;
  daysPastDue: number | null;
  overLimit: boolean;
}

export async function customerBalanceReport(): Promise<Result<CustomerBalanceRow[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("customer_credit_position")
    .select("customer_id, code, name, credit_limit, ledger_balance, credit_available, over_limit, days_past_due")
    .order("ledger_balance", { ascending: false });

  if (error) return failed("reports", error, "The customer report could not be built.");

  return {
    ok: true,
    data: (data ?? [])
      .map((r) => ({
        customerId: r.customer_id as string,
        code: r.code as string,
        name: r.name as string,
        creditLimit: parseAmount(r.credit_limit as string),
        balance: parseAmount(r.ledger_balance as string),
        creditAvailable: parseAmount(r.credit_available as string),
        daysPastDue: r.days_past_due === null ? null : Number(r.days_past_due),
        overLimit: Boolean(r.over_limit),
      }))
      .filter((r) => r.balance !== 0),
  };
}

export interface InventoryValueRow {
  categoryName: string;
  productLines: number;
  units: number;
  /** Loose pieces, never added to the units - only to the value. */
  pieces: number;
  value: number;
}

export async function inventoryValueReport(): Promise<Result<InventoryValueRow[]>> {
  const supabase = await createSupabaseServerClient();
  const capabilities = await getCapabilities();

  // Valuing stock means reading cost, and cost has one door. Without it
  // the report still lists lines and units and leaves value at zero,
  // which is honest: the figure is unavailable, not zero-valued.
  const { data, error } = capabilities.maskedProductPricing
    ? await supabase
        .from("products_priced")
        .select(capabilities.loosePieces
          ? "id, categories(name), inventory(qty_on_hand, qty_pieces), units_per_case, cost_price, is_active"
          : "id, categories(name), inventory(qty_on_hand), cost_price, is_active")
        .eq("is_active", true)
    : await supabase
        .from("products")
        .select(capabilities.loosePieces
          ? "id, categories(name), inventory(qty_on_hand, qty_pieces), units_per_case, is_active"
          : "id, categories(name), inventory(qty_on_hand), is_active")
        .eq("is_active", true);

  if (error) return failed("reports", error, "The inventory report could not be built.");

  const by = new Map<string, InventoryValueRow>();
  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    const name = (row.categories as { name?: string } | null)?.name ?? "Uncategorised";
    const held = (row.inventory as Array<{ qty_on_hand: number; qty_pieces?: number }> | null) ?? [];
    const units = held.reduce((s, i) => s + Number(i.qty_on_hand ?? 0), 0);
    const pieces = held.reduce((s, i) => s + Number(i.qty_pieces ?? 0), 0);

    const entry = by.get(name)
      ?? { categoryName: name, productLines: 0, units: 0, pieces: 0, value: 0 };
    entry.productLines += 1;
    entry.units += units;
    entry.pieces += pieces;

    // Value is the one place the two combine, because a piece really is
    // worth its share of what the case cost - cost carries no margin to
    // distort. The counts stay apart.
    const cost = parseAmount(row.cost_price as string);
    const pack = Number(row.units_per_case ?? 1);
    entry.value += units * cost + (pack > 1 ? (pieces * cost) / pack : 0);
    by.set(name, entry);
  }

  return { ok: true, data: [...by.values()].sort((a, b) => b.value - a.value) };
}

// ===================================================================
// Sales, cut the other ways
// ===================================================================

export interface SalesByPeriodRow {
  /** The bucket, already formatted: 2026-08-22, 2026-W34, 2026-08. */
  period: string;
  label: string;
  saleCount: number;
  revenue: number;
  cash: number;
  credit: number;
}

/**
 * Trading over time.
 *
 * Bucketed here rather than in SQL because the three groupings differ
 * only in how a date is truncated, and three near-identical database
 * functions would be three places for the same rule to drift.
 */
export async function salesByPeriod(
  grouping: "day" | "week" | "month" = "day",
  periodDays = 30,
): Promise<Result<SalesByPeriodRow[]>> {
  const supabase = await createSupabaseServerClient();
  const since = new Date(Date.now() - periodDays * 86_400_000).toISOString();

  const { data, error } = await supabase
    .from("van_sales")
    .select("sold_at, sale_type, total, status")
    .gte("sold_at", since)
    .neq("status", "void");

  if (error) return failed("reports", error, "The sales report could not be built.");

  const by = new Map<string, SalesByPeriodRow>();

  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    const at = new Date(row.sold_at as string);
    let period: string;
    let label: string;

    if (grouping === "month") {
      period = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}`;
      label = at.toLocaleDateString("en-GH", { month: "long", year: "numeric" });
    } else if (grouping === "week") {
      // The Monday that starts the week. Naming a week by its first day
      // is what a person can act on; an ISO week number is not.
      const monday = new Date(at);
      const weekday = (monday.getDay() + 6) % 7;
      monday.setDate(monday.getDate() - weekday);
      monday.setHours(0, 0, 0, 0);
      period = monday.toISOString().slice(0, 10);
      label = `Week of ${monday.toLocaleDateString("en-GH", { day: "numeric", month: "short" })}`;
    } else {
      period = at.toISOString().slice(0, 10);
      label = at.toLocaleDateString("en-GH", { weekday: "short", day: "numeric", month: "short" });
    }

    const entry = by.get(period)
      ?? { period, label, saleCount: 0, revenue: 0, cash: 0, credit: 0 };
    const total = parseAmount(row.total as string);
    entry.saleCount += 1;
    entry.revenue += total;
    if (row.sale_type === "cash") entry.cash += total; else entry.credit += total;
    by.set(period, entry);
  }

  // Newest first: the question is almost always about recent trading.
  return {
    ok: true,
    data: [...by.values()].sort((a, b) => b.period.localeCompare(a.period)),
  };
}

export interface SalesByCustomerRow {
  customerId: string;
  code: string;
  name: string;
  saleCount: number;
  revenue: number;
  outstanding: number;
  lastBought: string | null;
}

export async function salesByCustomer(periodDays = 30): Promise<Result<SalesByCustomerRow[]>> {
  const supabase = await createSupabaseServerClient();
  const since = new Date(Date.now() - periodDays * 86_400_000).toISOString();

  const { data, error } = await supabase
    .from("van_sales")
    .select("customer_id, total, balance, sold_at, status, customers(code, name)")
    .gte("sold_at", since)
    .neq("status", "void");

  if (error) return failed("reports", error, "The customer report could not be built.");

  const by = new Map<string, SalesByCustomerRow>();
  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    const id = row.customer_id as string;
    const customer = row.customers as { code?: string; name?: string } | null;
    const entry = by.get(id) ?? {
      customerId: id,
      code: customer?.code ?? "",
      name: customer?.name ?? "Unknown customer",
      saleCount: 0, revenue: 0, outstanding: 0, lastBought: null,
    };
    entry.saleCount += 1;
    entry.revenue += parseAmount(row.total as string);
    entry.outstanding += parseAmount(row.balance as string);
    const at = row.sold_at as string;
    if (!entry.lastBought || at > entry.lastBought) entry.lastBought = at;
    by.set(id, entry);
  }

  return { ok: true, data: [...by.values()].sort((a, b) => b.revenue - a.revenue) };
}

export interface SalesByVanRow {
  vanId: string;
  vanCode: string;
  registration: string;
  saleCount: number;
  revenue: number;
  cash: number;
  credit: number;
}

export async function salesByVan(periodDays = 30): Promise<Result<SalesByVanRow[]>> {
  const supabase = await createSupabaseServerClient();
  const since = new Date(Date.now() - periodDays * 86_400_000).toISOString();

  const { data, error } = await supabase
    .from("van_sales")
    .select("van_id, total, sale_type, status, vans(code, registration_no)")
    .gte("sold_at", since)
    .neq("status", "void");

  if (error) return failed("reports", error, "The van report could not be built.");

  const by = new Map<string, SalesByVanRow>();
  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    const id = row.van_id as string;
    const van = row.vans as { code?: string; registration_no?: string } | null;
    const entry = by.get(id) ?? {
      vanId: id,
      vanCode: van?.code ?? "Van",
      registration: van?.registration_no ?? "",
      saleCount: 0, revenue: 0, cash: 0, credit: 0,
    };
    const total = parseAmount(row.total as string);
    entry.saleCount += 1;
    entry.revenue += total;
    if (row.sale_type === "cash") entry.cash += total; else entry.credit += total;
    by.set(id, entry);
  }

  return { ok: true, data: [...by.values()].sort((a, b) => b.revenue - a.revenue) };
}

export interface SalesByMethodRow {
  method: string;
  label: string;
  count: number;
  amount: number;
}

const METHOD_WORDS: Record<string, string> = {
  cash: "Cash",
  mobile_money: "Mobile money",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  card: "Card",
};

/**
 * How the money actually came in.
 *
 * Needs the payment breakdown from 0025. Without it every sale looks
 * like cash, which was the assumption before that migration - so rather
 * than reporting a number that is wrong, the report says it is
 * unavailable.
 */
export async function salesByMethod(periodDays = 30): Promise<Result<SalesByMethodRow[]>> {
  const { salePaymentMethods } = await getCapabilities();
  if (!salePaymentMethods) {
    return {
      ok: false,
      message:
        "Payment methods need database upgrade 0025. Before it, every sale was " +
        "recorded as cash, so this report would be misleading rather than empty.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const since = new Date(Date.now() - periodDays * 86_400_000).toISOString();

  const { data, error } = await supabase
    .from("van_sale_payments")
    .select("method, amount")
    .gte("created_at", since);

  if (error) return failed("reports", error, "The payment method report could not be built.");

  const by = new Map<string, SalesByMethodRow>();
  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    const method = (row.method as string) ?? "cash";
    const entry = by.get(method)
      ?? { method, label: METHOD_WORDS[method] ?? method, count: 0, amount: 0 };
    entry.count += 1;
    entry.amount += parseAmount(row.amount as string);
    by.set(method, entry);
  }

  return { ok: true, data: [...by.values()].sort((a, b) => b.amount - a.amount) };
}

// ===================================================================
// Stock that is going off
// ===================================================================

export interface ExpiryReportRow {
  batchNumber: string;
  sku: string;
  productName: string;
  warehouseName: string;
  expiresOn: string | null;
  daysToExpiry: number | null;
  qtyRemaining: number;
  status: string;
}

export async function expiryReport(): Promise<Result<ExpiryReportRow[]>> {
  const { batchesAndExpiry } = await getCapabilities();
  if (!batchesAndExpiry) {
    return {
      ok: false,
      message:
        "Expiry tracking needs database upgrade 0024. " +
        "Run database/UPGRADE_0024_BATCHES_AND_EXPIRY.sql, then reload.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("batch_expiry_status")
    .select("*")
    .gt("qty_remaining", 0)
    .in("status", ["expired", "expiring"])
    .order("expires_on", { ascending: true });

  if (error) return failed("reports", error, "The expiry report could not be built.");

  return {
    ok: true,
    data: ((data ?? []) as unknown as Record<string, unknown>[]).map((b) => ({
      batchNumber: b.batch_number as string,
      sku: b.sku as string,
      productName: b.product_name as string,
      warehouseName: (b.warehouse_name as string) ?? "",
      expiresOn: (b.expires_on as string) ?? null,
      daysToExpiry: b.days_to_expiry === null || b.days_to_expiry === undefined
        ? null
        : Number(b.days_to_expiry),
      qtyRemaining: Number(b.qty_remaining ?? 0),
      status: (b.status as string) ?? "good",
    })),
  };
}

// ===================================================================
// Purchasing
// ===================================================================

export interface PurchasesBySupplierRow {
  supplierId: string;
  code: string;
  name: string;
  orderCount: number;
  ordered: number;
  received: number;
  invoiced: number;
  awaitingReview: number;
}

export async function purchasesBySupplier(): Promise<Result<PurchasesBySupplierRow[]>> {
  const { supplierSubmissions } = await getCapabilities();
  if (!supplierSubmissions) {
    return {
      ok: false,
      message:
        "Supplier payables need database upgrade 0031. " +
        "Run database/UPGRADE_0031_SUPPLIER_SUBMISSIONS.sql, then reload.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("supplier_payables")
    .select("*")
    .order("received_value", { ascending: false });

  if (error) return failed("reports", error, "The supplier report could not be built.");

  return {
    ok: true,
    data: ((data ?? []) as unknown as Record<string, unknown>[]).map((s) => ({
      supplierId: s.supplier_id as string,
      code: (s.supplier_code as string) ?? "",
      name: (s.supplier_name as string) ?? "Supplier",
      orderCount: Number(s.open_orders ?? 0),
      ordered: parseAmount(s.on_order_value as string),
      received: parseAmount(s.received_value as string),
      invoiced: parseAmount(s.invoiced_value as string),
      awaitingReview: Number(s.invoices_awaiting_review ?? 0),
    })),
  };
}

// ===================================================================
// The van round
// ===================================================================

export interface ReconciliationReportRow {
  reconNumber: string;
  vanCode: string;
  driverName: string;
  status: string;
  expectedCash: number;
  actualCash: number;
  cashVariance: number;
  expectedMomo: number;
  stockVariance: number;
  submittedAt: string | null;
}

export async function reconciliationReport(
  periodDays = 30,
): Promise<Result<ReconciliationReportRow[]>> {
  const supabase = await createSupabaseServerClient();
  const since = new Date(Date.now() - periodDays * 86_400_000).toISOString();

  const { data, error } = await supabase
    .from("reconciliation_variances")
    .select("*")
    .gte("submitted_at", since)
    .order("submitted_at", { ascending: false });

  if (error) return failed("reports", error, "The reconciliation report could not be built.");

  return {
    ok: true,
    data: ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      reconNumber: r.recon_number as string,
      vanCode: (r.van_code as string) ?? "",
      driverName: (r.driver_name as string) ?? "",
      status: (r.status as string) ?? "submitted",
      expectedCash: parseAmount(r.expected_cash as string),
      actualCash: parseAmount(r.actual_cash as string),
      cashVariance: parseAmount(r.cash_variance as string),
      // expected_momo arrived in 0025; older rows simply have none.
      expectedMomo: parseAmount(r.expected_momo as string),
      stockVariance: parseAmount(r.stock_variance as string),
      submittedAt: (r.submitted_at as string) ?? null,
    })),
  };
}
