import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { listBatches, getExpirySummary } from "@/features/warehouses/queries";
import { getCapabilities } from "@/lib/db/capabilities";
import { BatchList } from "@/features/warehouses/batch-list";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card } from "@/components/ui/card";
import { StatTile, StatGrid } from "@/components/ui/stat-tile";
import { ListFilters } from "@/components/ui/list-filters";
import { EmptyState, ErrorState, Alert } from "@/components/ui/states";
import { formatQuantity } from "@/lib/utils/format";
import { CalendarClock, SearchX } from "lucide-react";

export const metadata: Metadata = { title: "Expiry" };

/**
 * What is about to go off.
 *
 * Only stock that still has quantity is listed: an emptied batch is
 * history, and history is not what somebody opens this screen to act on.
 */
export default async function ExpiryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user.role, "inventory.view")) return <Forbidden />;

  const filters = await searchParams;
  const capabilities = await getCapabilities();
  const [batches, summary] = await Promise.all([
    listBatches({ status: filters.status, search: filters.search }),
    getExpirySummary(),
  ]);

  const narrowed = Boolean(filters.search || (filters.status && filters.status !== "all"));

  return (
    <>
      <PageHeader
        title="Expiry"
        description="Stock by batch, and how long each has left."
        breadcrumbs={[{ label: "Warehouse" }, { label: "Expiry" }]}
      />

      {!capabilities.batchesAndExpiry && (
        <div className="mb-5">
          <Alert tone="info" title="Batch tracking is not installed on this database">
            The application is ready for it; the database is one script behind.
            Run <code className="numeric">database/UPGRADE_0024_BATCHES_AND_EXPIRY.sql</code>{" "}
            in the Supabase SQL editor, then reload. Nothing else is affected.
          </Alert>
        </div>
      )}

      {capabilities.batchesAndExpiry && summary.ok && (
        <StatGrid>
          <StatTile label="Expired" value={formatQuantity(summary.data.expiredUnits)}
                    sub={`${summary.data.expiredBatches} ${summary.data.expiredBatches === 1 ? "batch" : "batches"}`}
                    tone={summary.data.expiredUnits > 0 ? "critical" : "positive"}
                    href="/inventory/expiry?status=expired" />
          <StatTile label="Expiring soon" value={formatQuantity(summary.data.expiringUnits)}
                    sub={`${summary.data.expiringBatches} ${summary.data.expiringBatches === 1 ? "batch" : "batches"}`}
                    tone={summary.data.expiringUnits > 0 ? "caution" : "neutral"}
                    href="/inventory/expiry?status=expiring" />
          <StatTile label="Good" value={formatQuantity(summary.data.goodBatches)}
                    sub="Batches well inside date" tone="positive" />
          <StatTile label="Tracked batches"
                    value={formatQuantity(
                      summary.data.expiredBatches + summary.data.expiringBatches + summary.data.goodBatches)}
                    sub="Holding stock" />
        </StatGrid>
      )}

      {summary.ok && summary.data.expiredUnits > 0 && (
        <div className="mb-5">
          <Alert tone="danger" title="Expired stock is in the warehouse">
            {formatQuantity(summary.data.expiredUnits)} units are past their date.
            A van will not dispatch while an expired batch of the same product is
            on hand, so write it off before the next round.
          </Alert>
        </div>
      )}

      {!batches.ok ? (
        <Card><ErrorState title="Batches could not be loaded" message={batches.message} /></Card>
      ) : (
        <>
          <ListFilters
            searchPlaceholder="Search by product, code or batch"
            searchLabel="Search batches"
            selects={[{
              name: "status", label: "Filter by state", allLabel: "Any state",
              options: [
                { value: "expired", label: "Expired" },
                { value: "expiring", label: "Expiring soon" },
                { value: "good", label: "Good" },
                { value: "no_expiry", label: "Does not expire" },
              ],
              className: "lg:w-48",
            }]}
            count={batches.data.length}
            noun="batch"
          />

          <Card className="overflow-hidden">
            {batches.data.length === 0 ? (
              narrowed ? (
                <EmptyState icon={SearchX} title="No batches match those filters"
                            description="Try a different state or search." />
              ) : (
                <EmptyState
                  icon={CalendarClock}
                  title="No batches recorded yet"
                  description="Batches are created when goods are received against a purchase order, for products set to track them."
                />
              )
            ) : (
              <BatchList batches={batches.data} />
            )}
          </Card>
        </>
      )}
    </>
  );
}
