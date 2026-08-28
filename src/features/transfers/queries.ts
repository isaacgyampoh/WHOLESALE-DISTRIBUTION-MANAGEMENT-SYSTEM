import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseAmount } from "@/lib/utils/format";
import { getCapabilities } from "@/lib/db/capabilities";
import { type Result, failed } from "@/lib/query/result";

/**
 * Stock moving between warehouses.
 *
 * A transfer is read as a document with a life: raised, agreed,
 * travelling, arrived. The number that matters on a finished one is the
 * gap between what left and what turned up, so it is carried on every
 * row rather than left to be worked out.
 *
 * No cost anywhere. Moving stock between your own depots does not change
 * what it is worth, and a storeman booking in a delivery has no reason
 * to see the margin.
 */

export const PAGE_SIZE = 25;

export const TRANSFER_STATUSES = [
  "draft", "approved", "in_transit", "received", "cancelled",
] as const;

async function requireTransfers(): Promise<{ ok: false; message: string } | null> {
  const { warehouseTransfers } = await getCapabilities();
  if (warehouseTransfers) return null;
  return {
    ok: false,
    message:
      "Warehouse transfers need database upgrade 0027. " +
      "Run database/UPGRADE_0027_TRANSFERS.sql, then reload.",
  };
}

export interface TransferRow {
  id: string;
  transferNumber: string;
  status: string;
  transferDate: string;
  fromWarehouse: string;
  toWarehouse: string;
  lineCount: number;
  qtySent: number;
  qtyReceived: number;
  qtyShort: number;
  /** The loose half of what was sent and what is missing. */
  piecesSent: number;
  piecesShort: number;
  approvedAt: string | null;
  dispatchedAt: string | null;
  receivedAt: string | null;
  approvedByName: string | null;
  receivedByName: string | null;
  notes: string | null;
}

const mapTransfer = (row: Record<string, unknown>): TransferRow => ({
  id: row.id as string,
  transferNumber: row.transfer_number as string,
  status: (row.status as string) ?? "draft",
  transferDate: row.transfer_date as string,
  fromWarehouse: (row.from_warehouse as string) ?? "Unknown",
  toWarehouse: (row.to_warehouse as string) ?? "Unknown",
  lineCount: Number(row.line_count ?? 0),
  qtySent: Number(row.qty_sent ?? 0),
  piecesSent: Number(row.pieces_sent ?? 0),
  qtyReceived: Number(row.qty_received ?? 0),
  qtyShort: Number(row.qty_short ?? 0),
  piecesShort: Number(row.pieces_short ?? 0),
  approvedAt: (row.approved_at as string) ?? null,
  dispatchedAt: (row.dispatched_at as string) ?? null,
  receivedAt: (row.received_at as string) ?? null,
  approvedByName: (row.approved_by_name as string) ?? null,
  receivedByName: (row.received_by_name as string) ?? null,
  notes: (row.notes as string) ?? null,
});

export async function listTransfers(
  filters: { status?: string; search?: string; page?: number } = {},
): Promise<Result<{ transfers: TransferRow[]; total: number; page: number }>> {
  const unavailable = await requireTransfers();
  if (unavailable) return unavailable;

  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, Number(filters.page ?? 1));

  let query = supabase
    .from("stock_transfer_summary")
    .select("*", { count: "exact" })
    .order("transfer_date", { ascending: false })
    .order("transfer_number", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  // "Open" is everything still needing somebody to do something.
  if (filters.status === "open") query = query.in("status", ["draft", "approved", "in_transit"]);
  else if (filters.status && filters.status !== "all") query = query.eq("status", filters.status);

  const search = filters.search?.trim();
  if (search) query = query.ilike("transfer_number", `%${search.replace(/[%,()]/g, " ")}%`);

  const { data, error, count } = await query;
  if (error) return failed("transfers", error, "Transfers could not be loaded.");

  const transfers = ((data ?? []) as unknown as Record<string, unknown>[]).map(mapTransfer);
  return { ok: true, data: { transfers, total: count ?? transfers.length, page } };
}

export interface TransferLine {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  quantity: number;
  qtyReceived: number | null;
  /** What is on hand at the source, so a shortfall is visible before dispatch. */
  available: number;
  notes: string | null;
}

export interface TransferDetail extends TransferRow {
  fromWarehouseId: string;
  toWarehouseId: string;
  cancelledReason: string | null;
  lines: TransferLine[];
}

export async function getTransfer(id: string): Promise<Result<TransferDetail | null>> {
  const unavailable = await requireTransfers();
  if (unavailable) return unavailable;

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("stock_transfer_summary")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return failed("transfers", error, "This transfer could not be loaded.");
  if (!data) return { ok: true, data: null };

  const row = data as unknown as Record<string, unknown>;
  const fromWarehouseId = row.from_warehouse_id as string;

  const [items, reason] = await Promise.all([
    supabase
      .from("stock_transfer_items")
      .select("id, product_id, quantity, pieces, qty_received, qty_received_pieces, notes, " +
              "products(name, sku, unit_of_measure)")
      .eq("transfer_id", id),
    supabase.from("stock_transfers").select("cancelled_reason").eq("id", id).maybeSingle(),
  ]);

  if (items.error) console.error("[transfers] lines", items.error);

  const rows = (items.data ?? []) as unknown as Record<string, unknown>[];

  // What the source warehouse actually holds, so a line that cannot be
  // filled is visible before anybody tries to dispatch it.
  const productIds = rows.map((r) => r.product_id as string);
  const stock = productIds.length
    ? await supabase
        .from("inventory")
        .select("product_id, qty_available")
        .eq("warehouse_id", fromWarehouseId)
        .in("product_id", productIds)
    : { data: [], error: null };

  const availableBy = new Map(
    ((stock.data ?? []) as unknown as Record<string, unknown>[])
      .map((s) => [s.product_id as string, parseAmount(s.qty_available as string)]),
  );

  return {
    ok: true,
    data: {
      ...mapTransfer(row),
      fromWarehouseId,
      toWarehouseId: row.to_warehouse_id as string,
      cancelledReason: (reason.data?.cancelled_reason as string) ?? null,
      lines: rows.map((r) => {
        const product = r.products as
          { name?: string; sku?: string; unit_of_measure?: string } | null;
        return {
          id: r.id as string,
          productId: r.product_id as string,
          productName: product?.name ?? "Item",
          sku: product?.sku ?? "",
          unit: product?.unit_of_measure ?? "unit",
          quantity: Number(r.quantity ?? 0),
          pieces: Number(r.pieces ?? 0),
          qtyReceived: r.qty_received === null || r.qty_received === undefined
            ? null
            : Number(r.qty_received),
          available: availableBy.get(r.product_id as string) ?? 0,
          notes: (r.notes as string) ?? null,
        };
      }),
    },
  };
}

export interface TransferSummary {
  awaitingApproval: number;
  inTransit: number;
  unitsInTransit: number;
  shortThisMonth: number;
}

export async function getTransferSummary(): Promise<Result<TransferSummary>> {
  const unavailable = await requireTransfers();
  if (unavailable) return unavailable;

  const supabase = await createSupabaseServerClient();
  const monthStart = new Date();
  monthStart.setDate(1);

  const { data, error } = await supabase
    .from("stock_transfer_summary")
    .select("status, qty_sent, qty_short, transfer_date, received_at");

  if (error) return failed("transfers", error, "Transfer totals could not be loaded.");

  const rows = ((data ?? []) as unknown as Record<string, unknown>[]);
  const transit = rows.filter((r) => r.status === "in_transit");

  return {
    ok: true,
    data: {
      awaitingApproval: rows.filter((r) => r.status === "draft").length,
      inTransit: transit.length,
      unitsInTransit: transit.reduce((sum, r) => sum + Number(r.qty_sent ?? 0), 0),
      shortThisMonth: rows
        .filter((r) => r.received_at && new Date(r.received_at as string) >= monthStart)
        .reduce((sum, r) => sum + Number(r.qty_short ?? 0), 0),
    },
  };
}

/** Goods that have left one depot and not arrived at the other. */
export async function listStockInTransit(): Promise<Result<{
  transferNumber: string; fromWarehouse: string; toWarehouse: string;
  productName: string; sku: string; quantity: number;
  /** Loose pieces in transit, counted apart from the units. */
  pieces: number;
  daysInTransit: number;
}[]>> {
  const unavailable = await requireTransfers();
  if (unavailable) return unavailable;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("stock_in_transit")
    .select("*")
    .order("days_in_transit", { ascending: false })
    .limit(100);

  if (error) return failed("transfers", error, "Stock in transit could not be loaded.");

  return {
    ok: true,
    data: ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      transferNumber: r.transfer_number as string,
      fromWarehouse: r.from_warehouse as string,
      toWarehouse: r.to_warehouse as string,
      productName: r.product_name as string,
      sku: r.sku as string,
      quantity: Number(r.quantity ?? 0),
      pieces: Number(r.pieces ?? 0),
      daysInTransit: Number(r.days_in_transit ?? 0),
    })),
  };
}

/** Warehouses and stocked products, for raising a transfer. */
export async function getTransferOptions(): Promise<Result<{
  warehouses: { id: string; label: string }[];
  products: { id: string; name: string; sku: string }[];
}>> {
  const supabase = await createSupabaseServerClient();

  const [warehouses, products] = await Promise.all([
    supabase.from("warehouses").select("id, code, name").eq("is_active", true).order("name"),
    supabase.from("products").select("id, name, sku").eq("is_active", true).order("name"),
  ]);

  if (warehouses.error) {
    return failed("transfers", warehouses.error, "Warehouses could not be loaded.");
  }

  return {
    ok: true,
    data: {
      warehouses: (warehouses.data ?? []).map((w) => ({
        id: w.id as string,
        label: `${w.code} · ${w.name}`,
      })),
      products: (products.data ?? []).map((p) => ({
        id: p.id as string,
        name: p.name as string,
        sku: p.sku as string,
      })),
    },
  };
}
