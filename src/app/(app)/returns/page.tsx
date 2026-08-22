import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { listReturns, PAGE_SIZE } from "@/features/distribution/queries";
import { ReturnList } from "@/features/distribution/return-list";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card } from "@/components/ui/card";
import { StatTile, StatGrid } from "@/components/ui/stat-tile";
import { ListFilters } from "@/components/ui/list-filters";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, ErrorState, Alert } from "@/components/ui/states";
import { formatQuantity } from "@/lib/utils/format";
import { Undo2, SearchX } from "lucide-react";

export const metadata: Metadata = { title: "Returns" };

const STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user.role, "returns.view")) return <Forbidden />;

  const filters = await searchParams;
  const result = await listReturns({
    status: filters.status,
    search: filters.search,
    page: Number(filters.page ?? 1),
  });

  const narrowed = Boolean(filters.search || (filters.status && filters.status !== "all"));
  const pending = result.ok ? result.data.returns.filter((r) => r.status === "submitted").length : 0;

  return (
    <>
      <PageHeader
        title="Returns"
        description="Stock coming back off a van at the end of a round."
        breadcrumbs={[{ label: "Distribution" }, { label: "Returns" }]}
      />

      {!result.ok ? (
        <Card><ErrorState title="Returns could not be loaded" message={result.message} /></Card>
      ) : (
        <>
          <StatGrid>
            <StatTile label="Returns" value={formatQuantity(result.data.total)} sub="Matching this view" />
            <StatTile label="Awaiting approval" value={formatQuantity(pending)}
                      sub="Submitted by a driver"
                      tone={pending > 0 ? "caution" : "neutral"} />
            <StatTile label="Damaged units"
                      value={formatQuantity(result.data.returns.reduce((s, r) => s + r.qtyDamaged, 0))}
                      sub="On this page"
                      tone={result.data.returns.some((r) => r.qtyDamaged > 0) ? "caution" : "neutral"} />
            <StatTile label="Missing units"
                      value={formatQuantity(result.data.returns.reduce((s, r) => s + r.qtyMissing, 0))}
                      sub="Unaccounted for"
                      tone={result.data.returns.some((r) => r.qtyMissing > 0) ? "critical" : "neutral"} />
          </StatGrid>

          {can(user.role, "returns.approve") && pending > 0 && (
            <div className="mb-5">
              <Alert tone="warning" title="Returns waiting on you">
                {pending} {pending === 1 ? "return has" : "returns have"} been submitted and
                not yet approved. Stock rejoins the warehouse only once a return is approved.
              </Alert>
            </div>
          )}

          <ListFilters
            searchPlaceholder="Search by return number"
            searchLabel="Search returns"
            selects={[{
              name: "status", label: "Filter by status",
              allLabel: "All statuses", options: STATUSES, className: "lg:w-52",
            }]}
            count={result.data.total}
            noun="return"
          />

          <Card className="overflow-hidden">
            {result.data.returns.length === 0 ? (
              narrowed ? (
                <EmptyState icon={SearchX} title="No returns match those filters"
                            description="Try a different status or return number." />
              ) : (
                <EmptyState icon={Undo2} title="No returns yet"
                            description="A return records what came back when a van finished its round." />
              )
            ) : (
              <ReturnList returns={result.data.returns}
                        canApprove={can(user.role, "returns.approve")} />
            )}
          </Card>

          <Pagination page={result.data.page} pageSize={PAGE_SIZE}
                      total={result.data.total} params={filters} />
        </>
      )}
    </>
  );
}
