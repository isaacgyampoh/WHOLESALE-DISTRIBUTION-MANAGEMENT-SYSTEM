import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseAmount } from "@/lib/utils/format";
import { type Result, failed } from "@/lib/query/result";

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
  revenue: number;
}

export async function salesByProduct(periodDays = 30): Promise<Result<SalesByProductRow[]>> {
  const supabase = await createSupabaseServerClient();
  const since = new Date(Date.now() - periodDays * 86_400_000).toISOString();

  const { data, error } = await supabase
    .from("van_sale_items")
    .select("product_id, quantity, line_total, products(sku, name), van_sales!inner(sold_at, status)")
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
      revenue: 0,
    };
    entry.quantity += Number(row.quantity ?? 0);
    entry.revenue += parseAmount(row.line_total as string);
    by.set(id, entry);
  }

  return { ok: true, data: [...by.values()].sort((a, b) => b.revenue - a.revenue) };
}

export interface SalesByDriverRow {
  driverId: string;
  driverName: string;
  saleCount: number;
  revenue: number;
  cash: number;
  credit: number;
  outstanding: number;
}

export async function salesByDriver(periodDays = 30): Promise<Result<SalesByDriverRow[]>> {
  const supabase = await createSupabaseServerClient();
  const since = new Date(Date.now() - periodDays * 86_400_000).toISOString();

  const { data, error } = await supabase
    .from("van_sales")
    .select("driver_id, sale_type, total, balance, status, profiles(full_name)")
    .gte("sold_at", since)
    .neq("status", "void");

  if (error) return failed("reports", error, "The driver report could not be built.");

  const by = new Map<string, SalesByDriverRow>();
  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    const id = row.driver_id as string;
    const entry = by.get(id) ?? {
      driverId: id,
      driverName: (row.profiles as { full_name?: string } | null)?.full_name ?? "Unknown driver",
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
  value: number;
}

export async function inventoryValueReport(): Promise<Result<InventoryValueRow[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("products_priced")
    .select("id, categories(name), inventory(qty_on_hand), cost_price, is_active")
    .eq("is_active", true);

  if (error) return failed("reports", error, "The inventory report could not be built.");

  const by = new Map<string, InventoryValueRow>();
  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    const name = (row.categories as { name?: string } | null)?.name ?? "Uncategorised";
    const units = ((row.inventory as Array<{ qty_on_hand: number }> | null) ?? [])
      .reduce((s, i) => s + Number(i.qty_on_hand ?? 0), 0);
    const entry = by.get(name) ?? { categoryName: name, productLines: 0, units: 0, value: 0 };
    entry.productLines += 1;
    entry.units += units;
    entry.value += units * parseAmount(row.cost_price as string);
    by.set(name, entry);
  }

  return { ok: true, data: [...by.values()].sort((a, b) => b.value - a.value) };
}
