import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseAmount } from "@/lib/utils/format";
import { stockState, type StockState } from "@/lib/catalogue/units";
import { getCapabilities } from "@/lib/db/capabilities";

/**
 * Catalogue and stock reads.
 *
 * Every query runs under the caller's own session. A manager restricted
 * to certain categories gets a shorter list here without this code doing
 * anything about it: can_access_product() decides inside the database,
 * so the same restriction holds for a request that never touches this
 * file.
 */

export type Result<T> = { ok: true; data: T } | { ok: false; message: string };

export interface ProductRow {
  id: string;
  sku: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  unit: string;
  /**
   * Null for anyone whose role does not include pricing, purchasing or
   * accounting. That is decided by the database - `products_priced`
   * masks it - so an interface that forgets to check simply has nothing
   * to show rather than leaking margin.
   */
  costPrice: number | null;
  listPrice: number;
  /** Path in the public product-images bucket, or null. */
  imagePath: string | null;
  reorderPoint: number;
  reorderQty: number;
  isActive: boolean;
  onHand: number;
  reserved: number;
  available: number;
  state: StockState;
  createdAt: string;
  updatedAt: string;
  description: string | null;
  barcode: string | null;
  unitsPerCase: number;
  taxRate: number;
  trackBatches: boolean;
  trackExpiry: boolean;
  shelfLifeDays: number | null;
}

export interface ProductFilters {
  search?: string;
  category?: string;
  status?: string;
  stock?: string;
  page?: number;
}

export const PAGE_SIZE = 25;

const FAILED = "Something went wrong while loading products. Please try again.";

interface InventoryRow { qty_on_hand: number | null; qty_reserved: number | null }

function toProduct(row: Record<string, unknown>): ProductRow {
  const inventory = (row.inventory as InventoryRow[] | null) ?? [];
  const onHand = inventory.reduce((sum, i) => sum + Number(i.qty_on_hand ?? 0), 0);
  const reserved = inventory.reduce((sum, i) => sum + Number(i.qty_reserved ?? 0), 0);
  const available = onHand - reserved;
  const category = row.categories as { name?: string } | null;
  const reorderPoint = Number(row.reorder_point ?? 0);

  return {
    id: row.id as string,
    sku: row.sku as string,
    name: row.name as string,
    categoryId: (row.category_id as string | null) ?? null,
    categoryName: category?.name ?? null,
    unit: (row.unit_of_measure as string) ?? "piece",
    costPrice: row.cost_price === null || row.cost_price === undefined
      ? null
      : parseAmount(row.cost_price as string),
    listPrice: parseAmount(row.list_price as string),
    imagePath: (row.image_path as string) ?? null,
    reorderPoint,
    reorderQty: Number(row.reorder_qty ?? 0),
    isActive: row.is_active as boolean,
    onHand,
    reserved,
    available,
    state: stockState(available, reorderPoint),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    description: (row.description as string | null) ?? null,
    barcode: (row.barcode as string | null) ?? null,
    unitsPerCase: Number(row.units_per_case ?? 1),
    taxRate: parseAmount(row.tax_rate as string),
    trackBatches: Boolean(row.track_batches),
    trackExpiry: Boolean(row.track_expiry),
    shelfLifeDays: row.shelf_life_days === null || row.shelf_life_days === undefined
      ? null : Number(row.shelf_life_days),
  };
}

/**
 * The columns to ask for, given what this database has.
 *
 * Cost is only ever requested from `products_priced`, which masks it per
 * role. Against a database without that view the column is not asked for
 * at all - so a schema that is behind shows nobody the margin rather
 * than falling back to the raw column and showing everybody.
 */
function productSelect(capabilities: {
  maskedProductPricing: boolean; batchesAndExpiry: boolean; productImages: boolean;
}): string {
  const columns = [
    "id", "sku", "barcode", "name", "description", "category_id",
    "unit_of_measure", "units_per_case", "list_price", "tax_rate",
    "reorder_point", "reorder_qty", "is_active", "created_at", "updated_at",
  ];
  // Absent before migration 0037. Asked for only when it is there, so a
  // database behind the application returns products rather than an
  // error about an unknown column.
  if (capabilities.productImages) columns.push("image_path");
  if (capabilities.maskedProductPricing) columns.push("cost_price");
  if (capabilities.batchesAndExpiry) {
    columns.push("track_batches", "track_expiry", "shelf_life_days");
  }
  return `${columns.join(", ")}, categories(name), inventory(qty_on_hand, qty_reserved)`;
}

/** The view where cost is masked, or the table where it is not asked for. */
function productSource(capabilities: { maskedProductPricing: boolean }): string {
  return capabilities.maskedProductPricing ? "products_priced" : "products";
}

export async function listProducts(
  filters: ProductFilters = {},
): Promise<Result<{ products: ProductRow[]; total: number; page: number }>> {
  const supabase = await createSupabaseServerClient();
  const capabilities = await getCapabilities();
  const page = Math.max(1, Number(filters.page ?? 1));

  let query = supabase
    .from(productSource(capabilities))
    // One request with the category and stock embedded, rather than a
    // query per row.
    .select(productSelect(capabilities), { count: "exact" })
    .order("name", { ascending: true });

  if (filters.category && filters.category !== "all") {
    query = query.eq("category_id", filters.category);
  }
  if (filters.status === "active") query = query.eq("is_active", true);
  if (filters.status === "inactive") query = query.eq("is_active", false);

  const search = filters.search?.trim();
  if (search) {
    const safe = search.replace(/[%,()]/g, " ");
    query = query.or(`name.ilike.%${safe}%,sku.ilike.%${safe}%,barcode.ilike.%${safe}%`);
  }

  // Stock state is derived from quantities across warehouses, so it is
  // applied after the rows arrive. Everything cheaper to narrow has
  // already been narrowed by the database.
  const narrowing = filters.stock && filters.stock !== "all";
  if (!narrowing) {
    query = query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  }

  const { data, error, count } = await query;

  if (error) {
    console.error("[catalogue] product list failed", error);
    return { ok: false, message: FAILED };
  }

  let products = ((data ?? []) as unknown as Record<string, unknown>[]).map(toProduct);
  let total = count ?? products.length;

  if (narrowing) {
    products = products.filter((p) => p.state === filters.stock);
    total = products.length;
    products = products.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  }

  return { ok: true, data: { products, total, page } };
}

export async function getProduct(id: string): Promise<Result<ProductRow | null>> {
  const supabase = await createSupabaseServerClient();
  const capabilities = await getCapabilities();
  const { data, error } = await supabase
    .from(productSource(capabilities))
    .select(productSelect(capabilities))
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[catalogue] product detail failed", error);
    return { ok: false, message: FAILED };
  }
  return { ok: true, data: data ? toProduct(data as unknown as Record<string, unknown>) : null };
}

export interface CategoryRow {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  productCount: number;
  /** Units on hand across every product in this category. */
  stockUnits: number;
  /**
   * What that stock is worth at cost, or null for a role not allowed to
   * know. stock_summary already masks it per caller through
   * product_cost(), so this is the same figure the rest of the system
   * uses rather than a second opinion about it.
   */
  stockValue: number | null;
}

export async function listCategories(includeInactive = true): Promise<Result<CategoryRow[]>> {
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("categories")
    .select("id, name, description, is_active")
    .order("name", { ascending: true });
  if (!includeInactive) query = query.eq("is_active", true);

  // Counted separately rather than embedded as `products(count)`.
  //
  // The embed makes PostgREST read the products table directly, and 0023
  // withdrew table-level SELECT on it - cost price lives there. So the
  // embed fails with "permission denied for table products" for every
  // role, which is the products screen refusing to load at all.
  //
  // products_priced is the masked view every other read already goes
  // through, and counting rows in it needs no privilege the caller does
  // not already hold.
  // stock_summary is the existing valuation: it groups inventory by
  // product, carries category_id, and computes stock_value as
  // product_cost(id) * qty_on_hand - already null for a caller who may
  // not see cost. Counting and valuing from one read keeps the category
  // total and the product rows in agreement by construction.
  const [categories, stock] = await Promise.all([
    query,
    supabase
      .from("stock_summary")
      .select("category_id, qty_on_hand, stock_value")
      .eq("is_active", true),
  ]);

  if (categories.error) {
    console.error("[catalogue] category list failed", categories.error);
    return { ok: false, message: "Something went wrong while loading categories." };
  }

  // A failure here costs the numbers, not the list. A category screen
  // without totals is far better than no screen.
  if (stock.error) console.error("[catalogue] category totals failed", stock.error);

  const totals = new Map<string, { count: number; units: number; value: number | null }>();
  for (const row of (stock.data ?? []) as Record<string, unknown>[]) {
    const id = row.category_id as string | null;
    if (!id) continue;

    const entry = totals.get(id) ?? { count: 0, units: 0, value: null };
    entry.count += 1;
    entry.units += Number(row.qty_on_hand ?? 0);

    // Null means "not allowed to know", and one unknown line makes the
    // whole total unknowable - a partial sum presented as a total would
    // be a wrong number rather than a withheld one.
    const line = row.stock_value;
    if (line !== null && line !== undefined) {
      entry.value = (entry.value ?? 0) + parseAmount(line as string);
    }
    totals.set(id, entry);
  }

  return {
    ok: true,
    data: ((categories.data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      description: (row.description as string | null) ?? null,
      isActive: row.is_active as boolean,
      productCount: totals.get(row.id as string)?.count ?? 0,
      stockUnits: totals.get(row.id as string)?.units ?? 0,
      stockValue: totals.get(row.id as string)?.value ?? null,
    })),
  };
}

export interface InventorySummary {
  totalProducts: number;
  lowStock: number;
  outOfStock: number;
  totalUnits: number;
  stockValue: number;
}

export async function getInventorySummary(): Promise<Result<InventorySummary>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("stock_summary")
    .select("qty_available, qty_on_hand, stock_value, reorder_point");

  if (error) {
    console.error("[catalogue] inventory summary failed", error);
    return { ok: false, message: "Something went wrong while loading inventory." };
  }

  const rows = data ?? [];
  return {
    ok: true,
    data: {
      totalProducts: rows.length,
      lowStock: rows.filter((r) => {
        const available = Number(r.qty_available ?? 0);
        return available > 0 && available <= Number(r.reorder_point ?? 0);
      }).length,
      outOfStock: rows.filter((r) => Number(r.qty_available ?? 0) <= 0).length,
      totalUnits: rows.reduce((sum, r) => sum + Number(r.qty_on_hand ?? 0), 0),
      stockValue: rows.reduce((sum, r) => sum + parseAmount(r.stock_value as string), 0),
    },
  };
}

export interface MovementRow {
  id: string;
  occurredAt: string;
  productName: string;
  productSku: string;
  type: string;
  quantity: number;
  reason: string | null;
  referenceType: string | null;
  actorName: string | null;
  warehouseName: string | null;
}

export interface MovementFilters {
  productId?: string;
  type?: string;
  search?: string;
  periodDays?: number;
}

export async function listMovements(
  filters: MovementFilters = {},
  limit = 100,
): Promise<Result<MovementRow[]>> {
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("stock_movements")
    .select(
      "id, created_at, type, quantity, reason, reference_type, " +
      "products(name, sku), warehouses(name), profiles(full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (filters.productId) query = query.eq("product_id", filters.productId);
  if (filters.type && filters.type !== "all") query = query.eq("type", filters.type);
  if (filters.periodDays) {
    const since = new Date(Date.now() - filters.periodDays * 86_400_000).toISOString();
    query = query.gte("created_at", since);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[catalogue] movements failed", error);
    return { ok: false, message: "Something went wrong while loading stock movements." };
  }

  const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => {
    const product = row.products as { name?: string; sku?: string } | null;
    const warehouse = row.warehouses as { name?: string } | null;
    const actor = row.profiles as { full_name?: string } | null;
    return {
      id: row.id as string,
      occurredAt: row.created_at as string,
      productName: product?.name ?? "Unknown product",
      productSku: product?.sku ?? "",
      type: row.type as string,
      quantity: Number(row.quantity ?? 0),
      reason: (row.reason as string | null) ?? null,
      referenceType: (row.reference_type as string | null) ?? null,
      actorName: actor?.full_name ?? null,
      warehouseName: warehouse?.name ?? null,
    };
  });

  const search = filters.search?.trim().toLowerCase();
  return {
    ok: true,
    data: search
      ? rows.filter((r) =>
          r.productName.toLowerCase().includes(search) ||
          r.productSku.toLowerCase().includes(search))
      : rows,
  };
}

export interface WarehouseOption { id: string; name: string; isDefault: boolean }

export async function listWarehouses(): Promise<Result<WarehouseOption[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("warehouses").select("id, name, is_default").eq("is_active", true).order("name");

  if (error) {
    console.error("[catalogue] warehouses failed", error);
    return { ok: false, message: "Something went wrong while loading warehouses." };
  }
  return {
    ok: true,
    data: (data ?? []).map((w) => ({
      id: w.id as string, name: w.name as string, isDefault: w.is_default as boolean,
    })),
  };
}
