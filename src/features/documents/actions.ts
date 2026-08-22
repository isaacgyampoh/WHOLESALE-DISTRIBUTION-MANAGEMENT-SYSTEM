"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { getCapabilities } from "@/lib/db/capabilities";
import type { DocumentState } from "./state";

/**
 * Issuing and completing waybills.
 *
 * Raising a waybill for a load goes through issue_waybill_for_load(),
 * which copies the lines from the load itself. Building the lines here
 * would let a waybill claim something different from what was actually
 * put on the van, which is the one thing the document exists to
 * prevent.
 *
 * Invoices and receipts have no action of their own: they are raised by
 * the database when the sale completes and when money is collected. A
 * button to create one by hand would be a way to disagree with the
 * sale.
 */

export async function issueWaybillAction(
  _prev: DocumentState,
  formData: FormData,
): Promise<DocumentState> {
  const actor = await requirePermission("documents.issue");

  const { documents } = await getCapabilities();
  if (!documents) {
    return {
      status: "error",
      message:
        "Waybills need database upgrade 0026. Run database/UPGRADE_0026_DOCUMENTS.sql, then reload.",
    };
  }

  const loadId = String(formData.get("loadId") ?? "");
  if (!loadId) {
    return { status: "error", message: "Choose a van load.", fieldErrors: { loadId: "Choose a van load." } };
  }

  // Named in the audit entry, and a check that the load is ours before
  // the message says anything about it. The database refuses a foreign
  // load regardless.
  const admin = createSupabaseAdminClient();
  const { data: load } = await admin
    .from("van_loads").select("id, load_number, org_id").eq("id", loadId).maybeSingle();
  if (!load || load.org_id !== actor.organizationId) {
    return { status: "error", message: "That van load could not be found." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("issue_waybill_for_load", { p_load_id: loadId });

  if (error) {
    console.error("[documents] waybill could not be issued", error);
    return { status: "error", message: "The waybill could not be issued. Please try again." };
  }

  const waybill = (Array.isArray(data) ? data[0] : data) as
    { id: string; waybill_number: string } | null;

  await recordAudit(actor, {
    action: "waybill.issued",
    targetType: "waybill",
    targetId: waybill?.id,
    targetLabel: waybill?.waybill_number ?? load.load_number,
    after: { load_number: load.load_number },
  });

  revalidatePath("/waybills");
  revalidatePath("/loads");

  return {
    status: "done",
    message: `Waybill ${waybill?.waybill_number ?? ""} issued for ${load.load_number}.`.trim(),
    createdId: waybill?.id,
  };
}

export async function markWaybillDeliveredAction(
  _prev: DocumentState,
  formData: FormData,
): Promise<DocumentState> {
  const actor = await requirePermission("documents.issue");

  const id = String(formData.get("waybillId") ?? "");
  const receivedBy = String(formData.get("receivedBy") ?? "").trim();

  if (!id) return { status: "error", message: "That waybill could not be found." };
  if (!receivedBy) {
    return {
      status: "error",
      message: "Record who signed for the goods.",
      values: { receivedBy },
      fieldErrors: { receivedBy: "Enter the name of the person who received them." },
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("waybills")
    .update({
      status: "delivered",
      delivered_at: new Date().toISOString(),
      received_by: receivedBy,
    })
    .eq("id", id)
    // Only a waybill that is out can be delivered. Re-signing one that
    // already came back would overwrite who actually took the goods.
    .eq("status", "issued")
    .select("id, waybill_number")
    .maybeSingle();

  if (error) {
    console.error("[documents] waybill could not be completed", error);
    return { status: "error", message: "The waybill could not be updated. Please try again." };
  }
  if (!data) {
    return {
      status: "error",
      message: "That waybill is not out for delivery, so it cannot be signed for.",
    };
  }

  await recordAudit(actor, {
    action: "waybill.delivered",
    targetType: "waybill",
    targetId: data.id,
    targetLabel: data.waybill_number,
    after: { received_by: receivedBy },
  });

  revalidatePath("/waybills");
  revalidatePath(`/waybills/${id}`);

  return { status: "done", message: `${data.waybill_number} signed for by ${receivedBy}.` };
}
