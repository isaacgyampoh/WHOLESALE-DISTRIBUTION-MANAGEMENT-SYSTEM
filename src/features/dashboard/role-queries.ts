import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCapabilities } from "@/lib/db/capabilities";
import { parseAmount } from "@/lib/utils/format";

/**
 * What each job needs to see first thing in the morning.
 *
 * A single dashboard for everybody is a dashboard for nobody: the
 * accountant opens it to find out what is owed, the warehouse to find
 * out what has to move, and neither wants to read past the other's
 * figures to get there. These are the numbers each of those jobs is
 * actually accountable for.
 *
 * Everything runs under the caller's own session, so row level security
 * decides what is counted. A figure here is what that person is
 * responsible for, not a company total they cannot act on.
 */

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

// ===================================================================
// The accountant: what is owed, and what came in
// ===================================================================

export interface AccountantView {
  outstanding: number;
  overdue: number;
  overdueCount: number;
  /** Oldest to newest, so a conversation can be prioritised. */
  ageing: { bucket: string; count: number; amount: number }[];
  collectedThisWeek: number;
  collectedToday: number;
  cashThisWeek: number;
  momoThisWeek: number;
  invoicedThisMonth: number;
  reconciliationsWaiting: number;
  /** The biggest debts, which is where a morning's chasing goes. */
  topDebtors: { id: string; name: string; balance: number; daysPastDue: number }[];
}

export async function getAccountantView(): Promise<AccountantView> {
  const supabase = await createSupabaseServerClient();
  const { documents } = await getCapabilities();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [ageing, collections, invoices, recons, debtors] = await Promise.all([
    supabase.from("invoice_ageing").select("bucket, balance"),
    supabase
      .from("credit_transactions")
      .select("amount, reference_type, created_at")
      .eq("type", "payment")
      .gte("created_at", daysAgo(7)),
    documents
      ? supabase.from("invoices").select("total, issue_date").gte(
          "issue_date", monthStart.toISOString().slice(0, 10))
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("van_reconciliations")
      .select("id", { count: "exact", head: true })
      .eq("status", "submitted"),
    supabase
      .from("customer_credit_position")
      .select("customer_id, name, ledger_balance, days_past_due")
      .gt("ledger_balance", 0)
      .order("ledger_balance", { ascending: false })
      .limit(5),
  ]);

  const ageingRows = (ageing.data ?? []) as unknown as Record<string, unknown>[];
  const open = ageingRows.filter((r) => parseAmount(r.balance as string) > 0);

  // Buckets in the order a person reads them, and only the ones that
  // have something in them.
  const ORDER = ["current", "1-30", "31-60", "61-90", "90+", "91+"];
  const byBucket = new Map<string, { count: number; amount: number }>();
  for (const row of open) {
    const bucket = (row.bucket as string) ?? "current";
    const entry = byBucket.get(bucket) ?? { count: 0, amount: 0 };
    entry.count += 1;
    entry.amount += parseAmount(row.balance as string);
    byBucket.set(bucket, entry);
  }

  const payments = ((collections.data ?? []) as unknown as Record<string, unknown>[])
    // Stored as a negative on the ledger, because that is what a payment
    // does to a balance. Read as a positive amount received.
    .map((p) => ({
      amount: Math.abs(parseAmount(p.amount as string)),
      method: (p.reference_type as string) ?? "cash",
      at: new Date(p.created_at as string),
    }));

  const today = startOfToday();
  const overdueRows = open.filter((r) => {
    const bucket = (r.bucket as string) ?? "current";
    return bucket !== "current" && bucket !== "settled";
  });

  return {
    outstanding: open.reduce((s, r) => s + parseAmount(r.balance as string), 0),
    overdue: overdueRows.reduce((s, r) => s + parseAmount(r.balance as string), 0),
    overdueCount: overdueRows.length,
    ageing: ORDER.filter((b) => byBucket.has(b)).map((bucket) => ({
      bucket,
      count: byBucket.get(bucket)!.count,
      amount: byBucket.get(bucket)!.amount,
    })),
    collectedThisWeek: payments.reduce((s, p) => s + p.amount, 0),
    collectedToday: payments.filter((p) => p.at >= today).reduce((s, p) => s + p.amount, 0),
    cashThisWeek: payments.filter((p) => p.method === "cash").reduce((s, p) => s + p.amount, 0),
    momoThisWeek: payments
      .filter((p) => p.method === "mobile_money")
      .reduce((s, p) => s + p.amount, 0),
    invoicedThisMonth: ((invoices.data ?? []) as unknown as Record<string, unknown>[])
      .reduce((s, i) => s + parseAmount(i.total as string), 0),
    reconciliationsWaiting: recons.count ?? 0,
    topDebtors: ((debtors.data ?? []) as unknown as Record<string, unknown>[]).map((d) => ({
      id: d.customer_id as string,
      name: (d.name as string) ?? "Unknown customer",
      balance: parseAmount(d.ledger_balance as string),
      daysPastDue: Number(d.days_past_due ?? 0),
    })),
  };
}

// ===================================================================
// The warehouse: what has to move today
// ===================================================================

export interface WarehouseView {
  stockValue: number;
  lowStockCount: number;
  expiredBatches: number;
  expiringBatches: number;
  loadsToDispatch: number;
  returnsToApprove: number;
  transfersToDispatch: number;
  transfersInTransit: number;
  transfersToReceive: number;
  purchasesExpected: number;
  /** What is on the road, oldest first: the ones somebody has lost track of. */
  inTransit: {
    transferNumber: string; fromWarehouse: string; toWarehouse: string;
    productName: string; quantity: number; daysInTransit: number;
  }[];
}

export async function getWarehouseView(): Promise<WarehouseView> {
  const supabase = await createSupabaseServerClient();
  const { batchesAndExpiry, warehouseTransfers } = await getCapabilities();

  const [stock, expiry, loads, returns, transfers, transit, purchases] = await Promise.all([
    supabase.from("stock_summary").select("stock_value, needs_reorder, reorder_point, is_active"),
    batchesAndExpiry
      ? supabase.from("batch_expiry_status").select("status").gt("qty_remaining", 0)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("van_loads").select("id", { count: "exact", head: true }).eq("status", "loaded"),
    supabase.from("van_returns").select("id", { count: "exact", head: true })
      .eq("status", "submitted"),
    warehouseTransfers
      ? supabase.from("stock_transfers").select("status")
          .in("status", ["approved", "in_transit"])
      : Promise.resolve({ data: [], error: null }),
    warehouseTransfers
      ? supabase.from("stock_in_transit").select("*")
          .order("days_in_transit", { ascending: false }).limit(6)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("purchase_orders").select("id", { count: "exact", head: true })
      .in("status", ["submitted", "partially_received"]),
  ]);

  const stockRows = ((stock.data ?? []) as unknown as Record<string, unknown>[])
    .filter((r) => r.is_active);
  const batches = ((expiry.data ?? []) as unknown as Record<string, unknown>[]);
  const transferRows = ((transfers.data ?? []) as unknown as Record<string, unknown>[]);

  return {
    stockValue: stockRows.reduce((s, r) => s + parseAmount(r.stock_value as string), 0),
    lowStockCount: stockRows.filter(
      (r) => r.needs_reorder && Number(r.reorder_point ?? 0) > 0).length,
    expiredBatches: batches.filter((b) => b.status === "expired").length,
    expiringBatches: batches.filter((b) => b.status === "expiring").length,
    loadsToDispatch: loads.count ?? 0,
    returnsToApprove: returns.count ?? 0,
    transfersToDispatch: transferRows.filter((t) => t.status === "approved").length,
    transfersInTransit: transferRows.filter((t) => t.status === "in_transit").length,
    // Receiving is what somebody at the far end does, and it is the same
    // set as what is on the road.
    transfersToReceive: transferRows.filter((t) => t.status === "in_transit").length,
    purchasesExpected: purchases.count ?? 0,
    inTransit: ((transit.data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      transferNumber: r.transfer_number as string,
      fromWarehouse: r.from_warehouse as string,
      toWarehouse: r.to_warehouse as string,
      productName: r.product_name as string,
      quantity: Number(r.quantity ?? 0),
      daysInTransit: Number(r.days_in_transit ?? 0),
    })),
  };
}

// ===================================================================
// The administrator: is the system itself healthy
// ===================================================================

export interface AdminView {
  /** Revenue less what the goods cost us, over the period. */
  grossMargin: number;
  revenue: number;
  marginPercent: number;
  /** Everything sitting on somebody's desk rather than moving. */
  pendingApprovals: {
    reconciliations: number;
    returns: number;
    transfers: number;
    supplierInvoices: number;
  };
  activeUsers: number;
  inactiveUsers: number;
  /** Active staff who have no PIN yet, so cannot actually sign in. */
  cannotSignIn: number;
  auditEntriesToday: number;
  failedSignInsToday: number;
  /** Set when the database is behind the application. */
  pendingUpgrades: string[];
}

const UPGRADE_NAMES: Record<string, string> = {
  offlineSync: "0022 offline sync",
  maskedProductPricing: "0023 cost security",
  batchesAndExpiry: "0024 batches and expiry",
  salePaymentMethods: "0025 payment methods",
  documents: "0026 invoices and waybills",
  warehouseTransfers: "0027 warehouse transfers",
  notifications: "0028 notifications",
};

export async function getAdminView(periodDays = 30): Promise<AdminView> {
  const supabase = await createSupabaseServerClient();
  const capabilities = await getCapabilities();
  const since = startOfToday().toISOString();
  const marginSince = daysAgo(periodDays);

  const [active, inactive, pending, audit, failures,
         soldLines, recons, returns, transfers, supplierInvoices] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("is_active", false),
    // Not "pending": every profile has a role. Somebody who has been
    // activated but never given a PIN cannot sign in at all, and nobody
    // finds out until they try.
    supabase.from("profiles").select("id", { count: "exact", head: true })
      .eq("is_active", true).is("pin_set_at", null),
    supabase.from("audit_log").select("id", { count: "exact", head: true })
      .gte("created_at", since),
    supabase.from("auth_pin_attempts").select("id", { count: "exact", head: true })
      .eq("succeeded", false).gte("attempted_at", since),

    // Margin is revenue less cost, and cost is only reachable through
    // the masked view - so this figure exists for exactly the roles that
    // are allowed to see cost, and is zero for anybody else. That is the
    // right way round: a number nobody may see should not be computed
    // into a page they can read.
    capabilities.maskedProductPricing
      ? supabase
          .from("van_sale_items")
          .select("quantity, line_total, products_priced(cost_price), van_sales!inner(sold_at, status)")
          .gte("van_sales.sold_at", marginSince)
          .neq("van_sales.status", "void")
      : Promise.resolve({ data: [], error: null }),

    supabase.from("van_reconciliations").select("id", { count: "exact", head: true })
      .eq("status", "submitted"),
    supabase.from("van_returns").select("id", { count: "exact", head: true })
      .eq("status", "submitted"),
    capabilities.warehouseTransfers
      ? supabase.from("stock_transfers").select("id", { count: "exact", head: true })
          .eq("status", "draft")
      : Promise.resolve({ count: 0, error: null }),
    capabilities.supplierSubmissions
      ? supabase.from("supplier_documents").select("id", { count: "exact", head: true })
          .in("status", ["received", "reviewing"])
      : Promise.resolve({ count: 0, error: null }),
  ]);

  let revenue = 0;
  let cost = 0;
  for (const line of ((soldLines.data ?? []) as unknown as Record<string, unknown>[])) {
    const priced = line.products_priced as { cost_price?: string | null } | null;
    revenue += parseAmount(line.line_total as string);
    // A null cost means this caller may not see it. Counting it as zero
    // would report the whole sale as margin, which is worse than
    // reporting none.
    cost += parseAmount(priced?.cost_price ?? 0) * Number(line.quantity ?? 0);
  }
  const grossMargin = revenue - cost;

  return {
    revenue,
    grossMargin,
    marginPercent: revenue > 0 ? (grossMargin / revenue) * 100 : 0,
    pendingApprovals: {
      reconciliations: recons.count ?? 0,
      returns: returns.count ?? 0,
      transfers: transfers.count ?? 0,
      supplierInvoices: supplierInvoices.count ?? 0,
    },
    activeUsers: active.count ?? 0,
    inactiveUsers: inactive.count ?? 0,
    cannotSignIn: pending.count ?? 0,
    auditEntriesToday: audit.count ?? 0,
    // Counted rather than listed: the detail is on the audit screen, and
    // what belongs on a dashboard is whether it is happening at all.
    failedSignInsToday: failures.count ?? 0,
    pendingUpgrades: Object.entries(capabilities)
      .filter(([, present]) => !present)
      .map(([key]) => UPGRADE_NAMES[key] ?? key),
  };
}
