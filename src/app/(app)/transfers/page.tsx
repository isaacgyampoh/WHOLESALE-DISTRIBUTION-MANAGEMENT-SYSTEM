import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import {
  listTransfers, getTransferSummary, getTransferOptions, PAGE_SIZE,
} from "@/features/transfers/queries";
import { TransferList } from "@/features/transfers/transfer-list";
import { CreateTransferButton } from "@/features/transfers/transfer-forms";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card } from "@/components/ui/card";
import { StatTile, StatGrid } from "@/components/ui/stat-tile";
import { ListFilters } from "@/components/ui/list-filters";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { formatQuantity } from "@/lib/utils/format";
import { ArrowLeftRight, SearchX } from "lucide-react";

export const metadata: Metadata = { title: "Transfers" };

export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user.role, "inventory.transfer")) return <Forbidden />;

  const filters = await searchParams;
  const [result, summary, options] = await Promise.all([
    listTransfers({
      status: filters.status,
      search: filters.search,
      page: Number(filters.page ?? 1),
    }),
    getTransferSummary(),
    getTransferOptions(),
  ]);

  const narrowed = Boolean(filters.search || (filters.status && filters.status !== "all"));

  return (
    <>
      <PageHeader
        title="Transfers"
        description="Stock moving between your own warehouses, with a document behind it."
        breadcrumbs={[{ label: "Warehouse" }, { label: "Transfers" }]}
        actions={
          options.ok ? (
            <CreateTransferButton
              warehouses={options.data.warehouses}
              products={options.data.products}
            />
          ) : undefined
        }
      />

      {summary.ok && (
        <StatGrid>
          <StatTile label="Awaiting approval" value={formatQuantity(summary.data.awaitingApproval)}
                    sub="Nothing moves until a manager agrees"
                    tone={summary.data.awaitingApproval > 0 ? "caution" : "neutral"}
                    href="/transfers?status=draft" />
          <StatTile label="In transit" value={formatQuantity(summary.data.inTransit)}
                    sub="Left one depot, not yet at the other"
                    href="/transfers?status=in_transit" />
          <StatTile label="Units on the road" value={formatQuantity(summary.data.unitsInTransit)}
                    sub="Counted in no warehouse" />
          <StatTile label="Short this month" value={formatQuantity(summary.data.shortThisMonth)}
                    sub="Sent but never arrived"
                    tone={summary.data.shortThisMonth > 0 ? "critical" : "positive"} />
        </StatGrid>
      )}

      {!result.ok ? (
        <Card><ErrorState title="Transfers could not be loaded" message={result.message} /></Card>
      ) : (
        <>
          <ListFilters
            searchPlaceholder="Search by transfer number"
            searchLabel="Search transfers"
            selects={[{
              name: "status", label: "Filter by status", allLabel: "Any status",
              options: [
                { value: "open", label: "Still open" },
                { value: "draft", label: "Awaiting approval" },
                { value: "approved", label: "Approved" },
                { value: "in_transit", label: "In transit" },
                { value: "received", label: "Received" },
              ],
              className: "lg:w-52",
            }]}
            count={result.data.total}
            noun="transfer"
          />

          <Card className="overflow-hidden">
            {result.data.transfers.length === 0 ? (
              narrowed ? (
                <EmptyState icon={SearchX} title="No transfers match those filters"
                            description="Try a different status or number." />
              ) : (
                <EmptyState
                  icon={ArrowLeftRight}
                  title="No transfers yet"
                  description="Raise one to move stock between warehouses with a document behind it, rather than as two adjustments."
                />
              )
            ) : (
              <TransferList transfers={result.data.transfers} />
            )}
          </Card>

          <Pagination page={result.data.page} pageSize={PAGE_SIZE}
                      total={result.data.total} params={filters} />
        </>
      )}
    </>
  );
}
