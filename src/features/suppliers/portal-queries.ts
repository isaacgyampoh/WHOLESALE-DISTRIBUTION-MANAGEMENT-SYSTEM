import "server-only";
import { headers } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { parseAmount } from "@/lib/utils/format";
import { getCapabilities } from "@/lib/db/capabilities";
import { createHash } from "node:crypto";

/**
 * What a supplier sees through their link.
 *
 * The link is not an identity, so none of this runs under a session.
 * The route resolves the digest with the service role - which is also
 * where the rate limit and the audit of attempts live - and then reads
 * strictly on behalf of the supplier it resolved to.
 *
 * Every read below is filtered by both the supplier and the
 * organization, and the database functions filter by them again. That
 * is not redundancy for its own sake: it means a mistake in this file
 * cannot widen what a supplier can see.
 */

export interface PortalSession {
  supplierId: string;
  orgId: string;
  /** Needed to submit: the link is re-checked against it at that point. */
  tokenId: string;
  expiresAt: string;
  supplierName: string;
  organizationName: string;
}

/**
 * Exchange the link for the supplier it belongs to.
 *
 * Returns null for every kind of failure - unknown, expired, revoked,
 * rate limited - because telling the holder of a bad link which of those
 * it was tells them how to make a better guess.
 */
export async function resolvePortalSession(token: string): Promise<PortalSession | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  if (!(await getCapabilities()).supplierPortal) return null;

  const hash = createHash("sha256").update(token).digest("hex");

  // The address is passed for the rate limit. Behind a proxy the first
  // entry of the forwarded chain is the client; a missing header means
  // the limit simply does not apply to this request rather than the
  // request being refused.
  const head = await headers();
  const forwarded = head.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || null;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("resolve_supplier_token", {
    p_token_hash: hash,
    p_ip: ip,
    p_user_agent: head.get("user-agent")?.slice(0, 300) ?? null,
  });

  if (error) {
    console.error("[portal] link could not be resolved", error);
    return null;
  }

  const resolved = (Array.isArray(data) ? data[0] : data) as
    { supplier_id: string; org_id: string; token_id: string; expires_at: string } | undefined;
  if (!resolved?.supplier_id) return null;

  const [supplier, org] = await Promise.all([
    admin.from("suppliers").select("name").eq("id", resolved.supplier_id).maybeSingle(),
    admin.from("organizations").select("name").eq("id", resolved.org_id).maybeSingle(),
  ]);

  return {
    supplierId: resolved.supplier_id,
    orgId: resolved.org_id,
    tokenId: resolved.token_id,
    expiresAt: resolved.expires_at,
    supplierName: (supplier.data?.name as string) ?? "Supplier",
    organizationName: (org.data?.name as string) ?? "",
  };
}

export interface PortalOrder {
  id: string;
  poNumber: string;
  status: string;
  orderDate: string;
  expectedDate: string | null;
  total: number;
  lines: number;
  qtyOrdered: number;
  qtyReceived: number;
}

export async function getPortalOrders(session: PortalSession): Promise<PortalOrder[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("supplier_portal_orders", {
    p_supplier_id: session.supplierId,
    p_org_id: session.orgId,
  });

  if (error) {
    console.error("[portal] orders", error);
    return [];
  }

  return ((data ?? []) as Record<string, unknown>[]).map((o) => ({
    id: o.id as string,
    poNumber: o.po_number as string,
    status: (o.status as string) ?? "submitted",
    orderDate: o.order_date as string,
    expectedDate: (o.expected_date as string) ?? null,
    total: parseAmount(o.total as string),
    lines: Number(o.lines ?? 0),
    qtyOrdered: Number(o.qty_ordered ?? 0),
    qtyReceived: Number(o.qty_received ?? 0),
  }));
}

export interface PortalLine {
  productName: string;
  sku: string;
  quantity: number;
  qtyReceived: number;
  unitCost: number;
  lineTotal: number;
}

export async function getPortalOrderLines(
  session: PortalSession,
  orderId: string,
): Promise<PortalLine[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("supplier_portal_order_lines", {
    p_order_id: orderId,
    p_supplier_id: session.supplierId,
    p_org_id: session.orgId,
  });

  if (error) {
    console.error("[portal] order lines", error);
    return [];
  }

  return ((data ?? []) as Record<string, unknown>[]).map((l) => ({
    productName: l.product_name as string,
    sku: l.sku as string,
    quantity: Number(l.quantity ?? 0),
    qtyReceived: Number(l.qty_received ?? 0),
    unitCost: parseAmount(l.unit_cost as string),
    lineTotal: parseAmount(l.line_total as string),
  }));
}

export interface PortalSubmission {
  id: string;
  reference: string;
  documentDate: string | null;
  amount: number | null;
  status: "pending" | "received" | "reviewing" | "approved" | "rejected";
  submittedAt: string;
  fileName: string;
  /** Only ever set on a rejection: it tells them what to send instead. */
  reviewNote: string | null;
}

/** What this supplier has already sent, and what became of it. */
export async function getPortalSubmissions(
  session: PortalSession,
): Promise<PortalSubmission[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("supplier_portal_documents", {
    p_supplier_id: session.supplierId,
    p_org_id: session.orgId,
  });

  if (error) {
    // Absent rather than fatal: a supplier checking their orders should
    // not be shown an error page because a second panel failed.
    console.error("[portal] submissions", error);
    return [];
  }

  return ((data ?? []) as Record<string, unknown>[]).map((d) => ({
    id: d.id as string,
    reference: d.reference as string,
    documentDate: (d.document_date as string) ?? null,
    amount: d.amount === null || d.amount === undefined
      ? null
      : parseAmount(d.amount as string),
    status: (d.status as PortalSubmission["status"]) ?? "received",
    submittedAt: d.submitted_at as string,
    fileName: d.file_name as string,
    reviewNote: (d.review_note as string) ?? null,
  }));
}
