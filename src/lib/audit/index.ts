import "server-only";
import { headers } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { AuthenticatedUser } from "@/types/domain";

/**
 * Recording administrative actions.
 *
 * Written with the service role because the log is not writable by
 * anyone else: an administrator may read history and may never author
 * it. The organization comes from the server's view of the actor, never
 * from the caller.
 *
 * Secrets are stripped again in the database, but the honest place to
 * keep them out is here, by never passing them.
 */

export type AuditAction =
  | "user.created"
  | "user.updated"
  | "user.activated"
  | "user.deactivated"
  | "user.role_changed"
  | "user.pin_reset"
  | "user.pin_changed"
  | "user.categories_changed"
  | "product.created"
  | "product.updated"
  | "product.activated"
  | "product.deactivated"
  | "category.created"
  | "category.updated"
  | "category.activated"
  | "category.deactivated"
  | "stock.adjusted"
  | "payment.recorded"
  | "load.created"
  | "load.dispatched"
  // More stock sent to a van already out on its round, mid-week.
  | "load.topped_up"
  // Stock handed back from a van to a warehouse before the Friday return.
  | "load.stock_returned"
  | "load.cancelled"
  | "return.submitted"
  | "return.approved"
  | "return.recorded"
  | "reconciliation.submitted"
  | "reconciliation.approved"
  | "reconciliation.rejected"
  | "van.created"
  | "van.updated"
  | "van.activated"
  | "van.deactivated"
  | "van.driver_assigned"
  | "van.crew_assigned"
  | "van.crew_removed"
  | "customer.created"
  | "customer.updated"
  | "customer.activated"
  | "customer.deactivated"
  | "warehouse.created"
  | "warehouse.updated"
  | "warehouse.activated"
  | "warehouse.deactivated"
  | "supplier.created"
  | "supplier.updated"
  | "supplier.activated"
  | "supplier.deactivated"
  | "purchase.created"
  | "purchase.submitted"
  | "purchase.received"
  | "purchase.cancelled"
  | "sale.recorded"
  | "sale.synced"
  | "waybill.issued"
  | "waybill.delivered"
  | "transfer.created"
  | "transfer.approved"
  | "transfer.dispatched"
  | "transfer.received"
  | "transfer.cancelled"
  | "supplier.document_filed"
  | "supplier.document_removed"
  | "supplier.portal_link_issued"
  | "supplier.portal_link_revoked"
  | "supplier.invoice_submitted"
  | "supplier.invoice_reviewing"
  | "supplier.invoice_approved"
  | "supplier.invoice_rejected"
  // Who sent a customer their receipt, and to which number. Worth
  // keeping: "we never got it" is a common enough dispute, and the
  // answer is a fact rather than a memory.
  | "receipt.issued";

export interface AuditEntry {
  action: AuditAction;
  targetType:
    | "profile" | "product" | "category" | "customer"
    | "van" | "van_load" | "van_return" | "reconciliation"
    | "warehouse" | "supplier" | "purchase_order" | "van_sale"
    | "credit_transaction"
    | "waybill" | "stock_transfer";
  targetId?: string;
  targetLabel?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

const NEVER_LOG = new Set([
  "pin", "pin_hash", "pin_salt", "password", "token", "secret", "code_hash",
]);

function scrub(input?: Record<string, unknown>): Record<string, unknown> | null {
  if (!input) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (NEVER_LOG.has(key)) continue;
    out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Never throws. A failure to record must not undo the action that was
 * already taken, but it must be visible to whoever runs the system.
 */
export async function recordAudit(actor: AuthenticatedUser, entry: AuditEntry): Promise<void> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for");

    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("audit_log").insert({
      org_id: actor.organizationId,
      actor_id: actor.id,
      actor_name: actor.fullName,
      actor_role: actor.role,
      action: entry.action,
      target_type: entry.targetType,
      target_id: entry.targetId ?? null,
      target_label: entry.targetLabel ?? null,
      before: scrub(entry.before),
      after: scrub(entry.after),
      request_ip: forwarded?.split(",")[0]?.trim() ?? null,
      user_agent: h.get("user-agent"),
    });

    if (error) console.error("[audit] could not record", entry.action, error);
  } catch (error) {
    console.error("[audit] could not record", entry.action, error);
  }
}
