import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import {
  listWaybills, listLoadsAwaitingWaybill, PAGE_SIZE, hasDispatchedLoad,
} from "@/features/documents/queries";
import { WaybillList } from "@/features/documents/waybill-list";
import { IssueWaybillButton } from "@/features/documents/waybill-forms";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card } from "@/components/ui/card";
import { ListFilters } from "@/components/ui/list-filters";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { ClipboardList, SearchX } from "lucide-react";

export const metadata: Metadata = { title: "Waybills" };

export default async function WaybillsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user.role, "documents.view")) return <Forbidden />;

  const filters = await searchParams;
  // Whether anything has left the warehouse at all, so the empty
  // waybill picker can say which of the two reasons it is empty for.
  const anyDispatched = await hasDispatchedLoad();

  const [result, pending] = await Promise.all([
    listWaybills({
      status: filters.status,
      search: filters.search,
      page: Number(filters.page ?? 1),
    }),
    can(user.role, "documents.issue")
      ? listLoadsAwaitingWaybill()
      : Promise.resolve(null),
  ]);

  const narrowed = Boolean(filters.search || (filters.status && filters.status !== "all"));

  return (
    <>
      <PageHeader
        title="Waybills"
        description="What left the warehouse, where it went and who signed for it."
        breadcrumbs={[{ label: "Distribution" }, { label: "Waybills" }]}
        actions={
          pending?.ok
            ? <IssueWaybillButton loads={pending.data} anyDispatched={anyDispatched} />
            : undefined
        }
      />

      {!result.ok ? (
        <Card><ErrorState title="Waybills could not be loaded" message={result.message} /></Card>
      ) : (
        <>
          <ListFilters
            searchPlaceholder="Search by waybill number"
            searchLabel="Search waybills"
            selects={[{
              name: "status", label: "Filter by status", allLabel: "Any status",
              options: [
                { value: "issued", label: "Out" },
                { value: "delivered", label: "Delivered" },
                { value: "draft", label: "Draft" },
                { value: "cancelled", label: "Cancelled" },
              ],
              className: "lg:w-48",
            }]}
            count={result.data.total}
            noun="waybill"
          />

          <Card className="overflow-hidden">
            {result.data.waybills.length === 0 ? (
              narrowed ? (
                <EmptyState icon={SearchX} title="No waybills match those filters"
                            description="Try a different status or number." />
              ) : (
                <EmptyState
                  icon={ClipboardList}
                  title="No waybills yet"
                  description="Issue one against a dispatched van load so the goods travel with a document."
                />
              )
            ) : (
              <WaybillList waybills={result.data.waybills} />
            )}
          </Card>

          <Pagination page={result.data.page} pageSize={PAGE_SIZE}
                      total={result.data.total} params={filters} />
        </>
      )}
    </>
  );
}
