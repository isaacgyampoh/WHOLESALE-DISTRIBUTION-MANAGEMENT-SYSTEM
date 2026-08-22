import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import {
  listCollections, getCollectionsSummary, listCustomers, PAGE_SIZE,
} from "@/features/commercial/queries";
import { CollectionList } from "@/features/commercial/collection-list";
import { RecordCollectionButton } from "@/features/commercial/collection-form";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card } from "@/components/ui/card";
import { StatTile, StatGrid } from "@/components/ui/stat-tile";
import { ListFilters } from "@/components/ui/list-filters";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { formatMoney, formatQuantity } from "@/lib/utils/format";
import { PAYMENT_METHODS } from "@/types/domain";
import { METHOD_LABELS } from "@/features/commercial/payment-list";
import { Banknote, SearchX } from "lucide-react";

export const metadata: Metadata = { title: "Collections" };

const PERIODS: Record<string, number> = { "7": 7, "30": 30, "90": 90, "365": 365 };

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user.role, "payments.view")) return <Forbidden />;

  const filters = await searchParams;
  const periodDays = PERIODS[filters.period ?? "30"] ?? 30;

  const [result, summary, customers] = await Promise.all([
    listCollections({
      method: filters.method,
      search: filters.search,
      periodDays,
      page: Number(filters.page ?? 1),
    }),
    getCollectionsSummary(periodDays),
    can(user.role, "payments.create") ? listCustomers({ status: "active" }) : Promise.resolve(null),
  ]);

  const narrowed = Boolean(filters.search || (filters.method && filters.method !== "all"));

  return (
    <>
      <PageHeader
        title="Collections"
        description="Money received against customer accounts."
        breadcrumbs={[{ label: "Commercial" }, { label: "Collections" }]}
        actions={
          customers?.ok
            ? <RecordCollectionButton customers={customers.data.customers.map((c) => ({
                id: c.id, name: c.name, code: c.code, balance: c.balance,
              }))} />
            : undefined
        }
      />

      {summary.ok && (
        <StatGrid>
          <StatTile label="Received" value={formatMoney(summary.data.received)}
                    sub={`Last ${periodDays} days`} tone="positive" />
          <StatTile label="Collections" value={formatQuantity(summary.data.count)}
                    sub={`Last ${periodDays} days`} />
          <StatTile label="Cash" value={formatMoney(summary.data.cash)} sub="Received as notes" />
          <StatTile label="Mobile money" value={formatMoney(summary.data.mobileMoney)}
                    sub="Received by momo" />
        </StatGrid>
      )}

      {!result.ok ? (
        <Card><ErrorState title="Collections could not be loaded" message={result.message} /></Card>
      ) : (
        <>
          <ListFilters
            searchPlaceholder="Search by customer name or code"
            searchLabel="Search collections"
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
                name: "method", label: "Filter by method", allLabel: "Any method",
                options: PAYMENT_METHODS.map((m) => ({ value: m, label: METHOD_LABELS[m] ?? m })),
                className: "lg:w-48",
              },
            ]}
            count={result.data.total}
            noun="collection"
          />

          <Card className="overflow-hidden">
            {result.data.collections.length === 0 ? (
              narrowed ? (
                <EmptyState icon={SearchX} title="No collections match those filters"
                            description="Try a different period or method." />
              ) : (
                <EmptyState icon={Banknote} title="No collections in this period"
                            description="Record one when a customer settles part of their account." />
              )
            ) : (
              <CollectionList collections={result.data.collections} />
            )}
          </Card>

          <Pagination page={result.data.page} pageSize={PAGE_SIZE}
                      total={result.data.total} params={filters} />
        </>
      )}
    </>
  );
}
