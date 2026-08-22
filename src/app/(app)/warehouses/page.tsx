import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { listWarehouses } from "@/features/warehouses/queries";
import { WarehouseList } from "@/features/warehouses/warehouse-list";
import { CreateWarehouseButton } from "@/features/warehouses/warehouse-forms";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card } from "@/components/ui/card";
import { StatTile, StatGrid } from "@/components/ui/stat-tile";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { formatMoney, formatQuantity } from "@/lib/utils/format";
import { Warehouse } from "lucide-react";

export const metadata: Metadata = { title: "Warehouses" };

export default async function WarehousesPage() {
  const user = await requireUser();
  if (!can(user.role, "inventory.view")) return <Forbidden />;

  const result = await listWarehouses();

  return (
    <>
      <PageHeader
        title="Warehouses"
        description="Where stock is held, and how much sits at each location."
        breadcrumbs={[{ label: "Warehouse" }, { label: "Warehouses" }]}
        actions={can(user.role, "inventory.transfer") ? <CreateWarehouseButton /> : undefined}
      />

      {!result.ok ? (
        <Card><ErrorState title="Warehouses could not be loaded" message={result.message} /></Card>
      ) : (
        <>
          <StatGrid>
            <StatTile
              label="Locations"
              value={formatQuantity(result.data.length)}
              sub={`${result.data.filter((w) => w.isActive).length} active`}
            />
            <StatTile
              label="Units held"
              value={formatQuantity(result.data.reduce((s, w) => s + w.unitsOnHand, 0))}
              sub="Across every location"
            />
            <StatTile
              label="Stock value"
              value={formatMoney(result.data.reduce((s, w) => s + w.stockValue, 0))}
              sub="At cost"
            />
            <StatTile
              label="Product lines"
              value={formatQuantity(result.data.reduce((s, w) => s + w.productLines, 0))}
              sub="Warehouse and product pairs"
            />
          </StatGrid>

          <Card className="overflow-hidden">
            {result.data.length === 0 ? (
              <EmptyState
                icon={Warehouse}
                title="No warehouses yet"
                description="Stock has to live somewhere before it can be received or loaded."
                action={can(user.role, "inventory.transfer") ? <CreateWarehouseButton /> : undefined}
              />
            ) : (
              <WarehouseList warehouses={result.data} canManage={can(user.role, "inventory.transfer")} />
            )}
          </Card>
        </>
      )}
    </>
  );
}
