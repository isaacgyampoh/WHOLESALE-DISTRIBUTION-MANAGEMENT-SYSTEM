import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { listReconciliations, PAGE_SIZE } from "@/features/distribution/queries";
import { ReconciliationList } from "@/features/distribution/reconciliation-list";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card } from "@/components/ui/card";
import { StatTile, StatGrid } from "@/components/ui/stat-tile";
import { ListFilters } from "@/components/ui/list-filters";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, ErrorState, Alert } from "@/components/ui/states";
import { formatMoney, formatQuantity } from "@/lib/utils/format";
import { Scale, SearchX } from "lucide-react";

export const metadata: Metadata = { title: "Reconciliation" };

const STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "settled", label: "Settled" },
];

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user.role, "reconciliation.view")) return <Forbidden />;

  const filters = await searchParams;
  const result = await listReconciliations({
    status: filters.status,
    search: filters.search,
    page: Number(filters.page ?? 1),
  });

  const narrowed = Boolean(filters.search || (filters.status && filters.status !== "all"));
  const rows = result.ok ? result.data.reconciliations : [];
  const pending = rows.filter((r) => r.status === "submitted").length;
  const shortCash = rows.reduce((s, r) => s + Math.min(0, r.cashVariance), 0);

  return (
    <>
      <PageHeader
        title="Reconciliation"
        description="End of day: what the van should have brought back, against what it did."
        breadcrumbs={[{ label: "Distribution" }, { label: "Reconciliation" }]}
      />

      {!result.ok ? (
        <Card><ErrorState title="Reconciliations could not be loaded" message={result.message} /></Card>
      ) : (
        <>
          <StatGrid>
            <StatTile label="Reconciliations" value={formatQuantity(result.data.total)}
                      sub="Matching this view" />
            <StatTile label="Awaiting approval" value={formatQuantity(pending)}
                      sub="Submitted by a driver"
                      tone={pending > 0 ? "caution" : "neutral"} />
            <StatTile label="Cash short" value={formatMoney(Math.abs(shortCash))}
                      sub="Across this page"
                      tone={shortCash < 0 ? "critical" : "neutral"} />
            <StatTile label="Matched exactly"
                      value={formatQuantity(rows.filter((r) => r.cashVariance === 0 && r.stockVariance === 0).length)}
                      sub="No cash or stock variance"
                      tone="positive" />
          </StatGrid>

          {can(user.role, "reconciliation.approve") && pending > 0 && (
            <div className="mb-5">
              <Alert tone="warning" title="Reconciliations waiting on you">
                {pending} {pending === 1 ? "reconciliation is" : "reconciliations are"} submitted
                and unapproved. Approving one settles the round and closes its load.
              </Alert>
            </div>
          )}

          <ListFilters
            searchPlaceholder="Search by reconciliation number"
            searchLabel="Search reconciliations"
            selects={[{
              name: "status", label: "Filter by status",
              allLabel: "All statuses", options: STATUSES, className: "lg:w-52",
            }]}
            count={result.data.total}
            noun="reconciliation"
          />

          <Card className="overflow-hidden">
            {rows.length === 0 ? (
              narrowed ? (
                <EmptyState icon={SearchX} title="No reconciliations match those filters"
                            description="Try a different status or number." />
              ) : (
                <EmptyState icon={Scale} title="No reconciliations yet"
                            description="A reconciliation is raised when a van finishes its round." />
              )
            ) : (
              <ReconciliationList reconciliations={rows}
                                canApprove={can(user.role, "reconciliation.approve")} />
            )}
          </Card>

          <Pagination page={result.data.page} pageSize={PAGE_SIZE}
                      total={result.data.total} params={filters} />
        </>
      )}
    </>
  );
}
