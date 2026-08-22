import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import {
  salesByProduct, salesByDriver, lowStockReport,
  customerBalanceReport, inventoryValueReport,
  salesByPeriod, salesByCustomer, salesByVan, salesByMethod,
  expiryReport, purchasesBySupplier, reconciliationReport,
} from "@/features/reports/queries";
import { ReportCard } from "@/features/reports/report-card";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { ListFilters } from "@/components/ui/list-filters";
import { Badge, VarianceBadge } from "@/components/ui/badge";
import { PrintButton } from "@/features/documents/print-button";
import { BRAND } from "@/lib/brand";
import { formatMoney, formatQuantity, formatDate } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Reports" };

const PERIODS: Record<string, number> = { "7": 7, "30": 30, "90": 90, "365": 365 };

/** The three groupings of the same trading figures. */
type Grouping = "day" | "week" | "month";

const EXPORT_KEY: Record<Grouping, string> = {
  day: "sales-daily",
  week: "sales-weekly",
  month: "sales-monthly",
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user.role, "reports.view")) return <Forbidden />;

  const filters = await searchParams;
  const periodDays = PERIODS[filters.period ?? "30"] ?? 30;
  const grouping: Grouping =
    filters.by === "week" || filters.by === "month" ? filters.by : "day";

  // Financial reports are not every role's business. A sales rep or a
  // driver holds reports.view for the operational ones only.
  const seesMoney = can(user.role, "credit.view");
  const seesPurchasing = can(user.role, "inventory.transfer");

  const [
    trading, products, drivers, customers, vans, methods,
    lowStock, expiry, inventory, balances, purchases, reconciliations,
  ] = await Promise.all([
    salesByPeriod(grouping, periodDays),
    salesByProduct(periodDays),
    salesByDriver(periodDays),
    seesMoney ? salesByCustomer(periodDays) : Promise.resolve(null),
    seesMoney ? salesByVan(periodDays) : Promise.resolve(null),
    seesMoney ? salesByMethod(periodDays) : Promise.resolve(null),
    lowStockReport(),
    expiryReport(),
    seesMoney ? inventoryValueReport() : Promise.resolve(null),
    seesMoney ? customerBalanceReport() : Promise.resolve(null),
    seesPurchasing && seesMoney ? purchasesBySupplier() : Promise.resolve(null),
    can(user.role, "reconciliation.view")
      ? reconciliationReport(periodDays)
      : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader
        title="Reports"
        description={`Trading, stock and money over the last ${periodDays} days.`}
        breadcrumbs={[{ label: "Insight" }, { label: "Reports" }]}
        actions={<PrintButton label="Print" />}
      />

      {/* Only on paper. A printed report with no date and no name on it
          is a report nobody can file. */}
      <div className="hidden print:block">
        <p className="text-sm font-semibold">{BRAND.name}</p>
        <p className="text-xs">
          Reports for the {periodDays} days to {formatDate(new Date())} · prepared by{" "}
          {user.fullName}
        </p>
      </div>

      <div className="print-hide">
        <ListFilters
          selects={[
            {
              name: "period", label: "Reporting period", allLabel: "Last 30 days",
              options: [
                { value: "7", label: "Last 7 days" },
                { value: "30", label: "Last 30 days" },
                { value: "90", label: "Last 90 days" },
                { value: "365", label: "Last year" },
              ],
              className: "lg:w-44",
            },
            {
              name: "by", label: "Group trading by", allLabel: "By day",
              options: [
                { value: "day", label: "By day" },
                { value: "week", label: "By week" },
                { value: "month", label: "By month" },
              ],
              className: "lg:w-40",
            },
          ]}
          count={periodDays}
          noun="day"
        />
      </div>

      <section aria-label="Trading" className="space-y-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Trading
        </h2>

        <ReportCard
          title={`Sales by ${grouping}`}
          description="Every completed sale, bucketed. Newest first, because the question is almost always about recent trading."
          result={trading}
          exportKey={EXPORT_KEY[grouping]}
          periodDays={periodDays}
          emptyTitle="No sales in this period"
          emptyDescription="Nothing has been sold from a van in the period selected."
          rowKey={(r) => r.period}
          columns={[
            { header: grouping === "month" ? "Month" : "Period", cell: (r) => r.label },
            { header: "Sales", numeric: true, cell: (r) => formatQuantity(r.saleCount) },
            { header: "Cash", numeric: true, secondary: true, cell: (r) => formatMoney(r.cash) },
            { header: "Credit", numeric: true, secondary: true, cell: (r) => formatMoney(r.credit) },
            {
              header: "Revenue", numeric: true,
              cell: (r) => <span className="font-medium">{formatMoney(r.revenue)}</span>,
            },
          ]}
        />

        <ReportCard
          title="Sales by product"
          description="What is actually moving, ranked by revenue."
          result={products}
          exportKey="sales-by-product"
          periodDays={periodDays}
          emptyTitle="No sales in this period"
          emptyDescription="Nothing has been sold in the period selected."
          rowKey={(r) => r.productId}
          columns={[
            {
              header: "Product",
              cell: (r) => (
                <>
                  <span className="block font-medium">{r.name}</span>
                  <span className="numeric text-xs text-[var(--text-muted)]">{r.sku}</span>
                </>
              ),
            },
            { header: "Units", numeric: true, cell: (r) => formatQuantity(r.quantity) },
            { header: "Revenue", numeric: true, cell: (r) => formatMoney(r.revenue) },
          ]}
        />

        <ReportCard
          title="Sales by driver"
          description="Who sold what, and how much of it is still owed."
          result={drivers}
          exportKey="sales-by-driver"
          periodDays={periodDays}
          emptyTitle="No sales in this period"
          emptyDescription="No driver has recorded a sale in the period selected."
          rowKey={(r) => r.driverId}
          columns={[
            { header: "Driver", cell: (r) => r.driverName },
            { header: "Sales", numeric: true, cell: (r) => formatQuantity(r.saleCount) },
            { header: "Cash", numeric: true, secondary: true, cell: (r) => formatMoney(r.cash) },
            { header: "Credit", numeric: true, secondary: true, cell: (r) => formatMoney(r.credit) },
            { header: "Revenue", numeric: true, cell: (r) => formatMoney(r.revenue) },
            {
              header: "Outstanding", numeric: true,
              cell: (r) => (
                <span className={r.outstanding > 0 ? "text-caution" : ""}>
                  {formatMoney(r.outstanding)}
                </span>
              ),
            },
          ]}
        />

        <ReportCard
          title="Sales by customer"
          description="Who buys most, and who is carrying a balance while they do it."
          result={customers}
          exportKey="sales-by-customer"
          periodDays={periodDays}
          emptyTitle="No sales in this period"
          emptyDescription="No customer has bought anything in the period selected."
          rowKey={(r) => r.customerId}
          columns={[
            {
              header: "Customer",
              cell: (r) => (
                <>
                  <span className="block font-medium">{r.name}</span>
                  <span className="numeric text-xs text-[var(--text-muted)]">{r.code}</span>
                </>
              ),
            },
            { header: "Sales", numeric: true, cell: (r) => formatQuantity(r.saleCount) },
            {
              header: "Last bought", secondary: true,
              cell: (r) => (
                <span className="numeric text-[var(--text-secondary)]">
                  {r.lastBought ? formatDate(r.lastBought) : "—"}
                </span>
              ),
            },
            { header: "Revenue", numeric: true, cell: (r) => formatMoney(r.revenue) },
            {
              header: "Outstanding", numeric: true,
              cell: (r) => (
                <span className={r.outstanding > 0 ? "text-caution" : ""}>
                  {formatMoney(r.outstanding)}
                </span>
              ),
            },
          ]}
        />

        <ReportCard
          title="Sales by van"
          description="What each vehicle is turning over."
          result={vans}
          exportKey="sales-by-van"
          periodDays={periodDays}
          emptyTitle="No sales in this period"
          emptyDescription="No van has recorded a sale in the period selected."
          rowKey={(r) => r.vanId}
          columns={[
            {
              header: "Van",
              cell: (r) => (
                <>
                  <span className="block font-medium">{r.vanCode}</span>
                  <span className="numeric text-xs text-[var(--text-muted)]">
                    {r.registration}
                  </span>
                </>
              ),
            },
            { header: "Sales", numeric: true, cell: (r) => formatQuantity(r.saleCount) },
            { header: "Cash", numeric: true, secondary: true, cell: (r) => formatMoney(r.cash) },
            { header: "Credit", numeric: true, secondary: true, cell: (r) => formatMoney(r.credit) },
            { header: "Revenue", numeric: true, cell: (r) => formatMoney(r.revenue) },
          ]}
        />

        <ReportCard
          title="How the money came in"
          description="Cash never reaches the float and mobile money never reaches the tin. Counting them together is what makes an honest driver look short."
          result={methods}
          exportKey="sales-by-method"
          periodDays={periodDays}
          emptyTitle="No payments in this period"
          emptyDescription="Nothing has been taken in the period selected."
          rowKey={(r) => r.method}
          columns={[
            { header: "Method", cell: (r) => <Badge tone="info">{r.label}</Badge> },
            { header: "Payments", numeric: true, cell: (r) => formatQuantity(r.count) },
            {
              header: "Amount", numeric: true,
              cell: (r) => <span className="font-medium">{formatMoney(r.amount)}</span>,
            },
          ]}
        />
      </section>

      <section aria-label="Stock" className="mt-8 space-y-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Stock
        </h2>

        <ReportCard
          title="Low stock"
          description="Lines at or below their reorder point, and how many to bring in."
          result={lowStock}
          exportKey="low-stock"
          emptyTitle="Nothing needs reordering"
          emptyDescription="Every active line is above its reorder point."
          rowKey={(r) => r.productId}
          columns={[
            {
              header: "Product",
              cell: (r) => (
                <>
                  <span className="block font-medium">{r.name}</span>
                  <span className="numeric text-xs text-[var(--text-muted)]">{r.sku}</span>
                </>
              ),
            },
            {
              header: "Available", numeric: true,
              cell: (r) => <span className="text-critical">{formatQuantity(r.available)}</span>,
            },
            {
              header: "Reorder at", numeric: true, secondary: true,
              cell: (r) => formatQuantity(r.reorderPoint),
            },
            { header: "Suggested", numeric: true, cell: (r) => formatQuantity(r.reorderQty) },
          ]}
        />

        <ReportCard
          title="Expiring and expired"
          description="Stock that has gone off, and stock about to. Nothing expired may be loaded onto a van or transferred."
          result={expiry}
          exportKey="expiry"
          emptyTitle="Nothing is going out of date"
          emptyDescription="No batch is expired or inside its warning period."
          rowKey={(r, i) => `${r.batchNumber}-${i}`}
          columns={[
            {
              header: "Product",
              cell: (r) => (
                <>
                  <span className="block font-medium">{r.productName}</span>
                  <span className="numeric text-xs text-[var(--text-muted)]">
                    {r.batchNumber}
                  </span>
                </>
              ),
            },
            {
              header: "Warehouse", secondary: true,
              cell: (r) => <span className="text-[var(--text-secondary)]">{r.warehouseName}</span>,
            },
            {
              header: "Expires",
              cell: (r) => (
                <span className="numeric whitespace-nowrap">
                  {r.expiresOn ? formatDate(r.expiresOn) : "—"}
                </span>
              ),
            },
            { header: "Units", numeric: true, cell: (r) => formatQuantity(r.qtyRemaining) },
            {
              header: "Status",
              cell: (r) => (
                <Badge tone={r.status === "expired" ? "critical" : "caution"}>
                  {r.status === "expired" ? "Expired" : `${r.daysToExpiry ?? 0} days left`}
                </Badge>
              ),
            },
          ]}
        />

        <ReportCard
          title="Inventory value by category"
          description="Where the money on the shelves is sitting, at cost."
          result={inventory}
          exportKey="inventory-value"
          emptyTitle="No stock to value"
          emptyDescription="No active product is carrying stock."
          rowKey={(r, i) => `${r.categoryName}-${i}`}
          columns={[
            { header: "Category", cell: (r) => r.categoryName },
            {
              header: "Lines", numeric: true, secondary: true,
              cell: (r) => formatQuantity(r.productLines),
            },
            { header: "Units", numeric: true, cell: (r) => formatQuantity(r.units) },
            { header: "Value at cost", numeric: true, cell: (r) => formatMoney(r.value) },
          ]}
        />
      </section>

      <section aria-label="Money" className="mt-8 space-y-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Money
        </h2>

        <ReportCard
          title="Customer balances"
          description="Who owes what, and how far past due they are."
          result={balances}
          exportKey="customer-balances"
          emptyTitle="Nothing outstanding"
          emptyDescription="No customer is carrying a balance."
          rowKey={(r) => r.customerId}
          columns={[
            {
              header: "Customer",
              cell: (r) => (
                <>
                  <span className="block font-medium">{r.name}</span>
                  <span className="numeric text-xs text-[var(--text-muted)]">{r.code}</span>
                </>
              ),
            },
            {
              header: "Limit", numeric: true, secondary: true,
              cell: (r) => formatMoney(r.creditLimit),
            },
            {
              header: "Balance", numeric: true,
              cell: (r) => (
                <span className={r.overLimit ? "font-medium text-critical" : ""}>
                  {formatMoney(r.balance)}
                </span>
              ),
            },
            {
              header: "Available", numeric: true, secondary: true,
              cell: (r) => formatMoney(r.creditAvailable),
            },
            {
              header: "Age",
              cell: (r) =>
                r.daysPastDue && r.daysPastDue > 0 ? (
                  <Badge tone={r.daysPastDue > 60 ? "critical" : "caution"}>
                    {r.daysPastDue} days
                  </Badge>
                ) : (
                  <Badge tone="positive">Within terms</Badge>
                ),
            },
          ]}
        />

        <ReportCard
          title="Suppliers"
          description="What each supplier has delivered, what they have billed, and how much of their paperwork is waiting on somebody here."
          result={purchases}
          exportKey="purchases-by-supplier"
          emptyTitle="No suppliers yet"
          emptyDescription="Nothing has been ordered from anybody."
          rowKey={(r) => r.supplierId}
          columns={[
            {
              header: "Supplier",
              cell: (r) => (
                <Link href={`/suppliers/${r.supplierId}`} className="font-medium hover:underline">
                  {r.name}
                </Link>
              ),
            },
            {
              header: "Open orders", numeric: true, secondary: true,
              cell: (r) => formatQuantity(r.orderCount),
            },
            {
              header: "On order", numeric: true, secondary: true,
              cell: (r) => formatMoney(r.ordered),
            },
            { header: "Received", numeric: true, cell: (r) => formatMoney(r.received) },
            { header: "Invoiced", numeric: true, cell: (r) => formatMoney(r.invoiced) },
            {
              header: "To review",
              cell: (r) =>
                r.awaitingReview > 0 ? (
                  <Badge tone="caution">{formatQuantity(r.awaitingReview)}</Badge>
                ) : (
                  <span className="text-[var(--text-muted)]">—</span>
                ),
            },
          ]}
        />

        <ReportCard
          title="End of day"
          description="What each round was expected to bring back against what it did."
          result={reconciliations}
          exportKey="reconciliation"
          periodDays={periodDays}
          emptyTitle="No rounds closed in this period"
          emptyDescription="No driver has submitted an end of day in the period selected."
          rowKey={(r) => r.reconNumber}
          columns={[
            {
              header: "Round",
              cell: (r) => (
                <>
                  <span className="numeric block font-medium">{r.reconNumber}</span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {r.driverName} · {r.vanCode}
                  </span>
                </>
              ),
            },
            {
              header: "Expected", numeric: true, secondary: true,
              cell: (r) => formatMoney(r.expectedCash),
            },
            { header: "Counted", numeric: true, cell: (r) => formatMoney(r.actualCash) },
            {
              header: "Mobile money", numeric: true, secondary: true,
              cell: (r) => formatMoney(r.expectedMomo),
            },
            { header: "Cash", numeric: true, cell: (r) => <VarianceBadge value={r.cashVariance} /> },
            {
              header: "Stock", numeric: true,
              cell: (r) => <VarianceBadge value={r.stockVariance} />,
            },
          ]}
        />
      </section>
    </>
  );
}
