"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { getCapabilities } from "@/lib/db/capabilities";
import type { TransferState } from "./state";

/**
 * Raising and moving a transfer along.
 *
 * Every state change goes through its own database function. None of
 * them is a status update written from here, because each carries a
 * rule that has to hold whatever calls it: a draft cannot be dispatched,
 * goods already on the road cannot be cancelled, and nothing arrives
 * that did not leave.
 *
 * The calls run under the caller's own session rather than the admin
 * client, so require_role() inside each function sees the real caller.
 */

const UNAVAILABLE =
  "Warehouse transfers need database upgrade 0027. " +
  "Run database/UPGRADE_0027_TRANSFERS.sql, then reload.";

async function available(): Promise<boolean> {
  return (await getCapabilities()).warehouseTransfers;
}

function refresh(id?: string) {
  revalidatePath("/transfers");
  revalidatePath("/inventory");
  if (id) revalidatePath(`/transfers/${id}`);
}

export async function createTransferAction(
  _prev: TransferState,
  formData: FormData,
): Promise<TransferState> {
  const actor = await requirePermission("inventory.transfer");
  if (!(await available())) return { status: "error", message: UNAVAILABLE };

  const fromWarehouseId = String(formData.get("fromWarehouseId") ?? "");
  const toWarehouseId = String(formData.get("toWarehouseId") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();
  const values = { fromWarehouseId, toWarehouseId, notes };
  const errors: Record<string, string> = {};

  if (!fromWarehouseId) errors.fromWarehouseId = "Choose where the goods leave from.";
  if (!toWarehouseId) errors.toWarehouseId = "Choose where they are going.";
  if (fromWarehouseId && fromWarehouseId === toWarehouseId) {
    errors.toWarehouseId = "Choose a different warehouse from the one it leaves.";
  }

  // Lines arrive as parallel arrays from the repeated fields in the
  // form. A row with neither a product nor a quantity is one the person
  // added and did not use.
  const productIds = formData.getAll("productId").map(String);
  const quantities = formData.getAll("quantity").map(String);

  const lines = productIds
    .map((productId, i) => ({ productId, quantity: Number(quantities[i] ?? 0) }))
    .filter((l) => l.productId || l.quantity > 0);

  if (lines.length === 0) errors.lines = "Add at least one product.";
  if (lines.some((l) => !l.productId)) errors.lines = "Every line needs a product.";
  if (lines.some((l) => !Number.isInteger(l.quantity) || l.quantity <= 0)) {
    errors.lines = "Every line needs a whole quantity above zero.";
  }
  // Two rows of the same product would collide on the table's own
  // uniqueness rule, with a message nobody could act on.
  if (new Set(lines.map((l) => l.productId)).size !== lines.length) {
    errors.lines = "The same product is on more than one line. Combine them.";
  }

  if (Object.keys(errors).length) {
    return { status: "error", message: "Check the fields below.", values, fieldErrors: errors };
  }

  const supabase = await createSupabaseServerClient();
  const { data: transfer, error } = await supabase
    .from("stock_transfers")
    .insert({
      org_id: actor.organizationId,
      from_warehouse_id: fromWarehouseId,
      to_warehouse_id: toWarehouseId,
      notes: notes || null,
    })
    .select("id, transfer_number")
    .single();

  if (error || !transfer) {
    console.error("[transfers] could not be raised", error);
    return { status: "error", message: "The transfer could not be raised. Please try again.", values };
  }

  const { error: linesError } = await supabase.from("stock_transfer_items").insert(
    lines.map((l) => ({
      org_id: actor.organizationId,
      transfer_id: transfer.id,
      product_id: l.productId,
      quantity: l.quantity,
    })),
  );

  if (linesError) {
    // A transfer with no lines cannot be approved and would sit in the
    // list forever, so it is removed rather than left as a stub.
    await supabase.from("stock_transfers").delete().eq("id", transfer.id);
    console.error("[transfers] lines could not be saved", linesError);
    return { status: "error", message: "The lines could not be saved. Please try again.", values };
  }

  await recordAudit(actor, {
    action: "transfer.created",
    targetType: "stock_transfer",
    targetId: transfer.id,
    targetLabel: transfer.transfer_number,
    after: { lines: lines.length, units: lines.reduce((s, l) => s + l.quantity, 0) },
  });

  refresh(transfer.id);
  return {
    status: "done",
    message: `${transfer.transfer_number} raised. A manager has to approve it before the goods move.`,
    createdId: transfer.id,
  };
}

/** The one place a transfer's own row is read for a name and a check. */
async function transferFor(actor: { organizationId: string }, id: string) {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("stock_transfers")
    .select("id, transfer_number, org_id")
    .eq("id", id)
    .maybeSingle();
  return data && data.org_id === actor.organizationId ? data : null;
}

export async function approveTransferAction(
  _prev: TransferState,
  formData: FormData,
): Promise<TransferState> {
  const actor = await requirePermission("transfers.approve");
  if (!(await available())) return { status: "error", message: UNAVAILABLE };

  const id = String(formData.get("transferId") ?? "");
  const transfer = await transferFor(actor, id);
  if (!transfer) return { status: "error", message: "That transfer could not be found." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("approve_stock_transfer", { p_transfer_id: id });

  if (error) {
    console.error("[transfers] approval failed", error);
    return { status: "error", message: error.message };
  }

  await recordAudit(actor, {
    action: "transfer.approved",
    targetType: "stock_transfer",
    targetId: id,
    targetLabel: transfer.transfer_number,
  });

  refresh(id);
  return { status: "done", message: `${transfer.transfer_number} approved. It can now be dispatched.` };
}

export async function dispatchTransferAction(
  _prev: TransferState,
  formData: FormData,
): Promise<TransferState> {
  const actor = await requirePermission("inventory.transfer");
  if (!(await available())) return { status: "error", message: UNAVAILABLE };

  const id = String(formData.get("transferId") ?? "");
  const transfer = await transferFor(actor, id);
  if (!transfer) return { status: "error", message: "That transfer could not be found." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("dispatch_stock_transfer", { p_transfer_id: id });

  if (error) {
    // These messages are written for the person reading them - not
    // enough stock, an expired batch - so they are shown rather than
    // replaced with something vaguer.
    console.error("[transfers] dispatch failed", error);
    return { status: "error", message: error.message };
  }

  await recordAudit(actor, {
    action: "transfer.dispatched",
    targetType: "stock_transfer",
    targetId: id,
    targetLabel: transfer.transfer_number,
  });

  refresh(id);
  return {
    status: "done",
    message: `${transfer.transfer_number} is on its way. The stock is in transit until it is received.`,
  };
}

export async function receiveTransferAction(
  _prev: TransferState,
  formData: FormData,
): Promise<TransferState> {
  const actor = await requirePermission("inventory.transfer");
  if (!(await available())) return { status: "error", message: UNAVAILABLE };

  const id = String(formData.get("transferId") ?? "");
  const transfer = await transferFor(actor, id);
  if (!transfer) return { status: "error", message: "That transfer could not be found." };

  const itemIds = formData.getAll("itemId").map(String);
  const counts = formData.getAll("qtyReceived").map(String);

  // A line left blank is one nobody counted, and the database treats an
  // unmentioned line as having arrived in full. That is the common case
  // and should not need typing.
  const received = itemIds
    .map((itemId, i) => ({ item_id: itemId, entered: (counts[i] ?? "").trim() }))
    .filter((r) => r.item_id && r.entered !== "")
    .map((r) => ({ item_id: r.item_id, quantity: Number(r.entered) }));

  if (received.some((r) => !Number.isInteger(r.quantity) || r.quantity < 0)) {
    return {
      status: "error",
      message: "Enter a whole number for each line. Zero is fine for something that did not arrive.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("receive_stock_transfer", {
    p_transfer_id: id,
    p_counts: received,
  });

  if (error) {
    console.error("[transfers] receipt failed", error);
    return { status: "error", message: error.message };
  }

  await recordAudit(actor, {
    action: "transfer.received",
    targetType: "stock_transfer",
    targetId: id,
    targetLabel: transfer.transfer_number,
    after: { counted: received.length },
  });

  refresh(id);
  return { status: "done", message: `${transfer.transfer_number} booked in against what was counted.` };
}

export async function cancelTransferAction(
  _prev: TransferState,
  formData: FormData,
): Promise<TransferState> {
  const actor = await requirePermission("inventory.transfer");
  if (!(await available())) return { status: "error", message: UNAVAILABLE };

  const id = String(formData.get("transferId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const transfer = await transferFor(actor, id);
  if (!transfer) return { status: "error", message: "That transfer could not be found." };

  if (!reason) {
    return {
      status: "error",
      message: "Say why it is being cancelled.",
      values: { reason },
      fieldErrors: { reason: "A cancelled transfer with no reason is one nobody can explain later." },
    };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("cancel_stock_transfer", {
    p_transfer_id: id,
    p_reason: reason,
  });

  if (error) {
    console.error("[transfers] cancellation failed", error);
    return { status: "error", message: error.message };
  }

  await recordAudit(actor, {
    action: "transfer.cancelled",
    targetType: "stock_transfer",
    targetId: id,
    targetLabel: transfer.transfer_number,
    after: { reason },
  });

  refresh(id);
  return { status: "done", message: `${transfer.transfer_number} cancelled.` };
}
