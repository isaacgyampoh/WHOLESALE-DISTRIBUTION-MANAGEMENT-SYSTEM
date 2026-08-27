import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseAmount } from "@/lib/utils/format";

/**
 * What a driver needs to see about their own round.
 *
 * Every query runs under the driver's session, so row level security
 * already limits results to their van and their load. No filter here is
 * a security control - each one is there to make the intent obvious and
 * the query cheap.
 *
 * The sales figures are the sales made FROM THE VAN, by the salesperson
 * crewed with the driver. A driver does not sell, so a driver_id filter
 * on van_sales would now return nothing at all.
 */
export interface DriverSummary {
  vanId: string | null;
  vanCode: string | null;
  vanRegistration: string | null;
  loadNumber: string | null;
  loadStatus: string | null;
  openingFloat: number;
  lineCount: number;
  unitsOnVan: number;
  vanStockValue: number;
  cashSalesToday: number;
  creditSalesToday: number;
  salesCountToday: number;
  collectionsToday: number;
}

function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function getDriverSummary(userId: string): Promise<DriverSummary> {
  const supabase = await createSupabaseServerClient();
  const since = startOfToday();

  // The assignment resolves the van first: everything else is scoped to
  // it, and a driver with no van has nothing to show.
  const { data: assignment } = await supabase
    .from("van_assignments")
    .select("van_id, vans!van_assignments_van_id_fkey(code, registration_no)")
    .eq("member_id", userId)
    .is("unassigned_at", null)
    .maybeSingle();

  const vanId = (assignment?.van_id as string | undefined) ?? null;

  const [load, stock, sales, collections] = await Promise.all([
    supabase
      .from("van_loads")
      .select("load_number, status, opening_float")
      .eq("driver_id", userId)
      .in("status", ["loaded", "dispatched"])
      .order("load_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("van_stock_summary").select("qty_on_hand, stock_value"),
    vanId
      ? supabase
          .from("van_sales")
          .select("sale_type, total")
          .eq("van_id", vanId)
          .eq("status", "completed")
          .gte("sold_at", since)
      : Promise.resolve({ data: [] as { sale_type: string; total: string }[] }),
    supabase
      .from("credit_transactions")
      .select("amount")
      .eq("type", "payment")
      .gte("occurred_at", since),
  ]);

  const van = assignment?.vans as
    | { code?: string; registration_no?: string }
    | { code?: string; registration_no?: string }[]
    | null
    | undefined;
  // PostgREST returns an embedded row as an object or a single-element
  // array depending on the relationship it infers.
  const vanRow = Array.isArray(van) ? van[0] : van;

  const stockRows = stock.data ?? [];
  const saleRows = (sales.data ?? []) as { sale_type: string; total: string | number }[];

  return {
    vanId,
    vanCode: vanRow?.code ?? null,
    vanRegistration: vanRow?.registration_no ?? null,
    loadNumber: (load.data?.load_number as string | undefined) ?? null,
    loadStatus: (load.data?.status as string | undefined) ?? null,
    openingFloat: parseAmount(load.data?.opening_float),
    lineCount: stockRows.length,
    unitsOnVan: stockRows.reduce((sum, r) => sum + Number(r.qty_on_hand ?? 0), 0),
    vanStockValue: stockRows.reduce((sum, r) => sum + parseAmount(r.stock_value), 0),
    cashSalesToday: saleRows
      .filter((s) => s.sale_type === "cash")
      .reduce((sum, s) => sum + parseAmount(s.total), 0),
    creditSalesToday: saleRows
      .filter((s) => s.sale_type === "credit")
      .reduce((sum, s) => sum + parseAmount(s.total), 0),
    salesCountToday: saleRows.length,
    // Collections are stored as negative ledger entries.
    collectionsToday: Math.abs(
      (collections.data ?? []).reduce((sum, c) => sum + parseAmount(c.amount), 0),
    ),
  };
}
