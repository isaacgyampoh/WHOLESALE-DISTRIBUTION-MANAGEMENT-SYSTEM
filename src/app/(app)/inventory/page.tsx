import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import {
  getInventorySummary, listProducts, listCategories, listMovements, PAGE_SIZE
} from "@/features/catalogue/queries";
import { ProductList } from "@/features/catalogue/product-list";
import { CatalogueFilters } from "@/features/catalogue/catalogue-filters";
import { MovementList } from "@/features/catalogue/movement-list";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Pagination } from "@/components/ui/pagination";
import { Card, CardHeader } from "@/components/ui/card";
import { StatTile, StatGrid } from "@/components/ui/stat-tile";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { formatMoney, formatQuantity } from "@/lib/utils/format";
import { Boxes, ArrowLeftRight, ClipboardCheck } from "lucide-react";

export const metadata: Metadata = { title: "Inventory" };

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user.role, "inventory.view")) return <Forbidden />;

  const filters = await searchParams;
  const [summary, products, categories, movements] = await Promise.all([
    getInventorySummary(),
    listProducts({
      search: filters.search,
      category: filters.category,
      status: filters.status,
      stock: filters.stock,
      page: Number(filters.page ?? 1),
    }),
    listCategories(),
    listMovements({}, 8),
  ]);

  return (
    <>
      <PageHeader
        title="Inventory"
        description="What is on hand, what is running out, and what has moved."
        breadcrumbs={[{ label: "Warehouse" }, { label: "Inventory" }]}
        actions={
          can(user.role, "inventory.adjust") ? (
            <Link
              href="/inventory/count"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius-panel)] bg-brand-700 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-800 pointer-fine:h-9.5"
            >
              <ClipboardCheck className="size-4" aria-hidden />
              Count stock
            </Link>
          ) : null
        }
      />

      {summary.ok && (
        <StatGrid>
          <StatTile label="Products tracked" value={formatQuantity(summary.data.totalProducts)}
                    sub={`${formatQuantity(summary.data.totalUnits)} units on hand`} />
          <StatTile label="Stock value" value={formatMoney(summary.data.stockValue)} sub="At cost" />
          <StatTile label="Low stock" value={formatQuantity(summary.data.lowStock)}
                    sub="At or below threshold" tone={summary.data.lowStock > 0 ? "caution" : "neutral"}
                    href="/inventory?stock=low_stock" />
          <StatTile label="Out of stock" value={formatQuantity(summary.data.outOfStock)}
                    sub="Nothing available" tone={summary.data.outOfStock > 0 ? "critical" : "neutral"}
                    href="/inventory?stock=out_of_stock" />
        </StatGrid>
      )}

      {!products.ok ? (
        <Card><ErrorState title="Inventory could not be loaded" message={products.message} /></Card>
      ) : (
        <>
          <CatalogueFilters
            categories={categories.ok ? categories.data : []}
            total={products.data.total}
          />

          {products.data.products.length === 0 ? (
            <Card>
              <EmptyState
                icon={Boxes}
                title="Nothing to show"
                description="No product matches those filters."
              />
            </Card>
          ) : (
            <>
              <ProductList products={products.data.products} />
              <Pagination
                page={products.data.page}
                pageSize={PAGE_SIZE}
                total={products.data.total}
                params={filters}
              />
            </>
          )}
        </>
      )}

      <div className="mt-5">
        <Card>
          <CardHeader
            title="Recent stock movements"
            description="The ledger every quantity is derived from."
            action={
              <Link
                href="/inventory/movements"
                className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300"
              >
                View all
              </Link>
            }
          />
          {!movements.ok ? (
            <ErrorState title="Movements unavailable" message={movements.message} />
          ) : movements.data.length === 0 ? (
            <EmptyState
              icon={ArrowLeftRight}
              title="No stock movements yet"
              description="Receiving or adjusting stock records the first one."
            />
          ) : (
            <MovementList movements={movements.data} />
          )}
        </Card>
      </div>
    </>
  );
}
