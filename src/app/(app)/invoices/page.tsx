import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { listInvoices, getInvoiceTotals, PAGE_SIZE } from "@/features/documents/queries";
import { InvoiceList } from "@/features/documents/invoice-list";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card } from "@/components/ui/card";
import { StatTile, StatGrid } from "@/components/ui/stat-tile";
import { ListFilters } from "@/components/ui/list-filters";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { formatMoney, formatQuantity } from "@/lib/utils/format";
import { FileText, SearchX } from "lucide-react";

export const metadata: Metadata = { title: "Invoices" };

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user.role, "documents.view")) return <Forbidden />;

  const filters = await searchParams;
  const [result, totals] = await Promise.all([
    listInvoices({
      status: filters.status,
      search: filters.search,
      customerId: filters.customer,
      page: Number(filters.page ?? 1),
    }),
    getInvoiceTotals(),
  ]);

  const narrowed = Boolean(filters.search || (filters.status && filters.status !== "all"));

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Raised automatically when a credit sale is completed."
        breadcrumbs={[{ label: "Commercial" }, { label: "Invoices" }]}
      />

      {totals.ok && (
        <StatGrid>
          <StatTile label="Outstanding" value={formatMoney(totals.data.outstanding)}
                    sub="Still to be collected"
                    tone={totals.data.outstanding > 0 ? "caution" : "positive"} />
          <StatTile label="Overdue" value={formatMoney(totals.data.overdue)}
                    sub="Past the due date"
                    tone={totals.data.overdue > 0 ? "critical" : "positive"}
                    href="/invoices?status=overdue" />
          <StatTile label="Open invoices" value={formatQuantity(totals.data.openCount)}
                    sub="With a balance" href="/invoices?status=open" />
          <StatTile label="Invoiced this month" value={formatMoney(totals.data.issuedThisMonth)}
                    sub="Value raised" />
        </StatGrid>
      )}

      {!result.ok ? (
        <Card><ErrorState title="Invoices could not be loaded" message={result.message} /></Card>
      ) : (
        <>
          <ListFilters
            searchPlaceholder="Search by invoice number or customer"
            searchLabel="Search invoices"
            selects={[{
              name: "status", label: "Filter by status", allLabel: "Any status",
              options: [
                { value: "open", label: "Outstanding" },
                { value: "overdue", label: "Overdue" },
                { value: "partially_paid", label: "Part paid" },
                { value: "paid", label: "Paid" },
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
                            description="Try a different status or reference." />
              ) : (
                <EmptyState
                  icon={FileText}
                  title="No invoices yet"
                  description="An invoice is raised on its own the moment a credit sale is completed on a round."
                />
              )
            ) : (
              <InvoiceList invoices={result.data.invoices} />
            )}
          </Card>

          <Pagination page={result.data.page} pageSize={PAGE_SIZE}
                      total={result.data.total} params={filters} />
        </>
      )}
    </>
  );
}
