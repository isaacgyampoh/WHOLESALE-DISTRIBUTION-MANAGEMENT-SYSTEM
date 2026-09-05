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
  /** Migration 0031: suppliers submit their own invoices, and we review them. */
  supplierSubmissions: boolean;
  /** Migration 0032: a van has a crew, and a driver is not a salesperson. */
  vanCrew: boolean;
  /** Migration 0037: a photograph of what is being sold. */
  productImages: boolean;
  /**
   * Migrations 0048-0061: stock counted as full units and loose pieces.
   *
   * Probed on the last thing the set adds rather than the first, so this
   * is true only when the whole feature is there. Half of it applied is
   * the one state no screen is written for.
   */
  loosePieces: boolean;
  /** Migration 0064: a van already out can be sent more stock mid-week. */
  vanTopUps: boolean;
  /** Migration 0065: stock can go back to a warehouse before Friday. */
  vanMidweekReturns: boolean;
}

/**
 * Every capability absent.
 *
 * Derived from one list rather than written out, because a literal here
 * drifts every time a capability is added and the only thing that
 * catches it is a typecheck that has to be run.
 */
const CAPABILITY_NAMES = [
  "maskedProductPricing", "batchesAndExpiry", "offlineSync", "salePaymentMethods",
  "documents", "warehouseTransfers", "notifications", "supplierDocuments",
  "supplierPortal", "supplierSubmissions", "vanCrew", "productImages",
  "loosePieces", "vanTopUps", "vanMidweekReturns",
] as const satisfies readonly (keyof DatabaseCapabilities)[];

const NONE_AVAILABLE: DatabaseCapabilities = Object.fromEntries(
  CAPABILITY_NAMES.map((name) => [name, false]),
) as unknown as DatabaseCapabilities;

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
         supplierDocs, portal, submissions, crew, images, pieces,
         topUps, sendBacks] = await Promise.all([
    admin.from("products_priced").select("id").limit(1),
    admin.from("products").select("track_expiry").limit(1),
    admin.from("sync_operations").select("id").limit(1),
    admin.from("van_sale_payments").select("id").limit(1),
    admin.from("waybills").select("id").limit(1),
    admin.from("stock_transfer_summary").select("id").limit(1),
    admin.from("notifications").select("id").limit(1),
    admin.from("supplier_documents").select("id").limit(1),
    admin.from("supplier_portal_tokens").select("id").limit(1),
    admin.from("supplier_documents").select("status").limit(1),
    admin.from("van_crew").select("van_id").limit(1),
    admin.from("products").select("image_path").limit(1),
    admin.from("products_priced").select("piece_price").limit(1),
    admin.from("van_load_top_ups").select("id").limit(1),
    admin.from("van_midweek_returns").select("id").limit(1),
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
    supplierSubmissions: !submissions.error,
    vanCrew: !crew.error,
    productImages: !images.error,
    loosePieces: !pieces.error,
    vanTopUps: !topUps.error,
    vanMidweekReturns: !sendBacks.error,
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
    return NONE_AVAILABLE;
  });
  return inFlight;
}

/** For tests, and for a process that has just had SQL applied under it. */
export function forgetCapabilities(): void {
  cached = null;
  inFlight = null;
}
