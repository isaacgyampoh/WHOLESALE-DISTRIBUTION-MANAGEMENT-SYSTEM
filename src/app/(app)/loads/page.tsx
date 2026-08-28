import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import {
  listLoads, PAGE_SIZE, listLoadableProducts,
} from "@/features/distribution/queries";
import { LoadList } from "@/features/distribution/load-list";
import { CreateLoadButton } from "@/features/distribution/load-form";
import { listVans, listAssignableDrivers } from "@/features/distribution/queries";
import { listWarehouses } from "@/features/catalogue/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card } from "@/components/ui/card";
import { StatTile, StatGrid } from "@/components/ui/stat-tile";
import { ListFilters } from "@/components/ui/list-filters";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { formatMoney, formatQuantity } from "@/lib/utils/format";
import { ClipboardList, SearchX } from "lucide-react";

export const metadata: Metadata = { title: "Van loads" };

const STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "loaded", label: "Loaded" },
  { value: "dispatched", label: "Dispatched" },
  { value: "returned", label: "Returned" },
  { value: "reconciled", label: "Reconciled" },
  { value: "cancelled", label: "Cancelled" },
];

export default async function LoadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user.role, "loads.view")) return <Forbidden />;

  const filters = await searchParams;
  // A driver sees their own loads and nothing else. The database says so
  // too; narrowing here keeps the figures above the table honest.
  const canCreate = can(user.role, "loads.create");
  const [result, vans, drivers, warehouses, products] = await Promise.all([
    listLoads({
      status: filters.status,
      search: filters.search,
      driverId: user.role === "driver" ? user.id : undefined,
      page: Number(filters.page ?? 1),
    }),
    canCreate ? listVans() : Promise.resolve(null),
    canCreate ? listAssignableDrivers() : Promise.resolve(null),
    canCreate ? listWarehouses() : Promise.resolve(null),
    // Every active product with its stock per warehouse. This used to
    // be page one of the product list - twenty-five of sixty-eight -
    // filtered again to those showing stock, so most of the catalogue
    // never reached the picker and nothing said why.
    canCreate ? listLoadableProducts() : Promise.resolve(null),
  ]);

  const buildLoad = canCreate && vans?.ok && drivers?.ok && warehouses?.ok && products?.ok
    ? (
        <CreateLoadButton
          vans={vans.data.filter((v) => v.isActive && !v.openLoad)
            .map((v) => ({ id: v.id, label: `${v.code} · ${v.registrationNo}` }))}
          drivers={drivers.data.map((d) => ({ id: d.id, label: d.fullName }))}
          warehouses={warehouses.data.map((w) => ({ id: w.id, label: w.name }))}
          products={products.data}
        />
      )
    : undefined;

  const narrowed = Boolean(filters.search || (filters.status && filters.status !== "all"));

  return (
    <>
      <PageHeader
        title="Van loads"
        description="Stock issued to a van, and what came back from it."
        breadcrumbs={[{ label: "Distribution" }, { label: "Van loads" }]}
        actions={buildLoad}
      />

      {!result.ok ? (
        <Card><ErrorState title="Van loads could not be loaded" message={result.message} /></Card>
      ) : (
        <>
          <StatGrid>
            <StatTile label="Loads" value={formatQuantity(result.data.total)} sub="Matching this view" />
            <StatTile label="On the road"
                      value={formatQuantity(result.data.loads.filter((l) => l.status === "dispatched").length)}
                      sub="Dispatched, not yet back" />
            <StatTile label="Awaiting reconciliation"
                      value={formatQuantity(result.data.loads.filter((l) => l.status === "returned").length)}
                      sub="Returned, not yet settled"
                      tone={result.data.loads.some((l) => l.status === "returned") ? "caution" : "neutral"} />
            <StatTile label="Sold from vans"
                      value={formatMoney(result.data.loads.reduce((s, l) => s + l.cashSales + l.creditSales, 0))}
                      sub="On this page" />
          </StatGrid>

          <ListFilters
            searchPlaceholder="Search by load number"
            searchLabel="Search van loads"
            selects={[{
              name: "status", label: "Filter by status",
              allLabel: "All statuses", options: STATUSES, className: "lg:w-52",
            }]}
            count={result.data.total}
            noun="load"
          />

          <Card className="overflow-hidden">
            {result.data.loads.length === 0 ? (
              narrowed ? (
                <EmptyState icon={SearchX} title="No loads match those filters"
                            description="Try a different status or load number." />
              ) : (
                <EmptyState icon={ClipboardList} title="No van loads yet"
                            description="A load moves stock from a warehouse onto a van."
                            action={buildLoad} />
              )
            ) : (
              <LoadList loads={result.data.loads}
                      canDispatch={can(user.role, "loads.dispatch")} />
            )}
          </Card>

          <Pagination page={result.data.page} pageSize={PAGE_SIZE}
                      total={result.data.total} params={filters} />
        </>
      )}
    </>
  );
}
