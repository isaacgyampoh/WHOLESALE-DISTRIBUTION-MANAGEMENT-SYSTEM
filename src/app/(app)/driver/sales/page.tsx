import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { listSales, PAGE_SIZE } from "@/features/commercial/queries";
import { SalesList } from "@/features/commercial/sales-list";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ListFilters } from "@/components/ui/list-filters";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { StatTile, StatGrid } from "@/components/ui/stat-tile";
import { formatMoney, formatQuantity } from "@/lib/utils/format";
import { Receipt } from "lucide-react";

export const metadata: Metadata = { title: "My sales" };

const PERIODS: Record<string, number> = { "1": 1, "7": 7, "30": 30 };

/**
 * What this driver has sold.
 *
 * Scoped to them twice over: the query asks for their id, and the
 * database's own driver policies would return nothing else regardless.
 */
export default async function DriverSalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const filters = await searchParams;
  const periodDays = PERIODS[filters.period ?? "1"] ?? 1;

  const result = await listSales({
    driverId: user.id,
    search: filters.search,
    saleType: filters.saleType,
    periodDays,
    page: Number(filters.page ?? 1),
  });

  const sales = result.ok ? result.data.sales : [];
  const cash = sales.filter((s) => s.saleType === "cash").reduce((s, r) => s + r.total, 0);
  const credit = sales.filter((s) => s.saleType === "credit").reduce((s, r) => s + r.total, 0);

  return (
    <>
      <PageHeader
        title="My sales"
        description="Everything you have sold, newest first."
        breadcrumbs={[{ label: "My round", href: "/driver" }, { label: "My sales" }]}
      />

      {!result.ok ? (
        <Card><ErrorState title="Your sales could not be loaded" message={result.message} /></Card>
      ) : (
        <>
          <StatGrid>
            <StatTile label="Sales" value={formatQuantity(result.data.total)}
                      sub={periodDays === 1 ? "Today" : `Last ${periodDays} days`} />
            <StatTile label="Cash" value={formatMoney(cash)} sub="Paid at the point of sale"
                      tone="positive" />
            <StatTile label="Credit" value={formatMoney(credit)} sub="Still owed"
                      tone={credit > 0 ? "caution" : "neutral"} />
            <StatTile label="Together" value={formatMoney(cash + credit)} sub="On this page" />
          </StatGrid>

          <ListFilters
            searchPlaceholder="Search by sale number"
            searchLabel="Search my sales"
            selects={[
              {
                name: "period", label: "Period", allLabel: "Today",
                options: [
                  { value: "1", label: "Today" },
                  { value: "7", label: "Last 7 days" },
                  { value: "30", label: "Last 30 days" },
                ],
                className: "lg:w-40",
              },
              {
                name: "saleType", label: "Cash or credit", allLabel: "Cash and credit",
                options: [
                  { value: "cash", label: "Cash only" },
                  { value: "credit", label: "Credit only" },
                ],
                className: "lg:w-44",
              },
            ]}
            count={result.data.total}
            noun="sale"
          />

          <Card className="overflow-hidden">
            {sales.length === 0 ? (
              <EmptyState
                icon={Receipt}
                title="Nothing sold in this period"
                description="Sales you record from the van show up here straight away."
              />
            ) : (
              <SalesList sales={sales} />
            )}
          </Card>

          <Pagination page={result.data.page} pageSize={PAGE_SIZE}
                      total={result.data.total} params={filters} />
        </>
      )}
    </>
  );
}
