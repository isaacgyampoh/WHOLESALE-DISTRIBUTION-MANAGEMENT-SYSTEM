"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { recordAudit } from "@/lib/audit";
import { getCapabilities } from "@/lib/db/capabilities";

/**
 * Counting the shelf and making the system agree with it.
 *
 * This is how stock gets in here at all. Adjusting one product at a
 * time from its own page is fine for a correction and hopeless for the
 * first day, when there are two hundred lines on the shelf and none in
 * the system - which is exactly where this business is standing.
 *
 * What is submitted is what was COUNTED, not a difference. A person
 * holding a clipboard knows how many are on the shelf; working out
 * whether that is nine more or four fewer than the system thinks is
 * arithmetic they should not have to do, and the place mistakes come
 * from. The difference is computed here, against the level read in the
 * same breath.
 */

export interface CountLine {
  productId: string;
  /** Whole units physically there - sealed cartons, boxes, bags. */
  counted: number;
  /**
   * Loose pieces physically there, counted separately because they are
   * separate. Absent for a product with no pack size, where there is no
   * such thing as a loose piece.
   */
  countedPieces?: number;
}

export interface CountResult {
  ok: boolean;
  message?: string;
  /** Lines that actually moved, for the confirmation. */
  applied?: number;
  increased?: number;
  decreased?: number;
  unchanged?: number;
}

const MAX_LINES = 500;

export async function applyStockCountAction(input: {
  warehouseId: string;
  reason: string;
  lines: CountLine[];
}): Promise<CountResult> {
  const actor = await requirePermission("inventory.adjust");

  const reason = input.reason?.trim();
  if (!input.warehouseId) return { ok: false, message: "Choose a warehouse." };
  // A movement without a reason is an unexplained change, which is the
  // one thing an audited ledger must not contain.
  if (!reason) return { ok: false, message: "Say why the stock is changing." };
  if (!input.lines?.length) return { ok: false, message: "Nothing was counted." };
  if (input.lines.length > MAX_LINES) {
    return { ok: false, message: `Count up to ${MAX_LINES} lines at a time.` };
  }

  for (const line of input.lines) {
    if (!Number.isInteger(line.counted) || line.counted < 0) {
      return { ok: false, message: "Counted quantities must be whole numbers, zero or more." };
    }
    if (line.countedPieces !== undefined &&
        (!Number.isInteger(line.countedPieces) || line.countedPieces < 0)) {
      return { ok: false, message: "Counted quantities must be whole numbers, zero or more." };
    }
  }

  const admin = createSupabaseAdminClient();

  const { data: warehouse } = await admin
    .from("warehouses").select("id, org_id, name").eq("id", input.warehouseId).maybeSingle();
  if (!warehouse || warehouse.org_id !== actor.organizationId) {
    return { ok: false, message: "That warehouse could not be found." };
  }

  // Every product named must be ours. Checked as a set rather than one
  // at a time: a count is hundreds of lines and this is one query.
  const ids = [...new Set(input.lines.map((l) => l.productId))];
  const { data: products } = await admin
    .from("products").select("id, sku, name, org_id").in("id", ids);

  const mine = new Map(
    (products ?? [])
      .filter((p) => p.org_id === actor.organizationId)
      .map((p) => [p.id as string, p]),
  );
  if (mine.size !== ids.length) {
    return { ok: false, message: "Some of those products could not be found." };
  }

  const capabilities = await getCapabilities();

  // The levels as they stand, to work out what each line moves by.
  const { data: levels } = await admin
    .from("inventory")
    .select(capabilities.loosePieces
      ? "product_id, qty_on_hand, qty_pieces"
      : "product_id, qty_on_hand")
    .eq("warehouse_id", input.warehouseId)
    .in("product_id", ids);

  const rows = (levels ?? []) as unknown as {
    product_id: string; qty_on_hand: number | null; qty_pieces?: number | null;
  }[];

  const onHand = new Map(rows.map((l) => [l.product_id, Number(l.qty_on_hand ?? 0)]));
  const onHandPieces = new Map(rows.map((l) => [l.product_id, Number(l.qty_pieces ?? 0)]));

  // Only what actually differs becomes a movement. A count that agrees
  // with the system is a fact worth knowing and not a change worth
  // recording - writing a zero movement for every line would bury the
  // real ones in the ledger.
  const movements: Record<string, unknown>[] = [];
  let increased = 0, decreased = 0, unchanged = 0;

  for (const line of input.lines) {
    const unitDelta = line.counted - (onHand.get(line.productId) ?? 0);
    const pieceDelta = capabilities.loosePieces && line.countedPieces !== undefined
      ? line.countedPieces - (onHandPieces.get(line.productId) ?? 0)
      : 0;

    if (unitDelta === 0 && pieceDelta === 0) { unchanged++; continue; }

    // The two halves can disagree about which way they went: a shelf can
    // hold one carton fewer and twelve pieces more than the system
    // believed, because somebody opened one and told nobody. A single
    // movement carries one direction, so a line like that becomes two -
    // which is also the honest record of what was found.
    const write = (units: number, pieces: number, up: boolean) => {
      movements.push({
        org_id: actor.organizationId,
        product_id: line.productId,
        warehouse_id: input.warehouseId,
        type: up ? "stocktake_in" : "stocktake_out",
        quantity: units,
        ...(capabilities.loosePieces ? { pieces } : {}),
        reason,
        reference_type: "stock_count",
        created_by: actor.id,
      });
    };

    const sameWay = unitDelta === 0 || pieceDelta === 0 ||
                    (unitDelta > 0) === (pieceDelta > 0);

    if (sameWay) {
      const up = (unitDelta > 0 || pieceDelta > 0);
      write(Math.abs(unitDelta), Math.abs(pieceDelta), up);
    } else {
      write(unitDelta > 0 ? unitDelta : 0, pieceDelta > 0 ? pieceDelta : 0, true);
      write(unitDelta < 0 ? -unitDelta : 0, pieceDelta < 0 ? -pieceDelta : 0, false);
    }

    // Counted as one line moving, not one per movement written: the
    // person who counted made one correction to one product.
    if (unitDelta + pieceDelta > 0) increased++; else decreased++;
  }

  if (movements.length === 0) {
    return {
      ok: true, applied: 0, increased: 0, decreased: 0, unchanged,
      message: "Everything counted matches what the system already held.",
    };
  }

  // One insert. The trigger on stock_movements applies each one to
  // inventory, so the levels and the ledger cannot disagree - and a
  // failure leaves neither half-written.
  const { error } = await admin.from("stock_movements").insert(movements);

  if (error) {
    console.error("[inventory] stock count failed", error);
    return { ok: false, message: "The count could not be saved. Please try again." };
  }

  await recordAudit(actor, {
    action: "stock.adjusted",
    targetType: "warehouse",
    targetId: input.warehouseId,
    targetLabel: warehouse.name as string,
    after: {
      via: "stock_count",
      reason,
      lines_counted: input.lines.length,
      lines_changed: movements.length,
      increased,
      decreased,
    },
  });

  revalidatePath("/inventory");
  revalidatePath("/inventory/movements");
  revalidatePath("/products");

  return { ok: true, applied: movements.length, increased, decreased, unchanged };
}
