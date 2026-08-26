import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { getWarehouses, getWarehouseStock } from "@/features/catalogue/queries";
import { StocktakeForm } from "@/features/catalogue/stocktake-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Stock count" };

export default async function StockCountPage({
  searchParams,
}: {
  searchParams: Promise<{ warehouse?: string }>;
}) {
  await requirePermission("inventory.count");
  const { warehouse } = await searchParams;

  const warehouses = await getWarehouses();
  const selected =
    warehouses.find((w) => w.id === warehouse) ??
    warehouses.find((w) => w.isDefault) ??
    warehouses[0];

  if (!selected) notFound();

  const lines = await getWarehouseStock(selected.id);

  return (
    <>
      <PageHeader
        title="Stock count"
        description="Check the shelf against the system and correct the difference."
        breadcrumbs={[{ label: "Stock", href: "/inventory" }, { label: "Stock count" }]}
      />

      {lines.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing to count"
            description="This warehouse holds no stock, so there is nothing to check against."
          />
        </Card>
      ) : (
        <StocktakeForm
          warehouseId={selected.id}
          warehouseName={selected.name}
          lines={lines}
        />
      )}
    </>
  );
}
