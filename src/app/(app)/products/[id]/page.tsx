import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, ClipboardCheck } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { getProduct, getWarehouses } from "@/features/catalogue/queries";
import { StockControls } from "@/features/catalogue/stock-controls";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { formatMoney, formatQuantity, formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Product" };

/**
 * How a movement type reads to someone who is not a database. The type
 * is the audit record; this is the sentence.
 */
const MOVEMENT_LABELS: Record<string, string> = {
  opening_stock: "Opening stock",
  receipt: "Stock added",
  issue: "Sold or issued",
  adjustment_in: "Corrected up",
  adjustment_out: "Corrected down",
  stocktake_in: "Count found more",
  stocktake_out: "Count found less",
  transfer_in: "Transferred in",
  transfer_out: "Transferred out",
  customer_return: "Customer return",
  supplier_return: "Returned to supplier",
  damage: "Damaged",
  shortage: "Unaccounted for",
};

const ADDS = new Set([
  "opening_stock", "receipt", "adjustment_in", "stocktake_in", "transfer_in", "customer_return",
]);

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("products.view");
  const { id } = await params;

  const product = await getProduct(id);
  if (!product) notFound();

  // Only an operator who may change stock is offered the controls. The
  // database refuses the change regardless of what is on screen.
  const mayEditStock = can(user.role, "inventory.adjust");
  const warehouses = mayEditStock ? await getWarehouses() : [];

  return (
    <>
      <PageHeader
        title={product.name}
        description={`${product.sku}${product.categoryName ? ` - ${product.categoryName}` : ""}`}
        breadcrumbs={[{ label: "Products", href: "/products" }, { label: product.name }]}
        actions={
          <div className="flex flex-wrap gap-2">
            {can(user.role, "products.edit") && (
              <Link
                href={`/products/${product.id}/edit`}
                className="inline-flex h-11 items-center gap-2 rounded-[var(--radius-panel)] border border-[var(--border-strong)] px-4 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--surface-sunken)] pointer-fine:h-9.5"
              >
                <Pencil className="size-3.5" aria-hidden />
                Edit product
              </Link>
            )}
            {can(user.role, "inventory.count") && (
              <Link
                href="/inventory/count"
                className="inline-flex h-11 items-center gap-2 rounded-[var(--radius-panel)] border border-[var(--border-strong)] px-4 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--surface-sunken)] pointer-fine:h-9.5"
              >
                <ClipboardCheck className="size-3.5" aria-hidden />
                Stock count
              </Link>
            )}
          </div>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Figure label="Selling price" value={formatMoney(product.listPrice)} />
        <Figure
          label="Current stock"
          value={`${formatQuantity(product.qtyOnHand)} ${product.unit}`}
          badge={
            !product.isActive ? (
              <Badge tone="neutral">Inactive</Badge>
            ) : product.qtyOnHand <= 0 ? (
              <Badge tone="critical">Out of stock</Badge>
            ) : product.needsReorder ? (
              <Badge tone="caution">Low stock</Badge>
            ) : (
              <Badge tone="positive">In stock</Badge>
            )
          }
        />
        <Figure
          label="Low stock threshold"
          value={`${formatQuantity(product.reorderPoint)} ${product.unit}`}
        />
      </div>

      {mayEditStock && (
        <div className="mb-5">
          <StockControls
            productId={product.id}
            productLabel={`${product.sku} ${product.name}`}
            warehouses={warehouses}
            locations={product.locations}
          />
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Where it is" description="Stock held per location." />
          {product.locations.length === 0 ? (
            <EmptyState
              title="No stock recorded"
              description={
                mayEditStock
                  ? "Use Add stock to record what has arrived."
                  : "Nothing has been received for this product yet."
              }
            />
          ) : (
            <TableWrap className="rounded-t-none border-0">
              <Table>
                <thead>
                  <tr>
                    <Th>Location</Th>
                    <Th numeric>On hand</Th>
                    <Th numeric>Reserved</Th>
                    <Th numeric>Available</Th>
                  </tr>
                </thead>
                <tbody>
                  {product.locations.map((l) => (
                    <Tr key={l.warehouseId}>
                      <Td>
                        <span className="block font-medium">{l.warehouseName}</span>
                        <span className="text-xs text-[var(--text-muted)]">{l.warehouseCode}</span>
                      </Td>
                      <Td numeric>{formatQuantity(l.qtyOnHand)}</Td>
                      <Td numeric>{formatQuantity(l.qtyReserved)}</Td>
                      <Td numeric>{formatQuantity(l.qtyAvailable)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Stock history"
            description="Every change, in order. Nothing here can be edited or removed."
          />
          {product.movements.length === 0 ? (
            <EmptyState title="No movements yet" />
          ) : (
            <TableWrap className="rounded-t-none border-0">
              <Table>
                <thead>
                  <tr>
                    <Th>What happened</Th>
                    <Th numeric>Change</Th>
                    <Th>Where</Th>
                    <Th>When</Th>
                  </tr>
                </thead>
                <tbody>
                  {product.movements.map((m) => (
                    <Tr key={m.id}>
                      <Td>
                        <span className="block font-medium">
                          {MOVEMENT_LABELS[m.type] ?? m.type}
                        </span>
                        {m.reason && (
                          <span className="block text-xs text-[var(--text-muted)]">{m.reason}</span>
                        )}
                        {m.actorName && (
                          <span className="block text-xs text-[var(--text-muted)]">
                            by {m.actorName}
                          </span>
                        )}
                      </Td>
                      <Td numeric className={ADDS.has(m.type) ? "text-positive" : "text-critical"}>
                        {ADDS.has(m.type) ? "+" : "-"}
                        {formatQuantity(m.quantity)}
                      </Td>
                      <Td>{m.locationLabel}</Td>
                      <Td className="whitespace-nowrap text-xs text-[var(--text-secondary)]">
                        {formatDateTime(m.createdAt)}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>
      </div>
    </>
  );
}

function Figure({
  label, value, badge,
}: {
  label: string;
  value: string;
  badge?: React.ReactNode;
}) {
  return (
    <Card>
      <CardBody className="py-4">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <div className="mt-1 flex items-center gap-2">
          <p className="numeric text-lg font-semibold text-[var(--text-primary)]">{value}</p>
          {badge}
        </div>
      </CardBody>
    </Card>
  );
}
