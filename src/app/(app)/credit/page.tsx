import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { listOverdueInvoices, getCreditSummary, PAGE_SIZE } from "@/features/commercial/queries";
import { CreditList } from "@/features/commercial/credit-list";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card } from "@/components/ui/card";
import { StatTile, StatGrid } from "@/components/ui/stat-tile";
import { ListFilters } from "@/components/ui/list-filters";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { formatMoney, formatQuantity } from "@/lib/utils/format";
import { CreditCard, SearchX } from "lucide-react";

export const metadata: Metadata = { title: "Credit" };

export default async function CreditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user.role, "credit.view")) return <Forbidden />;

  const filters = await searchParams;
  const [result, summary] = await Promise.all([
    listOverdueInvoices({
      bucket: filters.bucket,
      search: filters.search,
      page: Number(filters.page ?? 1),
    }),
    getCreditSummary(),
  ]);

  const narrowed = Boolean(filters.search || (filters.bucket && filters.bucket !== "all"));

  return (
    <>
      <PageHeader
        title="Credit"
        description="What is owed, how old it is, and who is past their limit."
        breadcrumbs={[{ label: "Commercial" }, { label: "Credit" }]}
      />

      {summary.ok && (
        <StatGrid>
          <StatTile label="Outstanding" value={formatMoney(summary.data.outstanding)}
                    sub="Across every customer"
                    tone={summary.data.outstanding > 0 ? "caution" : "positive"} />
          <StatTile label="Overdue" value={formatMoney(summary.data.overdue)}
                    sub="Past the due date"
                    tone={summary.data.overdue > 0 ? "critical" : "positive"} />
          <StatTile label="Customers owing" value={formatQuantity(summary.data.customersOwing)}
                    sub="With a balance" href="/customers?credit=owing" />
          <StatTile label="Over limit" value={formatQuantity(summary.data.overLimit)}
                    sub="Beyond their credit limit"
                    tone={summary.data.overLimit > 0 ? "critical" : "neutral"}
                    href="/customers?credit=over_limit" />
        </StatGrid>
      )}

      {!result.ok ? (
        <Card><ErrorState title="Outstanding invoices could not be loaded" message={result.message} /></Card>
      ) : (
        <>
          <ListFilters
            searchPlaceholder="Search by invoice number"
            searchLabel="Search invoices"
            selects={[{
              name: "bucket", label: "Filter by age", allLabel: "Any age",
              options: [
                { value: "current", label: "Current" },
                { value: "1-30", label: "1 to 30 days" },
                { value: "31-60", label: "31 to 60 days" },
                { value: "61-90", label: "61 to 90 days" },
                { value: "90+", label: "Over 90 days" },
              ],
              className: "lg:w-48",
            }]}
            count={result.data.total}
            noun="invoice"
          />

          <Card className="overflow-hidden">
            {result.data.invoices.length === 0 ? (
              narrowed ? (
                <EmptyState icon={SearchX} title="No invoices match those filters"
                            description="Try a different age band or invoice number." />
              ) : (
                <EmptyState icon={CreditCard} title="Nothing outstanding"
                            description="Every invoice raised has been settled." />
              )
            ) : (
              <CreditList invoices={result.data.invoices} />
            )}
          </Card>

          <Pagination page={result.data.page} pageSize={PAGE_SIZE}
                      total={result.data.total} params={filters} />
        </>
      )}
    </>
  );
}
