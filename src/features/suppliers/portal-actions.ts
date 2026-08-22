"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { resolvePortalSession } from "./portal-queries";
import { DOCUMENT_BUCKET } from "./queries";
import type { SupplierState } from "./state";

/**
 * A supplier sending us their invoice.
 *
 * This is the one action in the system that runs for somebody with no
 * account. Everything that would normally be a role check has to be a
 * link check instead, and the link is resolved here from what the
 * browser sent rather than trusted from a previous page - a form posted
 * with a stale or revoked link must fail, not succeed because it was
 * valid when the page rendered.
 *
 * The file is validated before it is stored, and the database checks the
 * link a third time inside submit_supplier_document(). None of the three
 * is redundant: this one keeps rubbish out of the bucket, the constraint
 * keeps rubbish out of the table, and the database check is the one that
 * cannot be bypassed by calling something else.
 */

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg", "image/png", "image/webp", "image/heic",
]);

const MAX_BYTES = 20 * 1024 * 1024;
const MONEY = /^\d{1,9}(\.\d{1,2})?$/;

function safeFileName(raw: string): string {
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[/\\]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "invoice").slice(0, 120);
}

export async function submitSupplierInvoiceAction(
  _prev: SupplierState,
  formData: FormData,
): Promise<SupplierState> {
  const token = String(formData.get("token") ?? "");

  // Resolved here, from this request. A link revoked while the supplier
  // was filling the form in stops working at this moment, which is the
  // point of being able to revoke one.
  const session = await resolvePortalSession(token);
  if (!session) {
    return {
      status: "error",
      message:
        "This link is no longer valid. Ask your contact for a new one before sending anything.",
    };
  }

  const company = String(formData.get("company") ?? "").trim();
  const contact = String(formData.get("contact") ?? "").trim();
  const reference = String(formData.get("reference") ?? "").trim();
  const documentDate = String(formData.get("documentDate") ?? "").trim();
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const file = formData.get("file");

  const values = { company, contact, reference, documentDate, amount: amountRaw, notes };
  const errors: Record<string, string> = {};

  if (!company) errors.company = "Enter your company name as it appears on the invoice.";
  if (!reference) errors.reference = "Enter the invoice number.";
  if (!documentDate) errors.documentDate = "Enter the date on the invoice.";
  if (!amountRaw) errors.amount = "Enter the amount.";
  else if (!MONEY.test(amountRaw)) errors.amount = "Use a number, for example 4500.00";

  if (!(file instanceof File) || file.size === 0) {
    errors.file = "Attach the invoice.";
  } else {
    if (file.size > MAX_BYTES) {
      errors.file = "That file is over 20 MB. Send a smaller scan or a photograph.";
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      errors.file = "Send a PDF or a photograph. Other file types are not accepted.";
    }
  }

  if (Object.keys(errors).length) {
    return { status: "error", message: "Check the fields below.", values, fieldErrors: errors };
  }

  const upload = file as File;
  const admin = createSupabaseAdminClient();

  // Same folder shape as anything filed by our own staff, so the storage
  // policy scopes it the same way.
  const path = `${session.orgId}/${session.supplierId}/${randomUUID()}`;

  const stored = await admin.storage
    .from(DOCUMENT_BUCKET)
    .upload(path, upload, { contentType: upload.type, upsert: false });

  if (stored.error) {
    console.error("[portal] upload failed", stored.error);
    return {
      status: "error",
      message: "The file could not be sent. Please try again.",
      values,
    };
  }

  const { error } = await admin.rpc("submit_supplier_document", {
    p_supplier_id: session.supplierId,
    p_org_id: session.orgId,
    p_token_id: session.tokenId,
    p_company: company,
    p_contact: contact || null,
    p_reference: reference,
    p_document_date: documentDate,
    p_amount: Number(amountRaw),
    p_notes: notes || null,
    p_storage_path: path,
    p_file_name: safeFileName(upload.name),
    p_mime_type: upload.type,
    p_size_bytes: upload.size,
  });

  if (error) {
    // The record is what matters. A file with no row is invisible and
    // would sit in the bucket forever, so it goes back out.
    await admin.storage.from(DOCUMENT_BUCKET).remove([path]);
    console.error("[portal] submission failed", error);
    return {
      status: "error",
      message: "The invoice could not be sent. Please try again.",
      values,
    };
  }

  revalidatePath(`/portal/${token}`);

  return {
    status: "done",
    message:
      `Invoice ${reference} received. It is with our accounts team now, ` +
      `and you can see its progress on this page.`,
  };
}
