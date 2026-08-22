"use server";

import { randomUUID, randomBytes, createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { getCapabilities } from "@/lib/db/capabilities";
import { DOCUMENT_BUCKET, signDocumentUrl } from "./queries";
import type { SupplierState } from "./state";

/**
 * Filing supplier paperwork, and issuing the links suppliers use.
 *
 * Two things here are worth stating plainly.
 *
 * A file is validated on the server before it is stored, and the same
 * checks are repeated by the database and by the bucket. Not because any
 * one of them is doubted, but because a browser-side check is a courtesy
 * to the person uploading and not a control: the request can be made
 * without the page.
 *
 * A portal link is generated here, hashed here, and the full value is
 * returned exactly once for display. The database is only ever given the
 * digest, so the link cannot turn up in a query log, a statement sample
 * or a slow-query trace.
 */

/** What a delivery note plausibly is. Anything else is refused. */
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg", "image/png", "image/webp", "image/heic",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

const MAX_BYTES = 20 * 1024 * 1024;

const KINDS = new Set([
  "invoice", "delivery_note", "waybill", "credit_note", "certificate", "contract", "other",
]);

const MONEY = /^\d{1,9}(\.\d{1,2})?$/;

/**
 * A file name safe to store and to send back in a download header.
 *
 * Control characters and path separators are stripped rather than
 * escaped: the stored object is named by a uuid regardless, and this
 * value only ever ends up in a Content-Disposition header and on screen.
 */
function safeFileName(raw: string): string {
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[/\\]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "document").slice(0, 120);
}

export async function uploadSupplierDocumentAction(
  _prev: SupplierState,
  formData: FormData,
): Promise<SupplierState> {
  // Filing paperwork is part of receiving goods, so the warehouse can do
  // it. Reading it back is governed by the same roles.
  const actor = await requirePermission("inventory.transfer");

  if (!(await getCapabilities()).supplierDocuments) {
    return {
      status: "error",
      message:
        "Supplier documents need database upgrade 0029. " +
        "Run database/UPGRADE_0029_SUPPLIER_DOCUMENTS.sql, then reload.",
    };
  }

  const supplierId = String(formData.get("supplierId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const kind = String(formData.get("kind") ?? "other");
  const reference = String(formData.get("reference") ?? "").trim();
  const documentDate = String(formData.get("documentDate") ?? "").trim();
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const purchaseOrderId = String(formData.get("purchaseOrderId") ?? "");
  const file = formData.get("file");

  const values = { title, kind, reference, documentDate, amount: amountRaw, purchaseOrderId };
  const errors: Record<string, string> = {};

  if (!supplierId) return { status: "error", message: "That supplier could not be found." };
  if (!title) errors.title = "Give the document a name somebody will recognise later.";
  if (!KINDS.has(kind)) errors.kind = "Choose what kind of document this is.";
  if (amountRaw && !MONEY.test(amountRaw)) {
    errors.amount = "Use a number with at most two decimal places.";
  }

  if (!(file instanceof File) || file.size === 0) {
    errors.file = "Choose a file.";
  } else {
    if (file.size > MAX_BYTES) {
      errors.file = "That file is over 20 MB. Scan it at a lower resolution, or split it.";
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      errors.file =
        "That is not a document type this accepts. Use a PDF, a photograph, or a spreadsheet.";
    }
  }

  if (Object.keys(errors).length) {
    return { status: "error", message: "Check the fields below.", values, fieldErrors: errors };
  }

  const upload = file as File;
  const admin = createSupabaseAdminClient();

  // The supplier is confirmed to be ours before anything is written
  // under its folder. The database refuses a foreign one regardless;
  // this is so nothing is uploaded that then has to be cleaned up.
  const { data: supplier } = await admin
    .from("suppliers").select("id, name, code, org_id").eq("id", supplierId).maybeSingle();
  if (!supplier || supplier.org_id !== actor.organizationId) {
    return { status: "error", message: "That supplier could not be found." };
  }

  // {org}/{supplier}/{uuid}. The uuid means two files of the same name
  // never collide, and the organization coming first is what lets the
  // storage policy scope by folder.
  const path = `${actor.organizationId}/${supplierId}/${randomUUID()}`;
  const fileName = safeFileName(upload.name);

  const stored = await admin.storage
    .from(DOCUMENT_BUCKET)
    .upload(path, upload, { contentType: upload.type, upsert: false });

  if (stored.error) {
    console.error("[suppliers] upload failed", stored.error);
    return { status: "error", message: "The file could not be stored. Please try again.", values };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("supplier_documents")
    .insert({
      org_id: actor.organizationId,
      supplier_id: supplierId,
      purchase_order_id: purchaseOrderId || null,
      kind,
      title,
      reference: reference || null,
      document_date: documentDate || null,
      amount: amountRaw ? Number(amountRaw) : null,
      storage_path: path,
      file_name: fileName,
      mime_type: upload.type,
      size_bytes: upload.size,
      uploaded_by: actor.id,
    });

  if (error) {
    // The row is the record. An object with no row is invisible and
    // would sit in the bucket forever, so it goes back out.
    await admin.storage.from(DOCUMENT_BUCKET).remove([path]);
    console.error("[suppliers] document row failed", error);
    return {
      status: "error",
      message: "The document could not be filed. Please try again.",
      values,
    };
  }

  await recordAudit(actor, {
    action: "supplier.document_filed",
    targetType: "supplier",
    targetId: supplierId,
    targetLabel: `${supplier.code} ${supplier.name}`,
    after: { title, kind, file_name: fileName, size_bytes: upload.size },
  });

  revalidatePath(`/suppliers/${supplierId}`);
  return { status: "done", message: `${title} filed against ${supplier.name}.` };
}

export async function deleteSupplierDocumentAction(
  _prev: SupplierState,
  formData: FormData,
): Promise<SupplierState> {
  // Narrower than filing. Removing a document that a dispute may later
  // turn on is a decision somebody has to be accountable for.
  const actor = await requirePermission("products.edit");

  const documentId = String(formData.get("documentId") ?? "");
  const admin = createSupabaseAdminClient();

  const { data: document } = await admin
    .from("supplier_documents")
    .select("id, title, storage_path, supplier_id, org_id")
    .eq("id", documentId)
    .maybeSingle();

  if (!document || document.org_id !== actor.organizationId) {
    return { status: "error", message: "That document could not be found." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("supplier_documents").delete().eq("id", documentId);

  if (error) {
    console.error("[suppliers] document could not be removed", error);
    return { status: "error", message: "The document could not be removed. Please try again." };
  }

  // The object goes after the row. If this step fails the file is
  // orphaned, which is recoverable; the other order would leave a record
  // pointing at nothing, which reads as evidence having gone missing.
  const removed = await admin.storage
    .from(DOCUMENT_BUCKET).remove([document.storage_path as string]);
  if (removed.error) console.error("[suppliers] object left behind", removed.error);

  await recordAudit(actor, {
    action: "supplier.document_removed",
    targetType: "supplier",
    targetId: document.supplier_id as string,
    targetLabel: document.title as string,
    before: { title: document.title },
  });

  revalidatePath(`/suppliers/${document.supplier_id}`);
  return { status: "done", message: `${document.title} removed.` };
}

// ===================================================================
// Portal links
// ===================================================================

export async function issuePortalLinkAction(
  _prev: SupplierState,
  formData: FormData,
): Promise<SupplierState> {
  const actor = await requirePermission("users.manage");

  if (!(await getCapabilities()).supplierPortal) {
    return {
      status: "error",
      message:
        "The supplier portal needs database upgrade 0030. " +
        "Run database/UPGRADE_0030_SUPPLIER_PORTAL.sql, then reload.",
    };
  }

  const supplierId = String(formData.get("supplierId") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  const days = Number(String(formData.get("days") ?? "30"));

  if (!Number.isInteger(days) || days < 1 || days > 365) {
    return {
      status: "error",
      message: "A link lasts between 1 and 365 days.",
      values: { label, days: String(days) },
      fieldErrors: { days: "Choose between 1 and 365 days." },
    };
  }

  const admin = createSupabaseAdminClient();
  const { data: supplier } = await admin
    .from("suppliers").select("id, name, code, org_id").eq("id", supplierId).maybeSingle();
  if (!supplier || supplier.org_id !== actor.organizationId) {
    return { status: "error", message: "That supplier could not be found." };
  }

  // Generated here and hashed here. The database is given the digest, so
  // the link never appears in a query log or a statement sample.
  const link = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(link).digest("hex");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("issue_supplier_token", {
    p_supplier_id: supplierId,
    p_token_hash: hash,
    p_token_hint: link.slice(0, 6),
    p_days: days,
    p_label: label || null,
  });

  if (error) {
    console.error("[suppliers] portal link could not be issued", error);
    return { status: "error", message: "The link could not be issued. Please try again." };
  }

  await recordAudit(actor, {
    action: "supplier.portal_link_issued",
    targetType: "supplier",
    targetId: supplierId,
    targetLabel: `${supplier.code} ${supplier.name}`,
    // The link is deliberately absent. An audit trail that records
    // credentials is a place to steal them from.
    after: { days, label: label || null, hint: link.slice(0, 6) },
  });

  revalidatePath(`/suppliers/${supplierId}`);

  return {
    status: "done",
    message: `Link issued for ${supplier.name}. It expires in ${days} days.`,
    issuedLink: link,
  };
}

export async function revokePortalLinkAction(
  _prev: SupplierState,
  formData: FormData,
): Promise<SupplierState> {
  const actor = await requirePermission("users.manage");

  const tokenId = String(formData.get("tokenId") ?? "");
  const admin = createSupabaseAdminClient();
  const { data: token } = await admin
    .from("supplier_portal_tokens")
    .select("id, supplier_id, token_hint, org_id")
    .eq("id", tokenId)
    .maybeSingle();

  if (!token || token.org_id !== actor.organizationId) {
    return { status: "error", message: "That link could not be found." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("revoke_supplier_token", { p_token_id: tokenId });

  if (error) {
    console.error("[suppliers] portal link could not be revoked", error);
    return { status: "error", message: "The link could not be revoked. Please try again." };
  }

  await recordAudit(actor, {
    action: "supplier.portal_link_revoked",
    targetType: "supplier",
    targetId: token.supplier_id as string,
    targetLabel: `Link ${token.token_hint}`,
  });

  revalidatePath(`/suppliers/${token.supplier_id}`);
  return { status: "done", message: "That link stops working immediately." };
}

/**
 * A short-lived URL for one document.
 *
 * The row is read under the caller's own session inside signDocumentUrl,
 * so the check that decides whether they may open the file is the same
 * one that decides whether they may see the record of it.
 */
export async function openDocumentAction(documentId: string): Promise<
  { ok: true; url: string } | { ok: false; message: string }
> {
  await requirePermission("inventory.view");
  const result = await signDocumentUrl(documentId);
  return result.ok ? { ok: true, url: result.data } : { ok: false, message: result.message };
}
