import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseAmount } from "@/lib/utils/format";
import { type Result, failed } from "@/lib/query/result";

/**
 * Warehouses and inbound goods.
 *
 * Every query runs under the caller's own session, so a manager
 * restricted to certain categories sees a shorter list without this
 * file doing anything about it.
 */

export interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  city: string | null;
  address: string | null;
  isDefault: boolean;
  isActive: boolean;
  productLines: number;
  unitsOnHand: number;
  stockValue: number;
}

/**
 * Warehouses with what each one holds.
 *
 * Stock is counted here rather than in the database because `inventory`
 * carries quantity per warehouse while value lives on the product. One
 * request for each side beats a request per warehouse.
 */
export async function listWarehouses(): Promise<Result<WarehouseRow[]>> {
  const supabase = await createSupabaseServerClient();

  const [warehouses, stock] = await Promise.all([
    supabase
      .from("warehouses")
      .select("id, code, name, city, address, is_default, is_active")
      .order("name"),
    supabase
      .from("inventory")
      // products_priced masks cost per caller, so a warehouse's value
      // comes back as zero for a role that may not see it rather than
      // failing the whole page.
      .select("warehouse_id, qty_on_hand, products_priced(cost_price)"),
  ]);

  if (warehouses.error) {
    return failed("warehouses", warehouses.error, "Warehouses could not be loaded.");
  }

  const held = new Map<string, { lines: number; units: number; value: number }>();
  for (const row of (stock.data ?? []) as unknown as Record<string, unknown>[]) {
    const id = row.warehouse_id as string;
    const qty = Number(row.qty_on_hand ?? 0);
    if (qty === 0) continue;
    const product = row.products_priced as { cost_price?: string | null } | null;
    const entry = held.get(id) ?? { lines: 0, units: 0, value: 0 };
    entry.lines += 1;
    entry.units += qty;
    entry.value += qty * parseAmount(product?.cost_price);
    held.set(id, entry);
  }

  return {
    ok: true,
    data: (warehouses.data ?? []).map((w) => {
      const totals = held.get(w.id as string) ?? { lines: 0, units: 0, value: 0 };
      return {
        id: w.id as string,
        code: w.code as string,
        name: w.name as string,
        city: (w.city as string | null) ?? null,
        address: (w.address as string | null) ?? null,
        isDefault: w.is_default as boolean,
        isActive: w.is_active as boolean,
        productLines: totals.lines,
        unitsOnHand: totals.units,
        stockValue: totals.value,
      };
    }),
  };
}

export interface PurchaseOrderRow {
  id: string;
  poNumber: string;
  supplierName: string;
  warehouseName: string;
  status: string;
  orderDate: string;
  expectedDate: string | null;
  total: number;
  lineCount: number;
  qtyOrdered: number;
  qtyReceived: number;
  /** Enough to book goods in without a second request per order. */
  lines: {
    id: string; productName: string; sku: string; ordered: number; received: number;
  }[];
}

export interface PurchaseFilters {
  status?: string;
  search?: string;
  page?: number;
}

export const PAGE_SIZE = 25;

export async function listPurchaseOrders(
  filters: PurchaseFilters = {},
): Promise<Result<{ orders: PurchaseOrderRow[]; total: number; page: number }>> {
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, Number(filters.page ?? 1));

  let query = supabase
    .from("purchase_orders")
    .select(
      "id, po_number, status, order_date, expected_date, total, " +
      "suppliers(name), warehouses(name), " +
      "purchase_order_items(id, quantity, qty_received, products(name, sku))",
      { count: "exact" },
    )
    .order("order_date", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (filters.status && filters.status !== "all") query = query.eq("status", filters.status);

  const search = filters.search?.trim();
  if (search) query = query.ilike("po_number", `%${search.replace(/[%,()]/g, " ")}%`);

  const { data, error, count } = await query;
  if (error) return failed("purchasing", error, "Purchase orders could not be loaded.");

  const orders = ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => {
    const items =
      (row.purchase_order_items as Array<Record<string, unknown>> | null) ?? [];
    return {
      id: row.id as string,
      poNumber: row.po_number as string,
      supplierName: (row.suppliers as { name?: string } | null)?.name ?? "Unknown supplier",
      warehouseName: (row.warehouses as { name?: string } | null)?.name ?? "-",
      status: row.status as string,
      orderDate: row.order_date as string,
      expectedDate: (row.expected_date as string | null) ?? null,
      total: parseAmount(row.total as string),
      lineCount: items.length,
      qtyOrdered: items.reduce((s, i) => s + Number(i.quantity ?? 0), 0),
      qtyReceived: items.reduce((s, i) => s + Number(i.qty_received ?? 0), 0),
      lines: items.map((i) => {
        const product = i.products as { name?: string; sku?: string } | null;
        return {
          id: i.id as string,
          productName: product?.name ?? "Unknown product",
          sku: product?.sku ?? "",
          ordered: Number(i.quantity ?? 0),
          received: Number(i.qty_received ?? 0),
        };
      }),
    };
  });

  return { ok: true, data: { orders, total: count ?? orders.length, page } };
}

export interface PurchaseSummary {
  openOrders: number;
  awaitingDelivery: number;
  committedValue: number;
  suppliers: number;
}

export async function getPurchaseSummary(): Promise<Result<PurchaseSummary>> {
  const supabase = await createSupabaseServerClient();

  const [orders, suppliers] = await Promise.all([
    supabase.from("purchase_orders").select("status, total, expected_date"),
    supabase.from("suppliers").select("id", { count: "exact", head: true }).eq("is_active", true),
  ]);

  if (orders.error) return failed("purchasing", orders.error, "Purchasing could not be loaded.");

  // "Open" means the goods have not all arrived: a received or cancelled
  // order is no longer something the warehouse is waiting on.
  const settled = ["received", "cancelled"];
  const open = (orders.data ?? []).filter((o) => !settled.includes(o.status as string));
  const today = new Date().toISOString().slice(0, 10);

  return {
    ok: true,
    data: {
      openOrders: open.length,
      awaitingDelivery: open.filter((o) => o.expected_date && (o.expected_date as string) <= today).length,
      committedValue: open.reduce((s, o) => s + parseAmount(o.total as string), 0),
      suppliers: suppliers.count ?? 0,
    },
  };
}

export interface SupplierRow {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  paymentTermsDays: number;
  leadTimeDays: number;
  isActive: boolean;
}

export async function listSuppliers(): Promise<Result<SupplierRow[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("suppliers")
    .select("id, code, name, contact_name, phone, payment_terms_days, lead_time_days, is_active")
    .order("name");

  if (error) return failed("suppliers", error, "Suppliers could not be loaded.");

  return {
    ok: true,
    data: (data ?? []).map((s) => ({
      id: s.id as string,
      code: s.code as string,
      name: s.name as string,
      contactName: (s.contact_name as string | null) ?? null,
      phone: (s.phone as string | null) ?? null,
      paymentTermsDays: Number(s.payment_terms_days ?? 0),
      leadTimeDays: Number(s.lead_time_days ?? 0),
      isActive: s.is_active as boolean,
    })),
  };
}
