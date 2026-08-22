import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseAmount } from "@/lib/utils/format";
import { type Result, failed } from "@/lib/query/result";
import { getCapabilities } from "@/lib/db/capabilities";

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

  const capabilities = await getCapabilities();

  const [warehouses, stock] = await Promise.all([
    supabase
      .from("warehouses")
      .select("id, code, name, city, address, is_default, is_active")
      .order("name"),
    // Cost is only ever read through the masking view. Without it the
    // quantities still come back and the value reads zero - a warehouse
    // page that works, showing nobody the margin.
    capabilities.maskedProductPricing
      ? supabase
          .from("inventory")
          .select("warehouse_id, qty_on_hand, products_priced(cost_price)")
      : supabase
          .from("inventory")
          .select("warehouse_id, qty_on_hand"),
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
    trackBatches: boolean; trackExpiry: boolean;
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
      "purchase_order_items(id, quantity, qty_received, " +
      "products(name, sku, track_batches, track_expiry))",
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
        const product = i.products as {
          name?: string; sku?: string; track_batches?: boolean; track_expiry?: boolean;
        } | null;
        return {
          id: i.id as string,
          productName: product?.name ?? "Unknown product",
          sku: product?.sku ?? "",
          ordered: Number(i.quantity ?? 0),
          received: Number(i.qty_received ?? 0),
          trackBatches: Boolean(product?.track_batches),
          trackExpiry: Boolean(product?.track_expiry),
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

export interface BatchRow {
  batchId: string;
  productId: string;
  sku: string;
  productName: string;
  warehouseName: string;
  batchNumber: string;
  manufacturedOn: string | null;
  expiresOn: string | null;
  qtyReceived: number;
  qtyRemaining: number;
  daysToExpiry: number | null;
  status: "expired" | "expiring" | "good" | "no_expiry";
}

export interface ExpirySummary {
  expiredBatches: number;
  expiredUnits: number;
  expiringBatches: number;
  expiringUnits: number;
  goodBatches: number;
}

/**
 * Batches, newest problem first.
 *
 * Ordered by how long is left rather than by name: the reason anyone
 * opens this screen is to find what is about to go off.
 */
export async function listBatches(
  filters: { status?: string; search?: string } = {},
): Promise<Result<BatchRow[]>> {
  const capabilities = await getCapabilities();
  // Not an error: the database simply does not have batches yet. The
  // screen says which script adds them.
  if (!capabilities.batchesAndExpiry) return { ok: true, data: [] };

  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("batch_expiry_status")
    .select("*")
    .gt("qty_remaining", 0)
    .order("expires_on", { ascending: true, nullsFirst: false })
    .limit(500);

  if (filters.status && filters.status !== "all") query = query.eq("status", filters.status);

  const search = filters.search?.trim();
  if (search) {
    const safe = search.replace(/[%,()]/g, " ");
    query = query.or(`product_name.ilike.%${safe}%,batch_number.ilike.%${safe}%,sku.ilike.%${safe}%`);
  }

  const { data, error } = await query;
  if (error) return failed("batches", error, "Batches could not be loaded.");

  return {
    ok: true,
    data: ((data ?? []) as unknown as Record<string, unknown>[]).map((b) => ({
      batchId: b.batch_id as string,
      productId: b.product_id as string,
      sku: (b.sku as string) ?? "",
      productName: (b.product_name as string) ?? "",
      warehouseName: (b.warehouse_name as string) ?? "",
      batchNumber: (b.batch_number as string) ?? "",
      manufacturedOn: (b.manufactured_on as string | null) ?? null,
      expiresOn: (b.expires_on as string | null) ?? null,
      qtyReceived: Number(b.qty_received ?? 0),
      qtyRemaining: Number(b.qty_remaining ?? 0),
      daysToExpiry: b.days_to_expiry === null || b.days_to_expiry === undefined
        ? null : Number(b.days_to_expiry),
      status: b.status as BatchRow["status"],
    })),
  };
}

export async function getExpirySummary(): Promise<Result<ExpirySummary>> {
  const capabilities = await getCapabilities();
  if (!capabilities.batchesAndExpiry) {
    return {
      ok: true,
      data: {
        expiredBatches: 0, expiredUnits: 0,
        expiringBatches: 0, expiringUnits: 0, goodBatches: 0,
      },
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("expiry_summary").select("*").maybeSingle();
  if (error) return failed("expiry", error, "The expiry summary could not be loaded.");

  return {
    ok: true,
    data: {
      expiredBatches: Number(data?.expired_batches ?? 0),
      expiredUnits: Number(data?.expired_units ?? 0),
      expiringBatches: Number(data?.expiring_batches ?? 0),
      expiringUnits: Number(data?.expiring_units ?? 0),
      goodBatches: Number(data?.good_batches ?? 0),
    },
  };
}
