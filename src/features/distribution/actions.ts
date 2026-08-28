"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { getCapabilities } from "@/lib/db/capabilities";
import type { AuthenticatedUser } from "@/types/domain";
import type { DistributionState } from "./state";

/**
 * Van loads, returns and reconciliation.
 *
 * Not one of these actions moves stock or money itself. Each assembles
 * the rows a workflow needs, then calls the database function that owns
 * the rule - dispatch_van_load, approve_van_return, build_reconciliation,
 * approve_reconciliation. Those functions are where "dispatching takes
 * stock off the warehouse and puts it on the van" actually lives, and
 * they are also what the offline sync path calls. Writing the same
 * arithmetic here would give the business two implementations that
 * would eventually disagree.
 *
 * The RPCs run under the caller's own session, so their internal
 * require_role() sees the real caller rather than the service role.
 */

const WHOLE = /^\d{1,9}$/;
const MONEY = /^\d{1,9}(\.\d{1,2})?$/;

function fail(message: string, values?: Record<string, string>): DistributionState {
  return { status: "error", message, values };
}

/** Confirm a row is ours before naming it in a message or an audit entry. */
async function owned(
  actor: AuthenticatedUser,
  table: string,
  id: string,
  columns: string,
): Promise<Record<string, unknown> | null> {
  if (!id) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from(table).select(columns).eq("id", id).maybeSingle();
  const row = data as Record<string, unknown> | null;
  return row && row.org_id === actor.organizationId ? row : null;
}

/**
 * Lines arrive as parallel arrays from a repeating form fieldset:
 * productId[], quantity[] and, where the form offers it, pieces[]. Rows
 * left blank are dropped rather than rejected, so a spare row on the
 * form costs nothing.
 *
 * A line counts when either half carries something. Two cartons and no
 * singles is a line; three singles and no cartons is equally a line;
 * both blank is a row nobody filled in.
 */
function readLines(formData: FormData, quantityField = "quantity", piecesField = "pieces") {
  const ids = formData.getAll("productId").map(String);
  const quantities = formData.getAll(quantityField).map(String);
  const pieces = formData.getAll(piecesField).map(String);
  const lines: { productId: string; quantity: number; pieces: number }[] = [];
  const errors: string[] = [];

  ids.forEach((productId, i) => {
    if (!productId) return;

    const rawUnits = (quantities[i] ?? "").trim();
    const rawPieces = (pieces[i] ?? "").trim();
    if ((!rawUnits || rawUnits === "0") && (!rawPieces || rawPieces === "0")) return;

    if (rawUnits && !WHOLE.test(rawUnits)) {
      errors.push(`Line ${i + 1}: use a whole number.`);
      return;
    }
    if (rawPieces && !WHOLE.test(rawPieces)) {
      errors.push(`Line ${i + 1}: use a whole number of pieces.`);
      return;
    }

    lines.push({
      productId,
      quantity: rawUnits ? Number(rawUnits) : 0,
      pieces: rawPieces ? Number(rawPieces) : 0,
    });
  });

  return { lines, errors };
}

// ===================================================================
// Van loads
// ===================================================================

export async function createLoadAction(
  _prev: DistributionState,
  formData: FormData,
): Promise<DistributionState> {
  const actor = await requirePermission("loads.create");

  const vanId = String(formData.get("vanId") ?? "");
  const driverId = String(formData.get("driverId") ?? "");
  const warehouseId = String(formData.get("warehouseId") ?? "");
  const openingFloat = String(formData.get("openingFloat") ?? "0").trim() || "0";
  const notes = String(formData.get("notes") ?? "").trim();
  const values = { vanId, driverId, warehouseId, openingFloat, notes };
  const fieldErrors: Record<string, string> = {};

  if (!vanId) fieldErrors.vanId = "Choose a van.";
  if (!driverId) fieldErrors.driverId = "Choose a driver.";
  if (!warehouseId) fieldErrors.warehouseId = "Choose the warehouse it loads from.";
  if (!MONEY.test(openingFloat)) fieldErrors.openingFloat = "Use an amount like 200 or 200.00.";

  const { lines, errors } = readLines(formData, "qtyLoaded", "qtyLoadedPieces");
  if (!lines.length) fieldErrors.lines = "Add at least one product to the load.";
  if (errors.length) fieldErrors.lines = errors[0];

  if (Object.keys(fieldErrors).length) {
    return { status: "error", message: "Check the fields below.", values, fieldErrors };
  }

  const van = await owned(actor, "vans", vanId, "id, code, org_id, is_active");
  if (!van) return fail("That van could not be found.", values);
  if (!van.is_active) return fail("That van is not active.", values);

  const warehouse = await owned(actor, "warehouses", warehouseId, "id, name, org_id");
  if (!warehouse) return fail("That warehouse could not be found.", values);

  const driver = await owned(actor, "profiles", driverId, "id, full_name, org_id, role, is_active");
  if (!driver) return fail("That driver could not be found.", values);
  if (!driver.is_active) return fail("That account is not active.", values);

  const admin = createSupabaseAdminClient();

  // A van already carrying an open load cannot take another: the two
  // would share van_inventory and neither could be reconciled.
  const { data: openLoad } = await admin
    .from("van_loads").select("load_number")
    .eq("van_id", vanId).in("status", ["loaded", "dispatched"]).maybeSingle();
  if (openLoad) {
    return fail(
      `${van.code} is still out on ${openLoad.load_number}. Reconcile that round first.`,
      values,
    );
  }

  // Stock has to be there before it can be promised to a van, and each
  // half is judged on its own. Sealed cartons in the depot do not cover
  // a request for loose singles: opening one is a recorded act somebody
  // has to perform first.
  const capabilities = await getCapabilities();
  const shortages: string[] = [];
  for (const line of lines) {
    const { data: level } = await admin
      .from("inventory")
      .select(capabilities.loosePieces
        ? "qty_on_hand, qty_reserved, qty_pieces, products(name)"
        : "qty_on_hand, qty_reserved, products(name)")
      .eq("product_id", line.productId).eq("warehouse_id", warehouseId).maybeSingle();

    const held = level as {
      qty_on_hand?: number; qty_reserved?: number; qty_pieces?: number;
      products?: { name?: string } | null;
    } | null;

    const available = Number(held?.qty_on_hand ?? 0) - Number(held?.qty_reserved ?? 0);
    const availablePieces = Number(held?.qty_pieces ?? 0);
    const name = held?.products?.name ?? "That product";

    if (line.quantity > available) {
      shortages.push(`${name}: ${available} available, ${line.quantity} requested`);
    }
    if (line.pieces > availablePieces) {
      shortages.push(
        `${name}: ${availablePieces} loose pieces available, ${line.pieces} requested` +
        (available > 0 ? " - open a full one first" : ""),
      );
    }
  }
  if (shortages.length) {
    return {
      status: "error", values,
      message: `Not enough stock at ${warehouse.name}.`,
      fieldErrors: { lines: shortages.join("; ") },
    };
  }

  const { data: load, error } = await admin
    .from("van_loads")
    .insert({
      org_id: actor.organizationId, van_id: vanId, driver_id: driverId,
      warehouse_id: warehouseId, status: "draft",
      load_date: new Date().toISOString().slice(0, 10),
      opening_float: Number(openingFloat),
      notes: notes || null, loaded_by: actor.id,
    })
    .select("id, load_number")
    .single();

  if (error || !load) {
    console.error("[distribution] load creation failed", error);
    return fail("The load could not be created. Please try again.", values);
  }

  const { error: lineError } = await admin.from("van_load_items").insert(
    await Promise.all(lines.map(async (line) => {
      const { data: product } = await admin
        .from("products").select("list_price, cost_price").eq("id", line.productId).maybeSingle();
      return {
        org_id: actor.organizationId, load_id: load.id, product_id: line.productId,
        qty_loaded: line.quantity,
        ...(capabilities.loosePieces ? { qty_loaded_pieces: line.pieces } : {}),
        unit_price: product?.list_price ?? 0,
        unit_cost: product?.cost_price ?? 0,
      };
    })),
  );

  if (lineError) {
    console.error("[distribution] load lines failed", lineError);
    // A load with no lines is not a load. Remove it rather than leave a
    // draft nobody can complete.
    await admin.from("van_loads").delete().eq("id", load.id);
    return fail("The load lines could not be saved. Please try again.", values);
  }

  await admin.from("van_loads").update({ status: "loaded" }).eq("id", load.id);

  await recordAudit(actor, {
    action: "load.created",
    targetType: "van_load",
    targetId: load.id,
    targetLabel: load.load_number,
    after: {
      van: van.code, driver: driver.full_name, warehouse: warehouse.name,
      lines: lines.length, opening_float: Number(openingFloat),
    },
  });

  revalidatePath("/loads");
  revalidatePath("/vans");
  return {
    status: "done",
    message: `${load.load_number} is loaded and ready to dispatch.`,
    createdId: load.id,
    createdNumber: load.load_number,
  };
}

/**
 * Dispatch. This is the moment stock leaves the warehouse, so the
 * database function does it; nothing here touches a quantity.
 */
export async function dispatchLoadAction(
  _prev: DistributionState,
  formData: FormData,
): Promise<DistributionState> {
  const actor = await requirePermission("loads.dispatch");
  const loadId = String(formData.get("loadId") ?? "");

  const load = await owned(actor, "van_loads", loadId,
    "id, load_number, org_id, status, driver_confirmed_at, vans(code)");
  if (!load) return fail("That load could not be found.");

  const supabase = await createSupabaseServerClient();

  // The driver signs for what is physically on the van before it goes.
  // Recorded here when a supervisor dispatches on their behalf, which
  // is what happens at a depot counter.
  if (!load.driver_confirmed_at) {
    const admin = createSupabaseAdminClient();
    await admin.from("van_loads")
      .update({ driver_confirmed_at: new Date().toISOString() }).eq("id", loadId);
  }

  const { error } = await supabase.rpc("dispatch_van_load", { p_load_id: loadId });
  if (error) {
    console.error("[distribution] dispatch failed", error);
    return fail(error.message.replace(/^.*?:\s*/, "") || "The load could not be dispatched.");
  }

  await recordAudit(actor, {
    action: "load.dispatched",
    targetType: "van_load",
    targetId: loadId,
    targetLabel: String(load.load_number),
    after: { van: (load.vans as { code?: string } | null)?.code ?? null },
  });

  revalidatePath("/loads");
  revalidatePath("/vans");
  revalidatePath("/inventory");
  return { status: "done", message: `${load.load_number} is on the road.` };
}

export async function cancelLoadAction(
  _prev: DistributionState,
  formData: FormData,
): Promise<DistributionState> {
  const actor = await requirePermission("loads.create");
  const loadId = String(formData.get("loadId") ?? "");

  const load = await owned(actor, "van_loads", loadId, "id, load_number, org_id, status");
  if (!load) return fail("That load could not be found.");

  // Once it is dispatched the stock has moved; cancelling would leave
  // the van holding goods no load accounts for. It comes back through
  // a return instead.
  if (load.status !== "draft" && load.status !== "loaded") {
    return fail(`${load.load_number} is ${load.status} and can no longer be cancelled.`);
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("van_loads")
    .update({ status: "cancelled" }).eq("id", loadId);
  if (error) {
    console.error("[distribution] cancel failed", error);
    return fail("The load could not be cancelled.");
  }

  await recordAudit(actor, {
    action: "load.cancelled",
    targetType: "van_load",
    targetId: loadId,
    targetLabel: String(load.load_number),
    before: { status: load.status },
  });

  revalidatePath("/loads");
  return { status: "done", message: `${load.load_number} was cancelled.` };
}

// ===================================================================
// Returns
// ===================================================================

export async function createReturnAction(
  _prev: DistributionState,
  formData: FormData,
): Promise<DistributionState> {
  const actor = await requirePermission("returns.submit");

  const loadId = String(formData.get("loadId") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();
  const values = { loadId, notes };

  const load = await owned(actor, "van_loads", loadId,
    "id, load_number, org_id, status, van_id, driver_id, warehouse_id");
  if (!load) return fail("That load could not be found.", values);
  if (load.status !== "dispatched") {
    return fail(`${load.load_number} is ${load.status}; only a dispatched load is returned.`, values);
  }

  const admin = createSupabaseAdminClient();

  // What the van is still carrying is what should be coming back. The
  // driver counts against it rather than typing it from memory.
  const { data: onVan } = await admin
    .from("van_inventory").select("product_id, qty_on_hand")
    .eq("van_id", load.van_id).gt("qty_on_hand", 0);

  const expected = new Map((onVan ?? []).map((r) => [r.product_id as string, Number(r.qty_on_hand)]));

  const productIds = formData.getAll("productId").map(String);
  const good = formData.getAll("qtyGood").map(String);
  const damaged = formData.getAll("qtyDamaged").map(String);
  const reasons = formData.getAll("damageReason").map(String);

  const lines: {
    productId: string; expected: number; good: number; damaged: number; reason: string | null;
  }[] = [];

  for (const [i, productId] of productIds.entries()) {
    if (!productId) continue;
    const exp = expected.get(productId) ?? 0;
    const g = (good[i] ?? "0").trim() || "0";
    const d = (damaged[i] ?? "0").trim() || "0";
    if (!WHOLE.test(g) || !WHOLE.test(d)) {
      return { status: "error", message: "Quantities must be whole numbers.", values };
    }
    const gn = Number(g), dn = Number(d);
    if (gn + dn > exp) {
      return {
        status: "error", values,
        message: `More was returned than went out: ${gn + dn} against ${exp} on the van.`,
      };
    }
    lines.push({
      productId, expected: exp, good: gn, damaged: dn,
      reason: dn > 0 ? (reasons[i] ?? "").trim() || "Not stated" : null,
    });
  }

  if (!lines.length) return fail("There is nothing on this van to return.", values);

  const { data: ret, error } = await admin
    .from("van_returns")
    .insert({
      org_id: actor.organizationId, load_id: loadId, van_id: load.van_id,
      driver_id: load.driver_id, warehouse_id: load.warehouse_id,
      status: "draft", returned_at: new Date().toISOString(),
      received_by: actor.id, notes: notes || null,
    })
    .select("id, return_number")
    .single();

  if (error || !ret) {
    console.error("[distribution] return creation failed", error);
    return fail("The return could not be created. Please try again.", values);
  }

  const { error: lineError } = await admin.from("van_return_items").insert(
    lines.map((l) => ({
      org_id: actor.organizationId, return_id: ret.id, product_id: l.productId,
      qty_expected: l.expected, qty_returned_good: l.good,
      qty_damaged: l.damaged, damage_reason: l.reason,
    })),
  );
  if (lineError) {
    console.error("[distribution] return lines failed", lineError);
    await admin.from("van_returns").delete().eq("id", ret.id);
    return fail("The return lines could not be saved. Please try again.", values);
  }

  await admin.from("van_returns").update({ status: "submitted" }).eq("id", ret.id);

  const missing = lines.reduce((s, l) => s + (l.expected - l.good - l.damaged), 0);
  await recordAudit(actor, {
    action: "return.submitted",
    targetType: "van_return",
    targetId: ret.id,
    targetLabel: ret.return_number,
    after: {
      load: load.load_number, lines: lines.length,
      good: lines.reduce((s, l) => s + l.good, 0),
      damaged: lines.reduce((s, l) => s + l.damaged, 0),
      missing,
    },
  });

  revalidatePath("/returns");
  revalidatePath("/loads");
  return {
    status: "done",
    message: `${ret.return_number} submitted for approval.`,
    createdId: ret.id,
    createdNumber: ret.return_number,
  };
}

/** Approval is what puts good stock back in the warehouse. */
export async function approveReturnAction(
  _prev: DistributionState,
  formData: FormData,
): Promise<DistributionState> {
  const actor = await requirePermission("returns.approve");
  const returnId = String(formData.get("returnId") ?? "");

  const ret = await owned(actor, "van_returns", returnId, "id, return_number, org_id, status");
  if (!ret) return fail("That return could not be found.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("approve_van_return", { p_return_id: returnId });
  if (error) {
    console.error("[distribution] return approval failed", error);
    return fail(error.message.replace(/^.*?:\s*/, "") || "The return could not be approved.");
  }

  await recordAudit(actor, {
    action: "return.approved",
    targetType: "van_return",
    targetId: returnId,
    targetLabel: String(ret.return_number),
  });

  revalidatePath("/returns");
  revalidatePath("/inventory");
  revalidatePath("/vans");
  return { status: "done", message: `${ret.return_number} approved; good stock is back in the warehouse.` };
}

// ===================================================================
// Reconciliation
// ===================================================================

/**
 * Raise the reconciliation for a round. The figures are computed by
 * build_reconciliation() from the load, its sales and its return - not
 * typed in, and not recomputed here.
 */
export async function buildReconciliationAction(
  _prev: DistributionState,
  formData: FormData,
): Promise<DistributionState> {
  const actor = await requirePermission("reconciliation.submit");
  const loadId = String(formData.get("loadId") ?? "");

  const load = await owned(actor, "van_loads", loadId, "id, load_number, org_id, status");
  if (!load) return fail("That load could not be found.");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("build_reconciliation", { p_load_id: loadId });
  if (error) {
    console.error("[distribution] reconciliation build failed", error);
    return fail(error.message.replace(/^.*?:\s*/, "") || "The reconciliation could not be prepared.");
  }

  const recon = (Array.isArray(data) ? data[0] : data) as { id?: string; recon_number?: string } | null;
  revalidatePath("/reconciliation");
  return {
    status: "done",
    message: `${recon?.recon_number ?? "The reconciliation"} is ready for the cash count.`,
    createdId: recon?.id,
    createdNumber: recon?.recon_number,
  };
}

export async function submitReconciliationAction(
  _prev: DistributionState,
  formData: FormData,
): Promise<DistributionState> {
  const actor = await requirePermission("reconciliation.submit");

  const reconId = String(formData.get("reconciliationId") ?? "");
  const actualCash = String(formData.get("actualCash") ?? "").trim();
  const explanation = String(formData.get("explanation") ?? "").trim();
  const values = { reconciliationId: reconId, actualCash, explanation };
  const fieldErrors: Record<string, string> = {};

  if (!actualCash) fieldErrors.actualCash = "Enter the cash actually handed in.";
  else if (!MONEY.test(actualCash)) fieldErrors.actualCash = "Use an amount like 2400 or 2400.00.";

  if (Object.keys(fieldErrors).length) {
    return { status: "error", message: "Check the fields below.", values, fieldErrors };
  }

  const recon = await owned(actor, "van_reconciliations", reconId,
    "id, recon_number, org_id, status, expected_cash");
  if (!recon) return fail("That reconciliation could not be found.", values);
  if (recon.status !== "draft") {
    return fail(`${recon.recon_number} has already been submitted.`, values);
  }

  const variance = Number(actualCash) - Number(recon.expected_cash ?? 0);

  // A round that does not balance needs a sentence from the person who
  // ran it. Requiring it here means the supervisor is never looking at
  // a bare number with nobody's account of it.
  if (Math.abs(variance) >= 0.01 && !explanation) {
    return {
      status: "error", values,
      message: "Check the fields below.",
      fieldErrors: {
        explanation: `This is off by ${variance > 0 ? "+" : ""}${variance.toFixed(2)}. Say what happened.`,
      },
    };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("van_reconciliations").update({
    status: "submitted",
    actual_cash: Number(actualCash),
    explanation: explanation || null,
    submitted_by: actor.id,
    submitted_at: new Date().toISOString(),
  }).eq("id", reconId);

  if (error) {
    console.error("[distribution] reconciliation submit failed", error);
    return fail("The reconciliation could not be submitted. Please try again.", values);
  }

  await recordAudit(actor, {
    action: "reconciliation.submitted",
    targetType: "reconciliation",
    targetId: reconId,
    targetLabel: String(recon.recon_number),
    after: {
      expected_cash: Number(recon.expected_cash ?? 0),
      actual_cash: Number(actualCash),
      cash_variance: Number(variance.toFixed(2)),
      explanation: explanation || null,
    },
  });

  revalidatePath("/reconciliation");
  return { status: "done", message: `${recon.recon_number} submitted for approval.` };
}

export async function approveReconciliationAction(
  _prev: DistributionState,
  formData: FormData,
): Promise<DistributionState> {
  const actor = await requirePermission("reconciliation.approve");

  const reconId = String(formData.get("reconciliationId") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  const recon = await owned(actor, "van_reconciliations", reconId,
    "id, recon_number, org_id, status, submitted_by, cash_variance");
  if (!recon) return fail("That reconciliation could not be found.");

  // The person who counted the cash is not the person who signs it off.
  if (recon.submitted_by === actor.id) {
    return fail("You submitted this reconciliation, so somebody else has to approve it.");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("approve_reconciliation", {
    p_recon_id: reconId, p_note: note || null,
  });
  if (error) {
    console.error("[distribution] reconciliation approval failed", error);
    return fail(error.message.replace(/^.*?:\s*/, "") || "The reconciliation could not be approved.");
  }

  await recordAudit(actor, {
    action: "reconciliation.approved",
    targetType: "reconciliation",
    targetId: reconId,
    targetLabel: String(recon.recon_number),
    after: { cash_variance: recon.cash_variance, note: note || null },
  });

  revalidatePath("/reconciliation");
  revalidatePath("/loads");
  return { status: "done", message: `${recon.recon_number} approved and settled.` };
}

export async function rejectReconciliationAction(
  _prev: DistributionState,
  formData: FormData,
): Promise<DistributionState> {
  const actor = await requirePermission("reconciliation.approve");

  const reconId = String(formData.get("reconciliationId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const values = { reconciliationId: reconId, reason };

  if (!reason) {
    return {
      status: "error", message: "Check the fields below.", values,
      fieldErrors: { reason: "Say why it is going back to the driver." },
    };
  }

  const recon = await owned(actor, "van_reconciliations", reconId,
    "id, recon_number, org_id, status");
  if (!recon) return fail("That reconciliation could not be found.", values);
  if (recon.status !== "submitted") {
    return fail(`${recon.recon_number} is ${recon.status} and cannot be rejected.`, values);
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("van_reconciliations").update({
    status: "rejected", rejection_reason: reason,
    approved_by: actor.id, approved_at: new Date().toISOString(),
  }).eq("id", reconId);

  if (error) {
    console.error("[distribution] reconciliation rejection failed", error);
    return fail("The reconciliation could not be rejected.", values);
  }

  await recordAudit(actor, {
    action: "reconciliation.rejected",
    targetType: "reconciliation",
    targetId: reconId,
    targetLabel: String(recon.recon_number),
    after: { reason },
  });

  revalidatePath("/reconciliation");
  return { status: "done", message: `${recon.recon_number} sent back to the driver.` };
}

// ===================================================================
// Vans
// ===================================================================

export async function saveVanAction(
  _prev: DistributionState,
  formData: FormData,
): Promise<DistributionState> {
  const actor = await requirePermission("vans.manage");

  const id = String(formData.get("id") ?? "");
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const registrationNo = String(formData.get("registrationNo") ?? "").trim().toUpperCase();
  const make = String(formData.get("make") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const capacityKg = String(formData.get("capacityKg") ?? "").trim();
  const homeWarehouseId = String(formData.get("homeWarehouseId") ?? "");
  const values = { id, code, registrationNo, make, model, capacityKg, homeWarehouseId };
  const fieldErrors: Record<string, string> = {};

  if (!code) fieldErrors.code = "Give the van a short code.";
  if (!registrationNo) fieldErrors.registrationNo = "Enter the registration number.";
  if (capacityKg && !MONEY.test(capacityKg)) fieldErrors.capacityKg = "Use a number of kilograms.";

  if (Object.keys(fieldErrors).length) {
    return { status: "error", message: "Check the fields below.", values, fieldErrors };
  }

  const admin = createSupabaseAdminClient();
  const row = {
    code, registration_no: registrationNo,
    make: make || null, model: model || null,
    capacity_kg: capacityKg ? Number(capacityKg) : null,
    home_warehouse_id: homeWarehouseId || null,
  };

  if (id) {
    const existing = await owned(actor, "vans", id, "id, code, org_id, registration_no");
    if (!existing) return fail("That van could not be found.", values);

    const { error } = await admin.from("vans").update(row).eq("id", id);
    if (error) {
      console.error("[distribution] van update failed", error);
      return fail(
        error.code === "23505" ? "Another van already uses that code or registration." :
        "The van could not be saved.", values);
    }
    await recordAudit(actor, {
      action: "van.updated", targetType: "van", targetId: id, targetLabel: code,
      before: { code: existing.code, registration_no: existing.registration_no },
      after: row,
    });
    revalidatePath("/vans");
    return { status: "done", message: `${code} saved.` };
  }

  const { data, error } = await admin
    .from("vans").insert({ ...row, org_id: actor.organizationId }).select("id").single();
  if (error || !data) {
    console.error("[distribution] van creation failed", error);
    return fail(
      error?.code === "23505" ? "A van with that code or registration already exists." :
      "The van could not be created.", values);
  }

  await recordAudit(actor, {
    action: "van.created", targetType: "van", targetId: data.id, targetLabel: code, after: row,
  });
  revalidatePath("/vans");
  return { status: "done", message: `${code} added to the fleet.`, createdId: data.id };
}

export async function setVanActiveAction(
  _prev: DistributionState,
  formData: FormData,
): Promise<DistributionState> {
  const actor = await requirePermission("vans.manage");
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";

  const van = await owned(actor, "vans", id, "id, code, org_id, is_active");
  if (!van) return fail("That van could not be found.");

  const admin = createSupabaseAdminClient();

  // Retiring a van that is still carrying stock would strand it.
  if (!active) {
    const { data: held } = await admin
      .from("van_inventory").select("qty_on_hand").eq("van_id", id).gt("qty_on_hand", 0);
    if (held?.length) {
      return fail(`${van.code} is still carrying stock. Bring it back on a return first.`);
    }
  }

  const { error } = await admin.from("vans").update({ is_active: active }).eq("id", id);
  if (error) {
    console.error("[distribution] van status failed", error);
    return fail("The van could not be updated.");
  }

  await recordAudit(actor, {
    action: active ? "van.activated" : "van.deactivated",
    targetType: "van", targetId: id, targetLabel: String(van.code),
    before: { is_active: van.is_active }, after: { is_active: active },
  });

  revalidatePath("/vans");
  return { status: "done", message: `${van.code} is now ${active ? "active" : "inactive"}.` };
}

export async function assignDriverAction(
  _prev: DistributionState,
  formData: FormData,
): Promise<DistributionState> {
  const actor = await requirePermission("vans.manage");
  const vanId = String(formData.get("vanId") ?? "");
  const driverId = String(formData.get("driverId") ?? "");

  const van = await owned(actor, "vans", vanId, "id, code, org_id");
  if (!van) return fail("That van could not be found.");

  const admin = createSupabaseAdminClient();

  // An assignment is a period, not a field: closing the old one keeps
  // the history of who had the van when a discrepancy is investigated.
  await admin.from("van_assignments")
    .update({ unassigned_at: new Date().toISOString() })
    .eq("van_id", vanId).is("unassigned_at", null);

  if (!driverId) {
    await recordAudit(actor, {
      action: "van.driver_assigned", targetType: "van", targetId: vanId,
      targetLabel: String(van.code), after: { driver: null },
    });
    revalidatePath("/vans");
    return { status: "done", message: `${van.code} has no driver assigned.` };
  }

  const driver = await owned(actor, "profiles", driverId, "id, full_name, org_id, is_active");
  if (!driver) return fail("That driver could not be found.");
  if (!driver.is_active) return fail("That account is not active.");

  // A driver holding two vans makes my_van_id() ambiguous, and with it
  // every driver-scoped policy in the schema.
  await admin.from("van_assignments")
    .update({ unassigned_at: new Date().toISOString() })
    .eq("driver_id", driverId).is("unassigned_at", null);

  const { error } = await admin.from("van_assignments").insert({
    org_id: actor.organizationId, van_id: vanId, driver_id: driverId, assigned_by: actor.id,
  });
  if (error) {
    console.error("[distribution] assignment failed", error);
    return fail("The driver could not be assigned.");
  }

  await recordAudit(actor, {
    action: "van.driver_assigned", targetType: "van", targetId: vanId,
    targetLabel: String(van.code), after: { driver: driver.full_name },
  });

  revalidatePath("/vans");
  return { status: "done", message: `${driver.full_name} is now driving ${van.code}.` };
}

/**
 * A customer bringing goods back, or goods going back to a supplier.
 *
 * Both go through record_stock_return(), which moves the stock through
 * the ledger as a customer_return or a supplier_return rather than as an
 * adjustment. That distinction is the whole point: an adjustment says
 * the count was wrong, and these say goods physically moved.
 */
export async function recordStockReturnAction(
  _prev: DistributionState,
  formData: FormData,
): Promise<DistributionState> {
  const actor = await requirePermission("inventory.adjust");

  if (!(await getCapabilities()).supplierSubmissions) {
    return {
      status: "error",
      message:
        "Customer and supplier returns need database upgrade 0031. " +
        "Run database/UPGRADE_0031_SUPPLIER_SUBMISSIONS.sql, then reload.",
    };
  }

  const direction = String(formData.get("direction") ?? "customer");
  const warehouseId = String(formData.get("warehouseId") ?? "");
  const partyId = String(formData.get("partyId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();

  const values = { direction, warehouseId, partyId, reason, notes };
  const errors: Record<string, string> = {};

  if (!warehouseId) errors.warehouseId = "Choose which warehouse.";
  if (!partyId) {
    errors.partyId = direction === "customer"
      ? "Choose which customer is returning them."
      : "Choose which supplier they are going back to.";
  }
  if (!["damaged", "expired", "wrong_item", "customer_return", "unsold", "other"]
        .includes(reason)) {
    errors.reason = "Choose why.";
  }

  const productIds = formData.getAll("productId").map(String);
  const quantities = formData.getAll("quantity").map(String);

  const lines = productIds
    .map((productId, i) => ({ product_id: productId, quantity: Number(quantities[i] ?? 0) }))
    .filter((l) => l.product_id || l.quantity > 0);

  if (lines.length === 0) errors.lines = "Add at least one product.";
  if (lines.some((l) => !l.product_id)) errors.lines = "Every line needs a product.";
  if (lines.some((l) => !Number.isInteger(l.quantity) || l.quantity <= 0)) {
    errors.lines = "Every line needs a whole quantity above zero.";
  }
  if (new Set(lines.map((l) => l.product_id)).size !== lines.length) {
    errors.lines = "The same product is on more than one line. Combine them.";
  }

  if (Object.keys(errors).length) {
    return { status: "error", message: "Check the fields below.", values, fieldErrors: errors };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("record_stock_return", {
    p_warehouse_id: warehouseId,
    p_reason: reason,
    p_lines: lines,
    p_customer_id: direction === "customer" ? partyId : null,
    p_supplier_id: direction === "supplier" ? partyId : null,
    p_notes: notes || null,
  });

  if (error) {
    console.error("[returns] could not be recorded", error);
    // "Only 4 on hand" is something the person can act on, so it is
    // shown rather than replaced with something vaguer.
    return { status: "error", message: error.message, values };
  }

  const entry = (Array.isArray(data) ? data[0] : data) as
    { id: string; return_number: string } | null;

  await recordAudit(actor, {
    action: "return.recorded",
    targetType: "van_return",
    targetId: entry?.id,
    targetLabel: entry?.return_number ?? "Return",
    after: {
      direction,
      reason,
      lines: lines.length,
      units: lines.reduce((s, l) => s + l.quantity, 0),
    },
  });

  revalidatePath("/returns");
  revalidatePath("/inventory");

  return {
    status: "done",
    message: direction === "customer"
      ? `${entry?.return_number ?? "The return"} recorded. The stock is back on the warehouse.`
      : `${entry?.return_number ?? "The return"} recorded. The stock has left for the supplier.`,
  };
}

// ===================================================================
// Crewing a van
// ===================================================================
//
// Assigning somebody to a van decides who may sell from it and who is
// accountable for the vehicle, so it needs vans.crew rather than the
// van-editing permission. The database refuses a mismatch too - an
// inactive account, another organization's staff, or a driver crewed to
// sell - so these checks are for the message, not for the control.

export async function assignCrewAction(
  _prev: DistributionState,
  formData: FormData,
): Promise<DistributionState> {
  const actor = await requirePermission("vans.crew");

  if (!(await getCapabilities()).vanCrew) {
    return {
      status: "error",
      message:
        "Van crews need database upgrade 0032. " +
        "Run database/UPGRADE_0032_VAN_CREW.sql, then reload.",
    };
  }

  const vanId = String(formData.get("vanId") ?? "");
  const memberId = String(formData.get("memberId") ?? "");
  const crewRole = String(formData.get("crewRole") ?? "");

  const values = { vanId, memberId, crewRole };
  const errors: Record<string, string> = {};

  if (!vanId) errors.vanId = "Choose a van.";
  if (!memberId) errors.memberId = "Choose who to put on it.";
  if (crewRole !== "driver" && crewRole !== "salesperson") {
    errors.crewRole = "Choose whether they drive or sell.";
  }

  if (Object.keys(errors).length) {
    return { status: "error", message: "Check the fields below.", values, fieldErrors: errors };
  }

  const admin = createSupabaseAdminClient();
  const [{ data: van }, { data: member }] = await Promise.all([
    admin.from("vans").select("id, code, org_id").eq("id", vanId).maybeSingle(),
    admin.from("profiles").select("id, full_name, role, org_id, is_active")
      .eq("id", memberId).maybeSingle(),
  ]);

  if (!van || van.org_id !== actor.organizationId) {
    return { status: "error", message: "That van could not be found.", values };
  }
  if (!member || member.org_id !== actor.organizationId) {
    return { status: "error", message: "That person could not be found.", values };
  }

  const supabase = await createSupabaseServerClient();

  // A van takes one driver. Replacing them means standing the previous
  // one down rather than refusing, which is what "replace driver" means
  // to whoever is doing it.
  if (crewRole === "driver") {
    await supabase
      .from("van_assignments")
      .update({ unassigned_at: new Date().toISOString() })
      .eq("van_id", vanId)
      .eq("crew_role", "driver")
      .is("unassigned_at", null);
  }

  // Somebody can only be on one van, so coming here means leaving
  // wherever they were.
  await supabase
    .from("van_assignments")
    .update({ unassigned_at: new Date().toISOString() })
    .eq("member_id", memberId)
    .is("unassigned_at", null);

  const { error } = await supabase.from("van_assignments").insert({
    org_id: actor.organizationId,
    van_id: vanId,
    member_id: memberId,
    crew_role: crewRole,
    assigned_by: actor.id,
  });

  if (error) {
    console.error("[crew] assignment failed", error);
    // The database's message names the actual problem - not active, wrong
    // role for the job - and that is what the person needs to read.
    return { status: "error", message: error.message, values };
  }

  await recordAudit(actor, {
    action: "van.crew_assigned",
    targetType: "van",
    targetId: vanId,
    targetLabel: van.code as string,
    after: { member: member.full_name, crew_role: crewRole },
  });

  revalidatePath("/vans");
  revalidatePath(`/vans/${vanId}/crew`);
  revalidatePath("/driver");

  return {
    status: "done",
    message: `${member.full_name} is now ${crewRole === "driver" ? "driving" : "selling from"} ${van.code}.`,
  };
}

export async function removeCrewAction(
  _prev: DistributionState,
  formData: FormData,
): Promise<DistributionState> {
  const actor = await requirePermission("vans.crew");

  const assignmentId = String(formData.get("assignmentId") ?? "");
  if (!assignmentId) return { status: "error", message: "That assignment could not be found." };

  const admin = createSupabaseAdminClient();
  const { data: assignment } = await admin
    .from("van_assignments")
    .select("id, org_id, van_id, crew_role, member_id, vans(code), profiles!van_assignments_driver_id_fkey(full_name)")
    .eq("id", assignmentId)
    .maybeSingle();

  if (!assignment || assignment.org_id !== actor.organizationId) {
    return { status: "error", message: "That assignment could not be found." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("van_assignments")
    .update({ unassigned_at: new Date().toISOString() })
    .eq("id", assignmentId)
    .is("unassigned_at", null);

  if (error) {
    console.error("[crew] stand-down failed", error);
    return { status: "error", message: "They could not be stood down. Please try again." };
  }

  const name = (assignment.profiles as { full_name?: string } | null)?.full_name ?? "They";
  const code = (assignment.vans as { code?: string } | null)?.code ?? "the van";

  await recordAudit(actor, {
    action: "van.crew_removed",
    targetType: "van",
    targetId: assignment.van_id as string,
    targetLabel: code,
    before: { member: name, crew_role: assignment.crew_role },
  });

  revalidatePath("/vans");
  revalidatePath(`/vans/${assignment.van_id}/crew`);
  revalidatePath("/driver");

  return { status: "done", message: `${name} has been taken off ${code}.` };
}

/**
 * Move stock from one van to another.
 *
 * For the van that breaks down mid-round: the salesperson can already be
 * reassigned, and this is how the goods follow them. The database
 * function does the work in one transaction and writes both legs on the
 * existing ledger, so this only has to carry the answer back in words.
 */
export async function transferVanStockAction(input: {
  fromVanId: string;
  toVanId: string;
  reason: string;
  lines: { productId: string; quantity: number }[];
}): Promise<{ ok: boolean; message?: string; moved?: number }> {
  const actor = await requirePermission("inventory.transfer");

  if (!input.fromVanId || !input.toVanId) {
    return { ok: false, message: "Choose both vans." };
  }
  if (input.fromVanId === input.toVanId) {
    return { ok: false, message: "Choose two different vans." };
  }
  if (!input.reason?.trim()) {
    return { ok: false, message: "Say why the stock is moving." };
  }

  const lines = (input.lines ?? []).filter((l) => l.quantity > 0);
  if (lines.length === 0) return { ok: false, message: "Nothing was selected to move." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("transfer_van_stock", {
    p_from_van: input.fromVanId,
    p_to_van: input.toVanId,
    p_lines: lines.map((l) => ({ product_id: l.productId, quantity: l.quantity })),
    p_reason: input.reason.trim(),
  });

  if (error) {
    console.error("[distribution] van transfer failed", error);
    // The database names the product and the shortfall, which is what
    // the person moving the goods needs to read.
    return { ok: false, message: error.message.replace(/^.*?:\s*/, "") };
  }

  const [{ data: from }, { data: to }] = await Promise.all([
    createSupabaseAdminClient().from("vans").select("code").eq("id", input.fromVanId).maybeSingle(),
    createSupabaseAdminClient().from("vans").select("code").eq("id", input.toVanId).maybeSingle(),
  ]);

  await recordAudit(actor, {
    action: "stock.adjusted",
    targetType: "van",
    targetId: input.toVanId,
    targetLabel: (to?.code as string) ?? "",
    after: {
      via: "van_transfer",
      from: (from?.code as string) ?? input.fromVanId,
      lines: lines.length,
      units: lines.reduce((s, l) => s + l.quantity, 0),
      reason: input.reason.trim(),
    },
  });

  revalidatePath("/vans");
  revalidatePath("/loads");
  revalidatePath("/inventory/movements");

  return { ok: true, moved: lines.length };
}
