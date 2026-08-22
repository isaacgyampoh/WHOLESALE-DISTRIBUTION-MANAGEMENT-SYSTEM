import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import {
  listReturns, listStockReturns, getStockReturnOptions, REASON_LABELS, PAGE_SIZE,
} from "@/features/distribution/queries";
import { ReturnList } from "@/features/distribution/return-list";
import { RecordStockReturnButton } from "@/features/distribution/stock-return-form";
import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CardHeader } from "@/components/ui/card";
import { formatDate } from "@/lib/utils/format";
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
  const canRecord = can(user.role, "inventory.adjust");

  const [result, stockReturns, options] = await Promise.all([
    listReturns({
      status: filters.status,
      search: filters.search,
      page: Number(filters.page ?? 1),
    }),
    listStockReturns({ direction: filters.direction }),
    canRecord ? getStockReturnOptions() : Promise.resolve(null),
  ]);

  const narrowed = Boolean(filters.search || (filters.status && filters.status !== "all"));
  const pending = result.ok ? result.data.returns.filter((r) => r.status === "submitted").length : 0;

  return (
    <>
      <PageHeader
        title="Returns"
        description="Stock coming back off a van, back from a customer, or going back to a supplier."
        breadcrumbs={[{ label: "Distribution" }, { label: "Returns" }]}
        actions={
          options?.ok ? (
            <RecordStockReturnButton
              warehouses={options.data.warehouses}
              customers={options.data.customers}
              suppliers={options.data.suppliers}
              products={options.data.products}
            />
          ) : undefined
        }
      />

      <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        Off a van
      </h2>

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

      <section aria-label="Customer and supplier returns" className="mt-8 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          From a customer, or back to a supplier
        </h2>

        <Card className="overflow-hidden">
          <CardHeader
            title="Recorded returns"
            description="Goods that moved because somebody brought them back or sent them away, not because a count was wrong."
          />

          {!stockReturns.ok ? (
            <div className="p-5"><Alert tone="warning">{stockReturns.message}</Alert></div>
          ) : stockReturns.data.returns.length === 0 ? (
            <EmptyState
              icon={Undo2}
              title="Nothing recorded"
              description="A customer bringing goods back, or goods going back to a supplier, is recorded here so the stock moves with a reason attached."
            />
          ) : (
            <TableWrap className="rounded-t-none border-0">
              <Table>
                <thead>
                  <tr>
                    <Th>Reference</Th>
                    <Th>Direction</Th>
                    <Th>Party</Th>
                    <Th>Reason</Th>
                    <Th numeric>Units</Th>
                    <Th>Recorded</Th>
                  </tr>
                </thead>
                <tbody>
                  {stockReturns.data.returns.map((r) => (
                    <Tr key={r.id}>
                      <Td className="numeric font-medium">{r.returnNumber}</Td>
                      <Td>
                        <Badge tone={r.direction === "customer" ? "info" : "neutral"}>
                          {r.direction === "customer" ? "Came back" : "Sent back"}
                        </Badge>
                      </Td>
                      <Td>
                        <span className="block">{r.partyName}</span>
                        <span className="numeric text-xs text-[var(--text-muted)]">
                          {r.partyCode}
                        </span>
                      </Td>
                      <Td className="text-[var(--text-secondary)]">
                        {REASON_LABELS[r.reason] ?? r.reason}
                      </Td>
                      <Td numeric>{formatQuantity(r.totalQuantity)}</Td>
                      <Td className="numeric whitespace-nowrap text-[var(--text-secondary)]">
                        {formatDate(r.createdAt)}
                        {r.recordedBy && (
                          <span className="block text-xs text-[var(--text-muted)]">
                            {r.recordedBy}
                          </span>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>
      </section>
    </>
  );
}
