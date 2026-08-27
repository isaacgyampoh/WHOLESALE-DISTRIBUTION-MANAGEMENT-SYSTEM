import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardCheck, Boxes } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { getWarehouses, getWarehouseStock } from "@/features/catalogue/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { EmptyState, ErrorState, Alert } from "@/components/ui/states";
import { formatQuantity } from "@/lib/utils/format";
import { toAppError } from "@/lib/errors/app-error";

export const metadata: Metadata = { title: "Stock" };

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ warehouse?: string }>;
}) {
  const user = await requirePermission("inventory.view");
  const { warehouse } = await searchParams;

  const loaded = await loadStock(warehouse);

  if (!loaded.ok) {
    return (
      <>
        <PageHeader title="Stock" />
        <Card>
          <ErrorState title="Stock could not be loaded" message={loaded.message} />
        </Card>
      </>
    );
  }

  const { warehouses, selected, rows } = loaded;

  return (
    <>
      <PageHeader
        title="Stock"
        description="What each warehouse holds right now."
        actions={
          can(user.role, "inventory.count") && selected ? (
            <Link
              href={`/inventory/count?warehouse=${selected.id}`}
              className="inline-flex h-11 items-center gap-2 rounded-[var(--radius-panel)] border border-[var(--border-strong)] px-4 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--surface-sunken)] pointer-fine:h-9.5"
            >
              <ClipboardCheck className="size-4" aria-hidden />
              Stock count
            </Link>
          ) : null
        }
      />

      {can(user.role, "products.create") && (
        <div className="mb-5">
          <Alert tone="info" title="Adding a product you already have?">
            Enter the quantity on the{" "}
            <Link href="/products/new" className="underline">Add product</Link> form.
            A stock count is for checking what is physically on the shelf, not for
            entering an opening balance.
          </Alert>
        </div>
      )}

      {warehouses.length > 1 && (
        <nav className="mb-4 flex flex-wrap gap-2" aria-label="Warehouse">
          {warehouses.map((w) => (
            <Link
              key={w.id}
              href={`/inventory?warehouse=${w.id}`}
              aria-current={w.id === selected?.id ? "page" : undefined}
              className={
                w.id === selected?.id
                  ? "inline-flex h-9 items-center rounded-[var(--radius-panel)] bg-brand-700 px-3 text-sm font-medium text-white"
                  : "inline-flex h-9 items-center rounded-[var(--radius-panel)] border border-[var(--border-strong)] px-3 text-sm text-[var(--text-primary)] hover:bg-[var(--surface-sunken)]"
              }
            >
              {w.name}
            </Link>
          ))}
        </nav>
      )}

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={Boxes}
            title="No stock recorded here"
            description="Nothing has been received into this warehouse yet."
          />
        </Card>
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Product</Th>
                <Th numeric>On hand</Th>
                <Th numeric>Available</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.productId}>
                  <Td>
                    <Link href={`/products/${r.productId}`} className="font-medium hover:underline">
                      {r.name}
                    </Link>
                    <span className="block text-xs text-[var(--text-muted)]">{r.sku}</span>
                  </Td>
                  <Td numeric>
                    {formatQuantity(r.qtyOnHand)}
                    <span className="ml-1 text-xs text-[var(--text-muted)]">{r.unit}</span>
                  </Td>
                  <Td numeric>{formatQuantity(r.qtyAvailable)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </>
  );
}

type StockResult =
  | {
      ok: true;
      warehouses: Awaited<ReturnType<typeof getWarehouses>>;
      selected: Awaited<ReturnType<typeof getWarehouses>>[number] | undefined;
      rows: Awaited<ReturnType<typeof getWarehouseStock>>;
    }
  | { ok: false; message: string };

/** Failure becomes a value, so the page renders it instead of throwing. */
async function loadStock(warehouseId?: string): Promise<StockResult> {
  try {
    const warehouses = await getWarehouses();
    const selected =
      warehouses.find((w) => w.id === warehouseId) ??
      warehouses.find((w) => w.isDefault) ??
      warehouses[0];
    const rows = selected ? await getWarehouseStock(selected.id) : [];
    return { ok: true, warehouses, selected, rows };
  } catch (error) {
    console.error("[inventory] could not load", error);
    return { ok: false, message: toAppError(error).userMessage };
  }
}
