import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { listPurchaseOrders, getPurchaseSummary, listSuppliers, PAGE_SIZE } from "@/features/warehouses/queries";
import { PurchaseList } from "@/features/warehouses/purchase-list";
import { CreatePurchaseOrderButton } from "@/features/warehouses/purchase-form";
import { CreateSupplierButton, SupplierActions } from "@/features/warehouses/warehouse-forms";
import { listWarehouses, listProducts } from "@/features/catalogue/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card, CardHeader } from "@/components/ui/card";
import { StatTile, StatGrid } from "@/components/ui/stat-tile";
import { ListFilters } from "@/components/ui/list-filters";
import { Pagination } from "@/components/ui/pagination";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { formatMoney, formatQuantity } from "@/lib/utils/format";
import { Truck, SearchX } from "lucide-react";

export const metadata: Metadata = { title: "Purchasing" };

const STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "partially_received", label: "Partially received" },
  { value: "received", label: "Received" },
  { value: "cancelled", label: "Cancelled" },
];

export default async function PurchasingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user.role, "inventory.transfer")) return <Forbidden />;

  const filters = await searchParams;
  const [result, summary, suppliers, warehouses, products] = await Promise.all([
    listPurchaseOrders({
      status: filters.status,
      search: filters.search,
      page: Number(filters.page ?? 1),
    }),
    getPurchaseSummary(),
    listSuppliers(),
    listWarehouses(),
    listProducts({ status: "active", page: 1 }),
  ]);

  const newOrder = suppliers.ok && warehouses.ok && products.ok ? (
    <CreatePurchaseOrderButton
      suppliers={suppliers.data.filter((s) => s.isActive)
        .map((s) => ({ id: s.id, label: s.name }))}
      warehouses={warehouses.data.map((w) => ({ id: w.id, label: w.name }))}
      products={products.data.products.map((p) => ({
        id: p.id, name: p.name, sku: p.sku, costPrice: p.costPrice,
      }))}
    />
  ) : undefined;

  const narrowed = Boolean(filters.search || (filters.status && filters.status !== "all"));

  return (
    <>
      <PageHeader
        title="Purchasing"
        description="Orders placed with suppliers, and what is still to arrive."
        breadcrumbs={[{ label: "Warehouse" }, { label: "Purchasing" }]}
        actions={newOrder}
      />

      {summary.ok && (
        <StatGrid>
          <StatTile label="Open orders" value={formatQuantity(summary.data.openOrders)}
                    sub="Not yet fully received" />
          <StatTile label="Overdue" value={formatQuantity(summary.data.awaitingDelivery)}
                    sub="Past the expected date"
                    tone={summary.data.awaitingDelivery > 0 ? "caution" : "neutral"} />
          <StatTile label="Committed" value={formatMoney(summary.data.committedValue)}
                    sub="Value of open orders" />
          <StatTile label="Suppliers" value={formatQuantity(summary.data.suppliers)} sub="Active" />
        </StatGrid>
      )}

      {!result.ok ? (
        <Card><ErrorState title="Purchase orders could not be loaded" message={result.message} /></Card>
      ) : (
        <>
          <ListFilters
            searchPlaceholder="Search by order number"
            searchLabel="Search purchase orders"
            selects={[{
              name: "status", label: "Filter by status",
              allLabel: "All statuses", options: STATUSES, className: "lg:w-52",
            }]}
            count={result.data.total}
            noun="order"
          />

          <Card className="overflow-hidden">
            {result.data.orders.length === 0 ? (
              narrowed ? (
                <EmptyState icon={SearchX} title="No orders match those filters"
                            description="Try a different status or order number." />
              ) : (
                <EmptyState icon={Truck} title="No purchase orders yet"
                            description="Goods received from a supplier are recorded against an order."
                            action={newOrder} />
              )
            ) : (
              <PurchaseList orders={result.data.orders} canManage />
            )}
          </Card>

          <Pagination page={result.data.page} pageSize={PAGE_SIZE}
                      total={result.data.total} params={filters} />
        </>
      )}

      {suppliers.ok && (
        <div className="mt-5">
          <Card className="overflow-hidden">
            <CardHeader title="Suppliers" description="Who the business buys from."
                        action={<CreateSupplierButton />} />
            <TableWrap className="rounded-none border-0">
              <Table>
                <thead>
                  <tr>
                    <Th>Supplier</Th>
                    <Th>Contact</Th>
                    <Th numeric>Payment terms</Th>
                    <Th numeric>Lead time</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {suppliers.data.map((s) => (
                    <Tr key={s.id}>
                      <Td>
                        {/* The supplier's own page: their paperwork, and
                            the portal links they hold. */}
                        <Link href={`/suppliers/${s.id}`} className="block font-medium hover:underline">
                          {s.name}
                        </Link>
                        <span className="numeric text-xs text-[var(--text-muted)]">{s.code}</span>
                      </Td>
                      <Td className="text-[var(--text-secondary)]">
                        {s.contactName ?? "-"}
                        {s.phone && <span className="numeric block text-xs">{s.phone}</span>}
                      </Td>
                      <Td numeric>{s.paymentTermsDays} days</Td>
                      <Td numeric>{s.leadTimeDays} days</Td>
                      <Td>
                        <Badge tone={s.isActive ? "positive" : "neutral"}>
                          {s.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </Td>
                      <Td><SupplierActions supplier={s} /></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </Card>
        </div>
      )}
    </>
  );
}
