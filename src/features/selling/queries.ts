import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseAmount } from "@/lib/utils/format";

/**
 * What a salesperson may sell, and from where.
 *
 * The location is never taken from the page, a query string or a form
 * field. It is resolved by resolve_sales_location() from the caller's
 * session and their crew assignment, and record_sale() resolves it again
 * for itself when the sale is submitted. This module only asks the
 * database the same question the database will answer again.
 */

export type SalesLocationKind = "van" | "warehouse";

export interface SalesContext {
  kind: SalesLocationKind;
  vanId: string | null;
  warehouseId: string | null;
  loadId: string | null;
  locationName: string;
  /** Why selling is not possible, when it is not. */
  blockedReason?: string;
}

export interface SellableProduct {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  unitPrice: number;
  taxRate: number;
  available: number;
}

export interface CustomerOption {
  id: string;
  code: string;
  name: string;
  creditLimit: number;
  outstanding: number;
  creditAvailable: number;
}

/**
 * The caller's authorized selling location, or null with the reason.
 *
 * resolve_sales_location raises for a driver, for a salesperson with no
 * assignment and for anyone whose role does not sell. Those messages are
 * written for the person reading them, so they are carried through
 * rather than replaced with "forbidden".
 */
export async function getMySalesContext(): Promise<SalesContext | null> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("resolve_sales_location", {
    p_warehouse_id: null,
  });

  if (error) {
    return {
      kind: "warehouse",
      vanId: null,
      warehouseId: null,
      loadId: null,
      locationName: "",
      blockedReason: error.message,
    };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { kind: string; van_id: string | null; warehouse_id: string | null; load_id: string | null }
    | undefined;

  if (!row) return null;

  const kind: SalesLocationKind = row.kind === "van" ? "van" : "warehouse";
  let locationName = "";

  if (kind === "van" && row.van_id) {
    const { data: van } = await supabase
      .from("vans")
      .select("code, registration_no")
      .eq("id", row.van_id)
      .maybeSingle();
    locationName = van ? `${van.code} (${van.registration_no})` : "your van";
  } else if (row.warehouse_id) {
    const { data: wh } = await supabase
      .from("warehouses")
      .select("name")
      .eq("id", row.warehouse_id)
      .maybeSingle();
    locationName = (wh?.name as string) ?? "your location";
  }

  return {
    kind,
    vanId: row.van_id,
    warehouseId: row.warehouse_id,
    loadId: row.load_id,
    locationName,
  };
}

/** What is physically at that location right now, at the selling price. */
export async function getSellableStock(context: SalesContext): Promise<SellableProduct[]> {
  const supabase = await createSupabaseServerClient();

  if (context.kind === "van" && context.vanId) {
    const [stock, loadPrices] = await Promise.all([
      supabase
        .from("van_inventory")
        .select("product_id, qty_on_hand, products!van_inventory_product_id_fkey(sku, name, unit_of_measure, list_price, tax_rate)")
        .eq("van_id", context.vanId)
        .gt("qty_on_hand", 0),
      context.loadId
        ? supabase.from("van_load_items").select("product_id, unit_price").eq("load_id", context.loadId)
        : Promise.resolve({ data: [] as { product_id: string; unit_price: string }[] }),
    ]);

    // The price was fixed when the van was loaded, so a salesperson in
    // the field cannot quietly discount. List price is the fallback for
    // stock that reached the van some other way.
    const fixed = new Map(
      ((loadPrices.data ?? []) as { product_id: string; unit_price: string | number }[]).map((r) => [
        r.product_id,
        parseAmount(r.unit_price),
      ]),
    );

    return (stock.data ?? [])
      .map((row) => {
        const product = embedded(row.products);
        if (!product) return null;
        return {
          productId: row.product_id as string,
          sku: String(product.sku ?? ""),
          name: String(product.name ?? ""),
          unit: String(product.unit_of_measure ?? "each"),
          unitPrice: fixed.get(row.product_id as string) ?? parseAmount(product.list_price as string),
          taxRate: parseAmount(product.tax_rate as string),
          available: Number(row.qty_on_hand ?? 0),
        };
      })
      .filter((p): p is SellableProduct => p !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  if (!context.warehouseId) return [];

  const { data } = await supabase
    .from("inventory")
    .select("product_id, qty_available, products!inventory_product_id_fkey(sku, name, unit_of_measure, list_price, tax_rate, is_active)")
    .eq("warehouse_id", context.warehouseId)
    .gt("qty_available", 0);

  return (data ?? [])
    .map((row) => {
      const product = embedded(row.products);
      if (!product || product.is_active === false) return null;
      return {
        productId: row.product_id as string,
        sku: String(product.sku ?? ""),
        name: String(product.name ?? ""),
        unit: String(product.unit_of_measure ?? "each"),
        unitPrice: parseAmount(product.list_price as string),
        taxRate: parseAmount(product.tax_rate as string),
        available: Number(row.qty_available ?? 0),
      };
    })
    .filter((p): p is SellableProduct => p !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getCustomers(): Promise<CustomerOption[]> {
  const supabase = await createSupabaseServerClient();

  const [customers, positions] = await Promise.all([
    supabase
      .from("customers")
      .select("id, code, name, credit_limit")
      .eq("is_active", true)
      .order("name")
      .limit(500),
    supabase
      .from("customer_credit_position")
      .select("customer_id, ledger_balance, credit_available"),
  ]);

  const credit = new Map(
    (positions.data ?? []).map((p) => [
      p.customer_id as string,
      {
        outstanding: parseAmount(p.ledger_balance),
        available: parseAmount(p.credit_available),
      },
    ]),
  );

  return (customers.data ?? []).map((c) => {
    const limit = parseAmount(c.credit_limit);
    const position = credit.get(c.id as string);
    return {
      id: c.id as string,
      code: c.code as string,
      name: c.name as string,
      creditLimit: limit,
      outstanding: position?.outstanding ?? 0,
      creditAvailable: position?.available ?? limit,
    };
  });
}

function embedded(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
}

export interface SalespersonSummary {
  context: SalesContext | null;
  linesAvailable: number;
  unitsAvailable: number;
  salesToday: number;
  cashToday: number;
  creditToday: number;
}

/**
 * A salesperson's own day.
 *
 * Deliberately small: the figures are theirs, from their own location.
 * The company-wide tiles on the management dashboard read views a
 * salesperson cannot see, so for them they would render as a wall of
 * zeros rather than anything true.
 */
export async function getSalespersonSummary(userId: string): Promise<SalespersonSummary> {
  const supabase = await createSupabaseServerClient();
  const context = await getMySalesContext();

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [stock, sales] = await Promise.all([
    context && !context.blockedReason ? getSellableStock(context) : Promise.resolve([]),
    supabase
      .from("van_sales")
      .select("sale_type, total")
      .eq("salesperson_id", userId)
      .eq("status", "completed")
      .gte("sold_at", startOfDay.toISOString()),
  ]);

  const rows = sales.data ?? [];

  return {
    context,
    linesAvailable: stock.length,
    unitsAvailable: stock.reduce((n, p) => n + p.available, 0),
    salesToday: rows.length,
    cashToday: rows
      .filter((r) => r.sale_type === "cash")
      .reduce((n, r) => n + parseAmount(r.total), 0),
    creditToday: rows
      .filter((r) => r.sale_type === "credit")
      .reduce((n, r) => n + parseAmount(r.total), 0),
  };
}
