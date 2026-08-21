import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseAmount } from "@/lib/utils/format";

/**
 * Dashboard read model.
 *
 * Every figure comes from the database under the caller's own session,
 * so row level security decides what is counted. A category manager's
 * totals therefore cover their categories, not the company - the number
 * on screen matches what that person is accountable for.
 *
 * Counts use head:true so the rows are never shipped to the server.
 */
export interface DashboardMetrics {
  todaysCashSales: number;
  todaysCreditSales: number;
  todaysSaleCount: number;
  outstandingReceivables: number;
  overdueCustomers: number;
  warehouseStockValue: number;
  vanStockValue: number;
  lowStockCount: number;
  activeVans: number;
  activeDrivers: number;
  pendingReconciliations: number;
  openVariances: number;
}

export interface VarianceRow {
  id: string;
  reconNumber: string;
  vanCode: string;
  driverName: string;
  cashVariance: number;
  stockVariance: number;
  status: string;
  submittedAt: string | null;
}

export interface LowStockRow {
  productId: string;
  sku: string;
  name: string;
  qtyAvailable: number;
  reorderPoint: number;
  reorderQty: number;
}

function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const supabase = await createSupabaseServerClient();
  const since = startOfToday();

  const [
    todaySales,
    credit,
    stock,
    vanStock,
    vans,
    drivers,
    recons,
    variances,
  ] = await Promise.all([
    supabase.from("van_sales").select("sale_type, total").eq("status", "completed").gte("sold_at", since),
    supabase.from("customer_credit_position").select("ledger_balance, days_past_due"),
    supabase.from("stock_summary").select("stock_value, qty_available, reorder_point, needs_reorder"),
    supabase.from("van_stock_summary").select("stock_value"),
    supabase.from("vans").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("van_assignments").select("id", { count: "exact", head: true }).is("unassigned_at", null),
    supabase.from("van_reconciliations").select("id", { count: "exact", head: true }).eq("status", "submitted"),
    supabase.from("reconciliation_variances").select("id", { count: "exact", head: true }).in("status", ["submitted", "draft"]),
  ]);

  const sales = todaySales.data ?? [];
  const creditRows = credit.data ?? [];
  const stockRows = stock.data ?? [];

  return {
    todaysCashSales: sales
      .filter((s) => s.sale_type === "cash")
      .reduce((sum, s) => sum + parseAmount(s.total), 0),
    todaysCreditSales: sales
      .filter((s) => s.sale_type === "credit")
      .reduce((sum, s) => sum + parseAmount(s.total), 0),
    todaysSaleCount: sales.length,
    outstandingReceivables: creditRows.reduce(
      (sum, c) => sum + Math.max(parseAmount(c.ledger_balance), 0),
      0,
    ),
    overdueCustomers: creditRows.filter((c) => (c.days_past_due ?? 0) > 0).length,
    warehouseStockValue: stockRows.reduce((sum, s) => sum + parseAmount(s.stock_value), 0),
    vanStockValue: (vanStock.data ?? []).reduce((sum, s) => sum + parseAmount(s.stock_value), 0),
    lowStockCount: stockRows.filter((s) => s.needs_reorder).length,
    activeVans: vans.count ?? 0,
    activeDrivers: drivers.count ?? 0,
    pendingReconciliations: recons.count ?? 0,
    openVariances: variances.count ?? 0,
  };
}

export async function getOpenVariances(limit = 6): Promise<VarianceRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("reconciliation_variances")
    .select("id, recon_number, van_code, driver_name, cash_variance, stock_variance, status, submitted_at")
    .in("status", ["submitted", "draft"])
    .order("submitted_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  return (data ?? []).map((r) => ({
    id: r.id as string,
    reconNumber: r.recon_number as string,
    vanCode: r.van_code as string,
    driverName: r.driver_name as string,
    cashVariance: parseAmount(r.cash_variance),
    stockVariance: parseAmount(r.stock_variance),
    status: r.status as string,
    submittedAt: (r.submitted_at as string | null) ?? null,
  }));
}

export async function getLowStock(limit = 6): Promise<LowStockRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("stock_summary")
    .select("product_id, sku, name, qty_available, reorder_point, reorder_qty")
    .eq("needs_reorder", true)
    .order("qty_available", { ascending: true })
    .limit(limit);

  return (data ?? []).map((r) => ({
    productId: r.product_id as string,
    sku: r.sku as string,
    name: r.name as string,
    qtyAvailable: Number(r.qty_available ?? 0),
    reorderPoint: Number(r.reorder_point ?? 0),
    reorderQty: Number(r.reorder_qty ?? 0),
  }));
}
