import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseAmount } from "@/lib/utils/format";

/**
 * Catalogue and stock read models.
 *
 * Everything runs under the caller's own session, so a scoped manager
 * sees their categories and a field salesperson sees the products on
 * their van - the same answer the database would give any other client.
 *
 * Embedded relationships are named explicitly (categories!products_...)
 * rather than left to PostgREST to infer. A table can reach another by
 * more than one path, and an inferred embed silently picks one.
 */

export interface ProductRow {
  id: string;
  sku: string;
  name: string;
  unit: string;
  categoryName: string | null;
  listPrice: number;
  costPrice: number;
  qtyOnHand: number;
  qtyAvailable: number;
  reorderPoint: number;
  needsReorder: boolean;
  isActive: boolean;
}

export interface WarehouseOption {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
}

export interface CategoryOption {
  id: string;
  name: string;
}

export interface LocationStock {
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  qtyOnHand: number;
  qtyReserved: number;
  qtyAvailable: number;
}

export interface MovementRow {
  id: string;
  type: string;
  quantity: number;
  reason: string | null;
  createdAt: string;
  actorName: string | null;
  locationLabel: string;
}

export interface ProductDetail extends ProductRow {
  barcode: string | null;
  description: string | null;
  taxRate: number;
  unitsPerCase: number;
  reorderQty: number;
  categoryId: string | null;
  locations: LocationStock[];
  movements: MovementRow[];
}

/** Catalogue list with the stock figure the reorder queue keys off. */
export async function getProducts(search?: string): Promise<ProductRow[]> {
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("products")
    .select("id, sku, name, unit_of_measure, list_price, cost_price, reorder_point, is_active, categories!products_category_id_fkey(name)")
    .order("name");

  if (search?.trim()) {
    const term = `%${search.trim()}%`;
    query = query.or(`name.ilike.${term},sku.ilike.${term}`);
  }

  const [products, stock] = await Promise.all([
    query.limit(200),
    supabase.from("stock_summary").select("product_id, qty_on_hand, qty_available, needs_reorder"),
  ]);

  const levels = new Map(
    (stock.data ?? []).map((s) => [
      s.product_id as string,
      {
        onHand: Number(s.qty_on_hand ?? 0),
        available: Number(s.qty_available ?? 0),
        needsReorder: Boolean(s.needs_reorder),
      },
    ]),
  );

  return (products.data ?? []).map((p) => {
    const level = levels.get(p.id as string);
    return {
      id: p.id as string,
      sku: p.sku as string,
      name: p.name as string,
      unit: (p.unit_of_measure as string) ?? "each",
      categoryName: embeddedName(p.categories),
      listPrice: parseAmount(p.list_price),
      costPrice: parseAmount(p.cost_price),
      qtyOnHand: level?.onHand ?? 0,
      qtyAvailable: level?.available ?? 0,
      reorderPoint: Number(p.reorder_point ?? 0),
      needsReorder: level?.needsReorder ?? false,
      isActive: Boolean(p.is_active),
    };
  });
}

export async function getProduct(id: string): Promise<ProductDetail | null> {
  const supabase = await createSupabaseServerClient();

  const { data: p } = await supabase
    .from("products")
    .select("id, sku, barcode, name, description, unit_of_measure, units_per_case, list_price, cost_price, tax_rate, reorder_point, reorder_qty, is_active, category_id, categories!products_category_id_fkey(name)")
    .eq("id", id)
    .maybeSingle();

  if (!p) return null;

  const [locations, movements] = await Promise.all([
    supabase
      .from("product_stock_by_location")
      .select("warehouse_id, warehouse_code, warehouse_name, qty_on_hand, qty_reserved, qty_available")
      .eq("product_id", id)
      .order("warehouse_name"),
    supabase
      .from("stock_movements")
      .select("id, type, quantity, reason, created_at, warehouse_id, van_id, profiles!stock_movements_created_by_fkey(full_name), warehouses!stock_movements_warehouse_id_fkey(code), vans!stock_movements_van_id_fkey(code)")
      .eq("product_id", id)
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  const onHand = (locations.data ?? []).reduce((n, l) => n + Number(l.qty_on_hand ?? 0), 0);
  const available = (locations.data ?? []).reduce((n, l) => n + Number(l.qty_available ?? 0), 0);

  return {
    id: p.id as string,
    sku: p.sku as string,
    name: p.name as string,
    barcode: (p.barcode as string | null) ?? null,
    description: (p.description as string | null) ?? null,
    unit: (p.unit_of_measure as string) ?? "each",
    unitsPerCase: Number(p.units_per_case ?? 1),
    categoryId: (p.category_id as string | null) ?? null,
    categoryName: embeddedName(p.categories),
    listPrice: parseAmount(p.list_price),
    costPrice: parseAmount(p.cost_price),
    taxRate: parseAmount(p.tax_rate),
    reorderPoint: Number(p.reorder_point ?? 0),
    reorderQty: Number(p.reorder_qty ?? 0),
    isActive: Boolean(p.is_active),
    qtyOnHand: onHand,
    qtyAvailable: available,
    needsReorder: available <= Number(p.reorder_point ?? 0),
    locations: (locations.data ?? []).map((l) => ({
      warehouseId: l.warehouse_id as string,
      warehouseCode: l.warehouse_code as string,
      warehouseName: l.warehouse_name as string,
      qtyOnHand: Number(l.qty_on_hand ?? 0),
      qtyReserved: Number(l.qty_reserved ?? 0),
      qtyAvailable: Number(l.qty_available ?? 0),
    })),
    movements: (movements.data ?? []).map((m) => ({
      id: m.id as string,
      type: m.type as string,
      quantity: Number(m.quantity ?? 0),
      reason: (m.reason as string | null) ?? null,
      createdAt: m.created_at as string,
      actorName: embeddedName(m.profiles, "full_name"),
      locationLabel:
        embeddedName(m.warehouses, "code") ?? embeddedName(m.vans, "code") ?? "-",
    })),
  };
}

export async function getWarehouses(): Promise<WarehouseOption[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("warehouses")
    .select("id, code, name, is_default")
    .eq("is_active", true)
    .order("name");

  return (data ?? []).map((w) => ({
    id: w.id as string,
    code: w.code as string,
    name: w.name as string,
    isDefault: Boolean(w.is_default),
  }));
}

export async function getCategories(): Promise<CategoryOption[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("categories").select("id, name").order("name");
  return (data ?? []).map((c) => ({ id: c.id as string, name: c.name as string }));
}

/** Stock at one warehouse, which is what a count or an adjustment works on. */
export async function getWarehouseStock(warehouseId: string) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("product_stock_by_location")
    .select("product_id, sku, product_name, unit_of_measure, qty_on_hand, qty_available")
    .eq("warehouse_id", warehouseId)
    .order("product_name");

  return (data ?? []).map((r) => ({
    productId: r.product_id as string,
    sku: r.sku as string,
    name: r.product_name as string,
    unit: (r.unit_of_measure as string) ?? "each",
    qtyOnHand: Number(r.qty_on_hand ?? 0),
    qtyAvailable: Number(r.qty_available ?? 0),
  }));
}

/**
 * PostgREST returns an embedded row as an object or a one-element array
 * depending on the relationship it infers. Both shapes are handled so a
 * schema change cannot quietly blank a column on screen.
 */
function embeddedName(value: unknown, key = "name"): string | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  const name = (row as Record<string, unknown>)[key];
  return typeof name === "string" ? name : null;
}
