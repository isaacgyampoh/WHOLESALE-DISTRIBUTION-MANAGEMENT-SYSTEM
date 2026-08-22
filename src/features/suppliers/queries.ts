import "server-only";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { parseAmount } from "@/lib/utils/format";
import { getCapabilities } from "@/lib/db/capabilities";
import { type Result, failed } from "@/lib/query/result";

/**
 * One supplier: what has been ordered from them, what paperwork arrived
 * with it, and which portal links they hold.
 *
 * A file is never handed over by URL from a listing. The bucket is
 * private, and a link to it is minted only when somebody asks for that
 * document, only for a few minutes, and only after the row they are
 * asking about has been read under their own session - which is what
 * proves they were allowed to see it.
 */

export const DOCUMENT_BUCKET = "supplier-documents";

/** Long enough to open a PDF, short enough that a forwarded link is dead. */
export const SIGNED_URL_SECONDS = 300;

export interface SupplierDetail {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  paymentTermsDays: number;
  leadTimeDays: number;
  isActive: boolean;
  orderCount: number;
  openOrders: number;
  lastOrderDate: string | null;
}

export async function getSupplier(id: string): Promise<Result<SupplierDetail | null>> {
  const supabase = await createSupabaseServerClient();

  const [supplier, orders] = await Promise.all([
    supabase
      .from("suppliers")
      .select("id, code, name, contact_name, email, phone, address, " +
              "payment_terms_days, lead_time_days, is_active")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("purchase_orders")
      .select("id, status, order_date")
      .eq("supplier_id", id),
  ]);

  if (supplier.error) return failed("suppliers", supplier.error, "This supplier could not be loaded.");
  if (!supplier.data) return { ok: true, data: null };

  const rows = (orders.data ?? []) as unknown as Record<string, unknown>[];
  const s = supplier.data as unknown as Record<string, unknown>;

  return {
    ok: true,
    data: {
      id: s.id as string,
      code: s.code as string,
      name: s.name as string,
      contactName: (s.contact_name as string) ?? null,
      email: (s.email as string) ?? null,
      phone: (s.phone as string) ?? null,
      address: (s.address as string) ?? null,
      paymentTermsDays: Number(s.payment_terms_days ?? 0),
      leadTimeDays: Number(s.lead_time_days ?? 0),
      isActive: Boolean(s.is_active),
      orderCount: rows.length,
      openOrders: rows.filter(
        (r) => r.status === "submitted" || r.status === "partially_received").length,
      lastOrderDate: rows
        .map((r) => r.order_date as string)
        .sort()
        .at(-1) ?? null,
    },
  };
}

export interface SupplierDocumentRow {
  id: string;
  kind: string;
  status: "pending" | "received" | "reviewing" | "approved" | "rejected";
  submittedCompany: string | null;
  submittedByName: string | null;
  submittedAt: string | null;
  reviewedByName: string | null;
  reviewNote: string | null;
  title: string;
  reference: string | null;
  documentDate: string | null;
  amount: number | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  poNumber: string | null;
  uploadedByName: string | null;
  createdAt: string;
}

export async function listSupplierDocuments(
  supplierId: string,
): Promise<Result<SupplierDocumentRow[]>> {
  const { supplierDocuments } = await getCapabilities();
  if (!supplierDocuments) {
    return {
      ok: false,
      message:
        "Supplier documents need database upgrade 0029. " +
        "Run database/UPGRADE_0029_SUPPLIER_DOCUMENTS.sql, then reload.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("supplier_document_detail")
    .select("*")
    .eq("supplier_id", supplierId)
    .order("document_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) return failed("suppliers", error, "Documents could not be loaded.");

  return {
    ok: true,
    data: ((data ?? []) as unknown as Record<string, unknown>[]).map((d) => ({
      id: d.id as string,
      kind: (d.kind as string) ?? "other",
      status: (d.status as SupplierDocumentRow["status"]) ?? "approved",
      submittedCompany: (d.submitted_company as string) ?? null,
      submittedByName: (d.submitted_by_name as string) ?? null,
      submittedAt: (d.submitted_at as string) ?? null,
      reviewedByName: (d.reviewed_by_name as string) ?? null,
      reviewNote: (d.review_note as string) ?? null,
      title: d.title as string,
      reference: (d.reference as string) ?? null,
      documentDate: (d.document_date as string) ?? null,
      amount: d.amount === null || d.amount === undefined
        ? null
        : parseAmount(d.amount as string),
      fileName: d.file_name as string,
      mimeType: d.mime_type as string,
      sizeBytes: Number(d.size_bytes ?? 0),
      poNumber: (d.po_number as string) ?? null,
      uploadedByName: (d.uploaded_by_name as string) ?? null,
      createdAt: d.created_at as string,
    })),
  };
}

/**
 * A short-lived link to one document.
 *
 * The row is read first under the caller's own session. If row level
 * security does not return it, no URL is minted - so the check that
 * decides whether this person may see the file is the same one that
 * decides whether they may see the record of it.
 */
export async function signDocumentUrl(documentId: string): Promise<Result<string>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("supplier_documents")
    .select("storage_path, file_name")
    .eq("id", documentId)
    .maybeSingle();

  if (error) return failed("suppliers", error, "That document could not be opened.");
  if (!data) return { ok: false, message: "That document could not be found." };

  // Minted with the service role because signing is a storage admin
  // operation; the authorisation happened above.
  const admin = createSupabaseAdminClient();
  const signed = await admin.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrl(data.storage_path as string, SIGNED_URL_SECONDS, {
      download: data.file_name as string,
    });

  if (signed.error || !signed.data?.signedUrl) {
    return failed("suppliers", signed.error, "That document could not be opened.");
  }

  return { ok: true, data: signed.data.signedUrl };
}

export interface PortalTokenRow {
  id: string;
  label: string | null;
  hint: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  useCount: number;
  createdAt: string;
  /** Derived, because "expired" is a fact about now and not a stored flag. */
  state: "active" | "expired" | "revoked";
}

export async function listPortalTokens(
  supplierId: string,
): Promise<Result<PortalTokenRow[]>> {
  const { supplierPortal } = await getCapabilities();
  if (!supplierPortal) {
    return {
      ok: false,
      message:
        "The supplier portal needs database upgrade 0030. " +
        "Run database/UPGRADE_0030_SUPPLIER_PORTAL.sql, then reload.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("supplier_portal_tokens")
    .select("id, label, token_hint, expires_at, revoked_at, last_used_at, use_count, created_at")
    .eq("supplier_id", supplierId)
    .order("created_at", { ascending: false });

  if (error) return failed("suppliers", error, "Portal links could not be loaded.");

  const now = Date.now();
  return {
    ok: true,
    data: ((data ?? []) as unknown as Record<string, unknown>[]).map((t) => ({
      id: t.id as string,
      label: (t.label as string) ?? null,
      hint: t.token_hint as string,
      expiresAt: t.expires_at as string,
      revokedAt: (t.revoked_at as string) ?? null,
      lastUsedAt: (t.last_used_at as string) ?? null,
      useCount: Number(t.use_count ?? 0),
      createdAt: t.created_at as string,
      state: t.revoked_at
        ? "revoked"
        : new Date(t.expires_at as string).getTime() < now
          ? "expired"
          : "active",
    })),
  };
}

/**
 * Everything a supplier has sent that nobody here has finished with.
 *
 * Its own query rather than a filter on the supplier page, because the
 * question "what is waiting on me" is asked by somebody who does not yet
 * know which supplier it is about.
 */
export async function listAwaitingReview(): Promise<Result<
  (SupplierDocumentRow & { supplierId: string; supplierName: string })[]
>> {
  const { supplierSubmissions } = await getCapabilities();
  if (!supplierSubmissions) {
    return {
      ok: false,
      message:
        "Supplier submissions need database upgrade 0031. " +
        "Run database/UPGRADE_0031_SUPPLIER_SUBMISSIONS.sql, then reload.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("supplier_document_detail")
    .select("*")
    .in("status", ["received", "reviewing"])
    .order("submitted_at", { ascending: true });

  if (error) return failed("suppliers", error, "The review queue could not be loaded.");

  return {
    ok: true,
    data: ((data ?? []) as unknown as Record<string, unknown>[]).map((d) => ({
      id: d.id as string,
      kind: (d.kind as string) ?? "invoice",
      status: (d.status as SupplierDocumentRow["status"]) ?? "received",
      submittedCompany: (d.submitted_company as string) ?? null,
      submittedByName: (d.submitted_by_name as string) ?? null,
      submittedAt: (d.submitted_at as string) ?? null,
      reviewedByName: (d.reviewed_by_name as string) ?? null,
      reviewNote: (d.review_note as string) ?? null,
      title: d.title as string,
      reference: (d.reference as string) ?? null,
      documentDate: (d.document_date as string) ?? null,
      amount: d.amount === null || d.amount === undefined
        ? null
        : parseAmount(d.amount as string),
      fileName: d.file_name as string,
      mimeType: d.mime_type as string,
      sizeBytes: Number(d.size_bytes ?? 0),
      poNumber: (d.po_number as string) ?? null,
      uploadedByName: (d.uploaded_by_name as string) ?? null,
      createdAt: d.created_at as string,
      supplierId: d.supplier_id as string,
      supplierName: (d.supplier_name as string) ?? "Supplier",
    })),
  };
}
