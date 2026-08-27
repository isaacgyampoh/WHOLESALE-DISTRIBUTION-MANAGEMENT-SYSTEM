import type { Metadata } from "next";
import Link from "next/link";
import { Plus, PackageSearch } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { getProducts } from "@/features/catalogue/queries";
import { getMySalesContext } from "@/features/selling/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { EmptyState, ErrorState, Alert } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatQuantity } from "@/lib/utils/format";
import { toAppError } from "@/lib/errors/app-error";

export const metadata: Metadata = { title: "Products" };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requirePermission("products.view");
  const { q } = await searchParams;

  let products;
  try {
    products = await getProducts(q);
  } catch (error) {
    console.error("[products] could not load", error);
    return (
      <>
        <PageHeader title="Products" />
        <Card>
          <ErrorState title="Products could not be loaded" message={toAppError(error).userMessage} />
        </Card>
      </>
    );
  }

  // A field salesperson's catalogue is their van, but the quantity in
  // this column is warehouse stock. Saying so is better than showing them
  // a number they cannot sell against.
  const context = can(user.role, "sales.create") ? await getMySalesContext() : null;
  const sellsFromVan = context?.kind === "van";

  return (
    <>
      <PageHeader
        title="Products"
        description="The catalogue, with what is in the warehouse."
        actions={
          can(user.role, "products.create") ? (
            <Link
              href="/products/new"
              className="inline-flex h-11 items-center gap-2 rounded-[var(--radius-panel)] bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-800 pointer-fine:h-9.5"
            >
              <Plus className="size-4" aria-hidden />
              Add product
            </Link>
          ) : null
        }
      />

      {sellsFromVan && (
        <div className="mb-5">
          <Alert tone="info" title={`You sell from ${context?.locationName}`}>
            The quantities here are warehouse stock. What you can actually sell
            today is on the <Link href="/sell" className="underline">Sell</Link> screen.
          </Alert>
        </div>
      )}

      <form className="mb-4" action="/products">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by name or SKU"
          aria-label="Search products"
          className="h-11 w-full max-w-sm rounded-[var(--radius-panel)] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] pointer-fine:h-9.5"
        />
      </form>

      {products.length === 0 ? (
        <Card>
          <EmptyState
            icon={PackageSearch}
            title={q ? "Nothing matched that search" : "No products yet"}
            description={
              q
                ? "Try a different name or SKU."
                : "Add your first product, with however many you already have in stock."
            }
          />
        </Card>
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Category</Th>
                <Th numeric>Price</Th>
                <Th numeric>In stock</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <Tr key={p.id}>
                  <Td>
                    <Link href={`/products/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                    <span className="block text-xs text-[var(--text-muted)]">{p.sku}</span>
                  </Td>
                  <Td>{p.categoryName ?? "-"}</Td>
                  <Td numeric>{formatMoney(p.listPrice)}</Td>
                  <Td numeric>
                    {formatQuantity(p.qtyOnHand)}
                    <span className="ml-1 text-xs text-[var(--text-muted)]">{p.unit}</span>
                  </Td>
                  <Td>
                    {!p.isActive ? (
                      <Badge tone="neutral">Inactive</Badge>
                    ) : p.qtyOnHand <= 0 ? (
                      <Badge tone="critical">Out of stock</Badge>
                    ) : p.needsReorder ? (
                      <Badge tone="caution">Low stock</Badge>
                    ) : (
                      <Badge tone="positive">In stock</Badge>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </>
  );
}
