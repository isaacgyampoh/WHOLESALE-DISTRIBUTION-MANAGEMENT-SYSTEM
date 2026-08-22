import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { listSales, getSalesSummary, PAGE_SIZE } from "@/features/commercial/queries";
import { SalesList } from "@/features/commercial/sales-list";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card } from "@/components/ui/card";
import { StatTile, StatGrid } from "@/components/ui/stat-tile";
import { ListFilters } from "@/components/ui/list-filters";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { formatMoney, formatQuantity } from "@/lib/utils/format";
import { Receipt, SearchX } from "lucide-react";

export const metadata: Metadata = { title: "Sales" };

const PERIODS: Record<string, number> = { "7": 7, "30": 30, "90": 90, "365": 365 };

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user.role, "sales.view")) return <Forbidden />;

  const filters = await searchParams;
  const periodDays = PERIODS[filters.period ?? "30"] ?? 30;

  // A driver's sales list is their own. RLS says the same; narrowing
  // here keeps the totals above the table consistent with the rows.
  const driverId = user.role === "driver" ? user.id : undefined;

  const [result, summary] = await Promise.all([
    listSales({
      search: filters.search,
      saleType: filters.saleType,
      status: filters.status,
      driverId,
      periodDays,
      page: Number(filters.page ?? 1),
    }),
    getSalesSummary(periodDays),
  ]);

  const narrowed = Boolean(
    filters.search ||
    (filters.saleType && filters.saleType !== "all") ||
    (filters.status && filters.status !== "all"),
  );

  return (
    <>
      <PageHeader
        title="Sales"
        description="Every sale made from a van, cash and credit alike."
        breadcrumbs={[{ label: "Commercial" }, { label: "Sales" }]}
      />

      {summary.ok && (
        <StatGrid>
          <StatTile label="Sales" value={formatQuantity(summary.data.saleCount)}
                    sub={`Last ${periodDays} days`} />
          <StatTile label="Value sold" value={formatMoney(summary.data.grossValue)}
                    sub={`Last ${periodDays} days`} />
          <StatTile label="Cash" value={formatMoney(summary.data.cashValue)}
                    sub="Paid at the point of sale" tone="positive" />
          <StatTile label="On credit" value={formatMoney(summary.data.creditValue)}
                    sub={`${formatMoney(summary.data.outstanding)} still outstanding`}
                    tone={summary.data.outstanding > 0 ? "caution" : "neutral"} />
        </StatGrid>
      )}

      {!result.ok ? (
        <Card><ErrorState title="Sales could not be loaded" message={result.message} /></Card>
      ) : (
        <>
          <ListFilters
            searchPlaceholder="Search by sale number"
            searchLabel="Search sales"
            selects={[
              {
                name: "period", label: "Period", allLabel: "Last 30 days",
                options: [
                  { value: "7", label: "Last 7 days" },
                  { value: "30", label: "Last 30 days" },
                  { value: "90", label: "Last 90 days" },
                  { value: "365", label: "Last year" },
                ],
                className: "lg:w-40",
              },
              {
                name: "saleType", label: "Filter by type", allLabel: "Cash and credit",
                options: [
                  { value: "cash", label: "Cash only" },
                  { value: "credit", label: "Credit only" },
                ],
                className: "lg:w-44",
              },
              {
                name: "status", label: "Filter by status", allLabel: "All statuses",
                options: [
                  { value: "draft", label: "Draft" },
                  { value: "completed", label: "Completed" },
                  { value: "void", label: "Void" },
                ],
                className: "lg:w-40",
              },
            ]}
            count={result.data.total}
            noun="sale"
          />

          <Card className="overflow-hidden">
            {result.data.sales.length === 0 ? (
              narrowed ? (
                <EmptyState icon={SearchX} title="No sales match those filters"
                            description="Try a different period, type or status." />
              ) : (
                <EmptyState icon={Receipt} title="No sales in this period"
                            description="Sales are recorded when a driver sells from a van." />
              )
            ) : (
              <SalesList sales={result.data.sales} />
            )}
          </Card>

          <Pagination page={result.data.page} pageSize={PAGE_SIZE}
                      total={result.data.total} params={filters} />
        </>
      )}
    </>
  );
}
