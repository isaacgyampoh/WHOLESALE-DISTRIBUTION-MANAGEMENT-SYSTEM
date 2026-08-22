import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { listVans, listVanStock } from "@/features/distribution/queries";
import { VanList } from "@/features/distribution/van-list";
import { CreateVanButton } from "@/features/distribution/van-forms";
import { listWarehouses } from "@/features/catalogue/queries";
import { listAssignableDrivers } from "@/features/distribution/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card, CardHeader } from "@/components/ui/card";
import { StatTile, StatGrid } from "@/components/ui/stat-tile";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { formatMoney, formatQuantity } from "@/lib/utils/format";
import { Truck } from "lucide-react";

export const metadata: Metadata = { title: "Vans" };

export default async function VansPage() {
  const user = await requireUser();
  if (!can(user.role, "vans.view")) return <Forbidden />;

  const canManage = can(user.role, "vans.manage");
  const [vans, stock, warehouses, drivers] = await Promise.all([
    listVans(),
    listVanStock(),
    canManage ? listWarehouses() : Promise.resolve(null),
    canManage ? listAssignableDrivers() : Promise.resolve(null),
  ]);

  const warehouseOptions = warehouses?.ok
    ? warehouses.data.map((w) => ({ id: w.id, label: w.name }))
    : [];
  const driverOptions = drivers?.ok
    ? drivers.data.map((d) => ({ id: d.id, label: d.fullName }))
    : [];

  return (
    <>
      <PageHeader
        title="Vans"
        description="The fleet, who is driving each one, and what it is carrying."
        breadcrumbs={[{ label: "Distribution" }, { label: "Vans" }]}
        actions={canManage ? <CreateVanButton warehouses={warehouseOptions} /> : undefined}
      />

      {!vans.ok ? (
        <Card><ErrorState title="Vans could not be loaded" message={vans.message} /></Card>
      ) : (
        <>
          <StatGrid>
            <StatTile label="Vans" value={formatQuantity(vans.data.length)}
                      sub={`${vans.data.filter((v) => v.isActive).length} active`} />
            <StatTile label="On the road" value={formatQuantity(vans.data.filter((v) => v.openLoad).length)}
                      sub="Carrying an open load" />
            <StatTile label="Assigned" value={formatQuantity(vans.data.filter((v) => v.driverName).length)}
                      sub="Have a driver" />
            <StatTile label="Stock on vans"
                      value={formatMoney(vans.data.reduce((s, v) => s + v.stockValue, 0))}
                      sub="At cost, across the fleet" />
          </StatGrid>

          <Card className="overflow-hidden">
            {vans.data.length === 0 ? (
              <EmptyState icon={Truck} title="No vans yet"
                          description="A van is what carries stock out to customers."
                          action={canManage ? <CreateVanButton warehouses={warehouseOptions} /> : undefined} />
            ) : (
              <VanList vans={vans.data} warehouses={warehouseOptions}
                       drivers={driverOptions} canManage={canManage} />
            )}
          </Card>

          {stock.ok && stock.data.length > 0 && (
            <div className="mt-5">
              <Card className="overflow-hidden">
                <CardHeader
                  title="Stock on vans"
                  description="Held against the same ledger as warehouse stock, not a separate count."
                />
                <TableWrap className="rounded-none border-0">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Van</Th>
                        <Th>Product</Th>
                        <Th numeric>On hand</Th>
                        <Th numeric>Value</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {stock.data.map((s) => (
                        <Tr key={`${s.vanId}-${s.sku}`}>
                          <Td className="numeric">{s.vanCode}</Td>
                          <Td>
                            <span className="block font-medium">{s.productName}</span>
                            <span className="numeric text-xs text-[var(--text-muted)]">{s.sku}</span>
                          </Td>
                          <Td numeric>{formatQuantity(s.qtyOnHand)}</Td>
                          <Td numeric>{formatMoney(s.stockValue)}</Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
              </Card>
            </div>
          )}
        </>
      )}
    </>
  );
}
