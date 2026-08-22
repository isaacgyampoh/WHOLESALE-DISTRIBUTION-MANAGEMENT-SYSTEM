import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseAmount } from "@/lib/utils/format";
import { type Result, failed } from "@/lib/query/result";

/**
 * The driver's own round.
 *
 * Everything here is scoped to the signed-in driver by row level
 * security - my_van_id() and the driver policies decide what comes
 * back, so passing a different driver's id would return nothing rather
 * than somebody else's day.
 */

export interface DriverRound {
  van: { id: string; code: string; registrationNo: string } | null;
  load: {
    id: string;
    loadNumber: string;
    status: string;
    openingFloat: number;
    loadedValue: number;
    lineCount: number;
  } | null;
  stockUnits: number;
  stockValue: number;
  cashSales: number;
  creditSales: number;
  saleCount: number;
  collections: number;
  reconciliation: {
    id: string;
    reconNumber: string;
    status: string;
    expectedCash: number;
  } | null;
  hasSubmittedReturn: boolean;
}

export async function getDriverRound(driverId: string): Promise<Result<DriverRound>> {
  const supabase = await createSupabaseServerClient();

  const { data: assignment, error: assignmentError } = await supabase
    .from("van_assignments")
    .select("van_id, vans(id, code, registration_no)")
    .is("unassigned_at", null)
    .maybeSingle();

  if (assignmentError) {
    return failed("driver", assignmentError, "Your round could not be loaded.");
  }

  const vanRow = assignment?.vans as
    { id?: string; code?: string; registration_no?: string } | null;
  const van = vanRow?.id
    ? { id: vanRow.id, code: vanRow.code ?? "", registrationNo: vanRow.registration_no ?? "" }
    : null;

  if (!van) {
    return {
      ok: true,
      data: {
        van: null, load: null, stockUnits: 0, stockValue: 0,
        cashSales: 0, creditSales: 0, saleCount: 0, collections: 0,
        reconciliation: null, hasSubmittedReturn: false,
      },
    };
  }

  const [loadRes, stockRes, salesRes, reconRes, returnRes, collectionsRes] = await Promise.all([
    supabase
      .from("van_loads")
      .select("id, load_number, status, opening_float, van_load_items(qty_loaded, unit_price)")
      .eq("van_id", van.id)
      .in("status", ["loaded", "dispatched", "returned"])
      .order("load_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("van_stock_summary")
      .select("qty_on_hand, stock_value")
      .eq("van_id", van.id),
    supabase
      .from("van_sales")
      .select("sale_type, total, status")
      .eq("van_id", van.id)
      .neq("status", "void")
      .gte("sold_at", new Date(Date.now() - 86_400_000).toISOString()),
    supabase
      .from("van_reconciliations")
      .select("id, recon_number, status, expected_cash")
      .eq("van_id", van.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("van_returns")
      .select("id, status")
      .eq("van_id", van.id)
      .in("status", ["submitted", "approved"])
      .order("returned_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("credit_transactions")
      .select("amount")
      .eq("type", "payment")
      .eq("created_by", driverId)
      .gte("occurred_at", new Date(Date.now() - 86_400_000).toISOString()),
  ]);

  const loadRow = loadRes.data as Record<string, unknown> | null;
  const items = (loadRow?.van_load_items as Array<{ qty_loaded: number; unit_price: string }> | null) ?? [];
  const sales = salesRes.data ?? [];

  return {
    ok: true,
    data: {
      van,
      load: loadRow
        ? {
            id: loadRow.id as string,
            loadNumber: loadRow.load_number as string,
            status: loadRow.status as string,
            openingFloat: parseAmount(loadRow.opening_float as string),
            loadedValue: items.reduce(
              (s, i) => s + Number(i.qty_loaded ?? 0) * parseAmount(i.unit_price), 0),
            lineCount: items.length,
          }
        : null,
      stockUnits: (stockRes.data ?? []).reduce((s, r) => s + Number(r.qty_on_hand ?? 0), 0),
      stockValue: (stockRes.data ?? []).reduce((s, r) => s + parseAmount(r.stock_value as string), 0),
      cashSales: sales.filter((s) => s.sale_type === "cash")
        .reduce((s, r) => s + parseAmount(r.total as string), 0),
      creditSales: sales.filter((s) => s.sale_type === "credit")
        .reduce((s, r) => s + parseAmount(r.total as string), 0),
      saleCount: sales.length,
      collections: (collectionsRes.data ?? [])
        .reduce((s, r) => s + Math.abs(parseAmount(r.amount as string)), 0),
      reconciliation: reconRes.data
        ? {
            id: reconRes.data.id as string,
            reconNumber: reconRes.data.recon_number as string,
            status: reconRes.data.status as string,
            expectedCash: parseAmount(reconRes.data.expected_cash as string),
          }
        : null,
      hasSubmittedReturn: Boolean(returnRes.data),
    },
  };
}
