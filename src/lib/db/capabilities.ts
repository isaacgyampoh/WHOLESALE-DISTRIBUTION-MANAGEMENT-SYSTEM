import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * What this database actually has.
 *
 * The schema and the application are deployed separately and on
 * purpose: a migration is never applied by a code deploy. That means
 * there is always a window where the code is ahead of the database, and
 * for a live business that window has to be survivable rather than a
 * white screen.
 *
 * This is what makes it survivable. Each capability is probed once per
 * server process and cached, and the queries that depend on one ask
 * here first rather than assuming.
 *
 * The rule for a missing capability is to fail *closed*. `products_priced`
 * masks cost per role; without it the application does not fall back to
 * reading the raw column, it stops asking for cost at all. A database
 * that is behind shows nobody the margin, which is the safe direction to
 * be wrong in.
 */

export interface DatabaseCapabilities {
  /** Migration 0023: cost masked per caller behind a view. */
  maskedProductPricing: boolean;
  /** Migration 0024: batch numbers and expiry dates. */
  batchesAndExpiry: boolean;
  /** Migration 0022: the offline sync engine the driver PWA needs. */
  offlineSync: boolean;
  /** Migration 0025: cash, mobile money and split payments on a sale. */
  salePaymentMethods: boolean;
  /** Migration 0026: invoices, receipts and waybills. */
  documents: boolean;
  /** Migration 0027: warehouse transfers with a real lifecycle. */
  warehouseTransfers: boolean;
  /** Migration 0028: in-app notifications, per role. */
  notifications: boolean;
  /** Migration 0029: supplier paperwork in a private bucket. */
  supplierDocuments: boolean;
  /** Migration 0030: expiring, revocable links for suppliers. */
  supplierPortal: boolean;
}

let cached: DatabaseCapabilities | null = null;
let inFlight: Promise<DatabaseCapabilities> | null = null;

/**
 * Probed with the service role rather than the caller's session.
 *
 * A capability is a fact about the schema, not about who is asking, and
 * asking as the caller would confuse "this database has no such view"
 * with "row level security returned you nothing".
 */
async function probe(): Promise<DatabaseCapabilities> {
  const admin = createSupabaseAdminClient();

  const [priced, batches, sync, payments, documents, transfers, alerts,
         supplierDocs, portal] = await Promise.all([
    admin.from("products_priced").select("id").limit(1),
    admin.from("products").select("track_expiry").limit(1),
    admin.from("sync_operations").select("id").limit(1),
    admin.from("van_sale_payments").select("id").limit(1),
    admin.from("waybills").select("id").limit(1),
    admin.from("stock_transfer_summary").select("id").limit(1),
    admin.from("notifications").select("id").limit(1),
    admin.from("supplier_documents").select("id").limit(1),
    admin.from("supplier_portal_tokens").select("id").limit(1),
  ]);

  const capabilities: DatabaseCapabilities = {
    maskedProductPricing: !priced.error,
    batchesAndExpiry: !batches.error,
    offlineSync: !sync.error,
    salePaymentMethods: !payments.error,
    documents: !documents.error,
    warehouseTransfers: !transfers.error,
    notifications: !alerts.error,
    supplierDocuments: !supplierDocs.error,
    supplierPortal: !portal.error,
  };

  const missing = Object.entries(capabilities)
    .filter(([, present]) => !present)
    .map(([name]) => name);

  if (missing.length) {
    // Once per process, at the point it is discovered. An operator
    // reading the logs should be told which script to run, not left to
    // infer it from a query failure.
    console.warn(
      `[database] running against a schema that is behind the application: ${missing.join(", ")} unavailable. ` +
      `Apply the pending database/UPGRADE_*.sql scripts.`,
    );
  }

  return capabilities;
}

export async function getCapabilities(): Promise<DatabaseCapabilities> {
  if (cached) return cached;
  // Concurrent first requests share one probe rather than each firing
  // three queries at a cold database.
  inFlight ??= probe().then((result) => {
    cached = result;
    inFlight = null;
    return result;
  }).catch((error) => {
    inFlight = null;
    console.error("[database] capability probe failed", error);
    // Assume the oldest schema. Everything degrades; nothing leaks.
    return {
      maskedProductPricing: false, batchesAndExpiry: false,
      offlineSync: false, salePaymentMethods: false, documents: false,
      warehouseTransfers: false, notifications: false,
      supplierDocuments: false, supplierPortal: false,
    };
  });
  return inFlight;
}

/** For tests, and for a process that has just had SQL applied under it. */
export function forgetCapabilities(): void {
  cached = null;
  inFlight = null;
}
