import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import {
  salesByProduct, salesBySalesperson, lowStockReport,
  customerBalanceReport, inventoryValueReport,
  salesByPeriod, salesByCustomer, salesByVan, salesByMethod,
  expiryReport, purchasesBySupplier, reconciliationReport,
} from "@/features/reports/queries";
import { toCsv, csvFileName, csvResponse, type CsvColumn } from "@/lib/utils/csv";

/**
 * Reports as CSV.
 *
 * Authorised here rather than by hiding the button. A route handler is a
 * URL, and a URL is something anybody with a session can type: the
 * financial reports are gated on the same permission the screen uses,
 * and a role without it gets a 403 rather than a file.
 *
 * The rows come from the same query functions the screen uses, under the
 * caller's own session - so a category manager exports their categories,
 * and the export cannot show more than the page did.
 */

export const dynamic = "force-dynamic";

const PERIODS = new Set([7, 30, 90, 365]);

/** Each report: what it is called, who may have it, and its columns. */
interface Report {
  name: string;
  /** Financial reports need this on top of reports.view. */
  financial?: boolean;
  render: (periodDays: number) => Promise<
    { ok: true; csv: string } | { ok: false; message: string }
  >;
}

/**
 * Keeps each report's row type while erasing it at the boundary, so the
 * columns below are checked against the shape the query actually
 * returns rather than against `unknown`.
 */
function report<T>(
  name: string,
  load: (periodDays: number) => Promise<
    { ok: true; data: T[] } | { ok: false; message: string } | null
  >,
  columns: CsvColumn<T>[],
  financial = false,
): Report {
  return {
    name,
    financial,
    render: async (periodDays) => {
      const result = await load(periodDays);
      if (!result || !result.ok) {
        return { ok: false, message: result?.message ?? "That report is unavailable." };
      }
      return { ok: true, csv: toCsv(columns, result.data) };
    },
  };
}

const REPORTS: Record<string, Report> = {
  "sales-by-product": report(
    "sales-by-product",
    (days) => salesByProduct(days),
    [
      { header: "SKU", value: (r) => r.sku },
      { header: "Product", value: (r) => r.name },
      { header: "Units sold", value: (r) => r.quantity },
      { header: "Revenue (GHS)", value: (r) => r.revenue },
    ],
  ),
  "sales-by-salesperson": report(
    "sales-by-salesperson",
    (days) => salesBySalesperson(days),
    [
      { header: "Salesperson", value: (r) => r.salespersonName },
      { header: "Sales", value: (r) => r.saleCount },
      { header: "Revenue (GHS)", value: (r) => r.revenue },
      { header: "Cash (GHS)", value: (r) => r.cash },
      { header: "Credit (GHS)", value: (r) => r.credit },
      { header: "Outstanding (GHS)", value: (r) => r.outstanding },
    ],
    true,
  ),
  "low-stock": report(
    "low-stock",
    () => lowStockReport(),
    [
      { header: "SKU", value: (r) => r.sku },
      { header: "Product", value: (r) => r.name },
      { header: "Available", value: (r) => r.available },
      { header: "Reorder at", value: (r) => r.reorderPoint },
      { header: "Suggested order", value: (r) => r.reorderQty },
      { header: "Stock value (GHS)", value: (r) => r.stockValue },
    ],
  ),
  "customer-balances": report(
    "customer-balances",
    () => customerBalanceReport(),
    [
      { header: "Code", value: (r) => r.code },
      { header: "Customer", value: (r) => r.name },
      { header: "Credit limit (GHS)", value: (r) => r.creditLimit },
      { header: "Balance (GHS)", value: (r) => r.balance },
      { header: "Credit available (GHS)", value: (r) => r.creditAvailable },
      { header: "Days past due", value: (r) => r.daysPastDue ?? 0 },
      { header: "Over limit", value: (r) => r.overLimit },
    ],
    true,
  ),
  "inventory-value": report(
    "inventory-value",
    () => inventoryValueReport(),
    [
      { header: "Category", value: (r) => r.categoryName },
      { header: "Product lines", value: (r) => r.productLines },
      { header: "Units", value: (r) => r.units },
      { header: "Value at cost (GHS)", value: (r) => r.value },
    ],
    true,
  ),
  "sales-daily": report(
    "sales-daily",
    (days) => salesByPeriod("day", days),
    [
      { header: "Date", value: (r) => r.period },
      { header: "Sales", value: (r) => r.saleCount },
      { header: "Revenue (GHS)", value: (r) => r.revenue },
      { header: "Cash (GHS)", value: (r) => r.cash },
      { header: "Credit (GHS)", value: (r) => r.credit },
    ],
  ),
  "sales-weekly": report(
    "sales-weekly",
    (days) => salesByPeriod("week", days),
    [
      { header: "Week beginning", value: (r) => r.period },
      { header: "Sales", value: (r) => r.saleCount },
      { header: "Revenue (GHS)", value: (r) => r.revenue },
      { header: "Cash (GHS)", value: (r) => r.cash },
      { header: "Credit (GHS)", value: (r) => r.credit },
    ],
  ),
  "sales-monthly": report(
    "sales-monthly",
    (days) => salesByPeriod("month", days),
    [
      { header: "Month", value: (r) => r.period },
      { header: "Sales", value: (r) => r.saleCount },
      { header: "Revenue (GHS)", value: (r) => r.revenue },
      { header: "Cash (GHS)", value: (r) => r.cash },
      { header: "Credit (GHS)", value: (r) => r.credit },
    ],
  ),
  "sales-by-customer": report(
    "sales-by-customer",
    (days) => salesByCustomer(days),
    [
      { header: "Code", value: (r) => r.code },
      { header: "Customer", value: (r) => r.name },
      { header: "Sales", value: (r) => r.saleCount },
      { header: "Revenue (GHS)", value: (r) => r.revenue },
      { header: "Outstanding (GHS)", value: (r) => r.outstanding },
      { header: "Last bought", value: (r) => r.lastBought?.slice(0, 10) ?? "" },
    ],
    true,
  ),
  "sales-by-van": report(
    "sales-by-van",
    (days) => salesByVan(days),
    [
      { header: "Van", value: (r) => r.vanCode },
      { header: "Registration", value: (r) => r.registration },
      { header: "Sales", value: (r) => r.saleCount },
      { header: "Revenue (GHS)", value: (r) => r.revenue },
      { header: "Cash (GHS)", value: (r) => r.cash },
      { header: "Credit (GHS)", value: (r) => r.credit },
    ],
    true,
  ),
  "sales-by-method": report(
    "sales-by-method",
    (days) => salesByMethod(days),
    [
      { header: "Method", value: (r) => r.label },
      { header: "Payments", value: (r) => r.count },
      { header: "Amount (GHS)", value: (r) => r.amount },
    ],
    true,
  ),
  expiry: report(
    "expiry",
    () => expiryReport(),
    [
      { header: "Batch", value: (r) => r.batchNumber },
      { header: "SKU", value: (r) => r.sku },
      { header: "Product", value: (r) => r.productName },
      { header: "Warehouse", value: (r) => r.warehouseName },
      { header: "Expires", value: (r) => r.expiresOn ?? "" },
      { header: "Days to expiry", value: (r) => r.daysToExpiry ?? "" },
      { header: "Units remaining", value: (r) => r.qtyRemaining },
      { header: "Status", value: (r) => r.status },
    ],
  ),
  "purchases-by-supplier": report(
    "purchases-by-supplier",
    () => purchasesBySupplier(),
    [
      { header: "Code", value: (r) => r.code },
      { header: "Supplier", value: (r) => r.name },
      { header: "Open orders", value: (r) => r.orderCount },
      { header: "On order (GHS)", value: (r) => r.ordered },
      { header: "Received (GHS)", value: (r) => r.received },
      { header: "Invoiced (GHS)", value: (r) => r.invoiced },
      { header: "Invoices awaiting review", value: (r) => r.awaitingReview },
    ],
    true,
  ),
  reconciliation: report(
    "reconciliation",
    (days) => reconciliationReport(days),
    [
      { header: "Reference", value: (r) => r.reconNumber },
      { header: "Van", value: (r) => r.vanCode },
      { header: "Driver", value: (r) => r.driverName },
      { header: "Status", value: (r) => r.status },
      { header: "Expected cash (GHS)", value: (r) => r.expectedCash },
      { header: "Counted cash (GHS)", value: (r) => r.actualCash },
      { header: "Cash variance (GHS)", value: (r) => r.cashVariance },
      { header: "Mobile money (GHS)", value: (r) => r.expectedMomo },
      { header: "Stock variance (GHS)", value: (r) => r.stockVariance },
      { header: "Submitted", value: (r) => r.submittedAt?.slice(0, 10) ?? "" },
    ],
    true,
  ),
};

export async function GET(request: Request) {
  const user = await requireUser();
  if (!can(user.role, "reports.view")) {
    return new Response("Not permitted", { status: 403 });
  }

  const url = new URL(request.url);
  const key = url.searchParams.get("report") ?? "";
  const chosen = REPORTS[key];

  if (!chosen) return new Response("Unknown report", { status: 404 });

  // Value at cost and what customers owe are management information, on
  // the same rule as cost price on a product.
  if (chosen.financial && !can(user.role, "credit.view")) {
    return new Response("Not permitted", { status: 403 });
  }

  const requested = Number(url.searchParams.get("period") ?? 30);
  const periodDays = PERIODS.has(requested) ? requested : 30;

  const rendered = await chosen.render(periodDays);
  if (!rendered.ok) return new Response(rendered.message, { status: 503 });

  return csvResponse(
    rendered.csv,
    csvFileName(chosen.name, new Date().toISOString().slice(0, 10)),
  );
}
