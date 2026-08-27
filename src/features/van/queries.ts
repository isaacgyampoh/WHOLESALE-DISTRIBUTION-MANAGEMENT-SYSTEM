import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseAmount } from "@/lib/utils/format";

/**
 * The crew's view of their own van.
 *
 * Row level security already limits every one of these queries to the
 * van the caller is crewed on, so there is no van id to pass and none to
 * forge. A manager calling this sees nothing, which is correct: a manager
 * has no van.
 */

export interface VanCrewMember {
  profileId: string;
  name: string;
  crewRole: "driver" | "salesperson";
}

export interface VanStockLine {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  beforeSales: number;
  soldToday: number;
  remaining: number;
  stockValue: number;
}

export interface VanSaleSummary {
  saleId: string;
  saleNumber: string;
  soldAt: string;
  customerName: string;
  salespersonName: string | null;
  saleType: string;
  total: number;
  units: number;
}

export interface MyVan {
  vanId: string;
  code: string;
  registration: string;
  myCrewRole: "driver" | "salesperson";
  crew: VanCrewMember[];
  loadNumber: string | null;
  loadStatus: string | null;
  openingFloat: number;
  stock: VanStockLine[];
  salesToday: VanSaleSummary[];
  unitsSoldToday: number;
  cashSalesToday: number;
  creditSalesToday: number;
}

function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function getMyVan(userId: string): Promise<MyVan | null> {
  const supabase = await createSupabaseServerClient();

  const { data: assignment } = await supabase
    .from("van_assignments")
    .select("van_id, crew_role, vans!van_assignments_van_id_fkey(code, registration_no)")
    .eq("member_id", userId)
    .is("unassigned_at", null)
    .maybeSingle();

  if (!assignment?.van_id) return null;
  const vanId = assignment.van_id as string;
  const van = embedded(assignment.vans);

  const since = startOfToday();

  const [crew, activity, load, sales] = await Promise.all([
    supabase
      .from("van_assignments")
      .select("member_id, crew_role, profiles!van_assignments_member_id_fkey(full_name)")
      .eq("van_id", vanId)
      .is("unassigned_at", null),
    supabase
      .from("van_day_activity")
      .select("product_id, sku, product_name, unit_of_measure, qty_before_sales, qty_sold_today, qty_remaining, stock_value")
      .eq("van_id", vanId),
    supabase
      .from("van_loads")
      .select("load_number, status, opening_float")
      .eq("van_id", vanId)
      .in("status", ["loaded", "dispatched"])
      .order("load_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("sale_lines")
      .select("sale_id, sale_number, sold_at, customer_name, salesperson_name, sale_type, sale_total, quantity")
      .eq("van_id", vanId)
      .eq("status", "completed")
      .gte("sold_at", since)
      .order("sold_at", { ascending: false }),
  ]);

  // sale_lines is one row per line; fold it back into one row per sale
  // so the driver reads "three sales today", not "seven lines".
  const bySale = new Map<string, VanSaleSummary>();
  for (const line of sales.data ?? []) {
    const id = line.sale_id as string;
    const existing = bySale.get(id);
    if (existing) {
      existing.units += Number(line.quantity ?? 0);
      continue;
    }
    bySale.set(id, {
      saleId: id,
      saleNumber: line.sale_number as string,
      soldAt: line.sold_at as string,
      customerName: (line.customer_name as string) ?? "-",
      salespersonName: (line.salesperson_name as string | null) ?? null,
      saleType: line.sale_type as string,
      total: parseAmount(line.sale_total),
      units: Number(line.quantity ?? 0),
    });
  }
  const salesToday = [...bySale.values()];

  const stock: VanStockLine[] = (activity.data ?? [])
    .map((r) => ({
      productId: r.product_id as string,
      sku: r.sku as string,
      name: r.product_name as string,
      unit: (r.unit_of_measure as string) ?? "each",
      beforeSales: Number(r.qty_before_sales ?? 0),
      soldToday: Number(r.qty_sold_today ?? 0),
      remaining: Number(r.qty_remaining ?? 0),
      stockValue: parseAmount(r.stock_value),
    }))
    // A line that is empty and sold nothing today is finished business.
    .filter((r) => r.remaining !== 0 || r.soldToday !== 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    vanId,
    code: String(van?.code ?? "Your van"),
    registration: String(van?.registration_no ?? ""),
    myCrewRole: (assignment.crew_role as "driver" | "salesperson") ?? "driver",
    crew: (crew.data ?? []).map((m) => ({
      profileId: m.member_id as string,
      name: String(embedded(m.profiles)?.full_name ?? "Unnamed"),
      crewRole: (m.crew_role as "driver" | "salesperson") ?? "driver",
    })),
    loadNumber: (load.data?.load_number as string | undefined) ?? null,
    loadStatus: (load.data?.status as string | undefined) ?? null,
    openingFloat: parseAmount(load.data?.opening_float),
    stock,
    salesToday,
    unitsSoldToday: stock.reduce((n, s) => n + s.soldToday, 0),
    cashSalesToday: salesToday
      .filter((s) => s.saleType === "cash")
      .reduce((n, s) => n + s.total, 0),
    creditSalesToday: salesToday
      .filter((s) => s.saleType === "credit")
      .reduce((n, s) => n + s.total, 0),
  };
}

function embedded(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
}
