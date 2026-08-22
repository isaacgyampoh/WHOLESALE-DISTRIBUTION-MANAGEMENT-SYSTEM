import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { listProducts, listCategories, PAGE_SIZE } from "@/features/catalogue/queries";
import { ProductList, CreateProductButton } from "@/features/catalogue/product-list";
import { CatalogueFilters } from "@/features/catalogue/catalogue-filters";
import { PageHeader } from "@/components/layout/page-header";
import { getCapabilities } from "@/lib/db/capabilities";
import { Forbidden } from "@/components/layout/forbidden";
import { Pagination } from "@/components/ui/pagination";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, Alert } from "@/components/ui/states";
import { Package, SearchX, Truck } from "lucide-react";

export const metadata: Metadata = { title: "Products" };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user.role, "products.view")) return <Forbidden />;

  // A driver's view of the catalogue is scoped to their van by
  // can_access_product(). Knowing that here is what lets the empty
  // state say something true.
  const sellsFromAVan = can(user.role, "loads.confirm") && !can(user.role, "products.edit");

  const filters = await searchParams;
  const capabilities = await getCapabilities();
  const [result, categories] = await Promise.all([
    listProducts({
      search: filters.search,
      category: filters.category,
      status: filters.status,
      stock: filters.stock,
      page: Number(filters.page ?? 1),
    }),
    listCategories(),
  ]);

  const narrowed = Boolean(
    filters.search ||
    (filters.category && filters.category !== "all") ||
    (filters.status && filters.status !== "all") ||
    (filters.stock && filters.stock !== "all"),
  );

  return (
    <>
      <PageHeader
        title="Products"
        description={sellsFromAVan
          ? "The products you are carrying, and what you charge for them."
          : "The catalogue, and what is on hand for each line."}
        breadcrumbs={[{ label: "Catalogue" }, { label: "Products" }]}
        actions={
          can(user.role, "products.create") && categories.ok
            ? <CreateProductButton categories={categories.data}
                                   canTrackBatches={capabilities.batchesAndExpiry} />
            : undefined
        }
      />

      {!capabilities.maskedProductPricing && can(user.role, "products.edit") && (
        <div className="mb-5">
          <Alert tone="info" title="Cost prices are hidden on this database">
            Cost is shown through a view that masks it per role, and this
            database does not have it yet. Until{" "}
            <code className="numeric">database/UPGRADE_0023_COST_SECURITY.sql</code>{" "}
            has been run, nobody sees cost - which is the safe way round.
            Everything else on this screen works.
          </Alert>
        </div>
      )}

      {user.role === "manager" && (
        <div className="mb-5">
          <Alert tone="info" title="Scoped view">
            You see only the product categories assigned to you.
          </Alert>
        </div>
      )}

      {!result.ok ? (
        <Card><ErrorState title="Products could not be loaded" message={result.message} /></Card>
      ) : (
        <>
          <CatalogueFilters
            categories={categories.ok ? categories.data : []}
            total={result.data.total}
          />

          {result.data.products.length === 0 ? (
            <Card>
              {narrowed ? (
                <EmptyState
                  icon={SearchX}
                  title="No products match those filters"
                  description="Try a different search, category or stock level."
                />
              ) : sellsFromAVan ? (
                /* A driver's catalogue is their van. can_access_product()
                   scopes them to what they are carrying, so an empty
                   list here means an empty van - not an empty business,
                   and certainly not an invitation to add a product they
                   have no permission to create. */
                <EmptyState
                  icon={Truck}
                  title="Nothing on your van"
                  description="You see the products you are carrying. Ask the depot to load your van, or check what is on it."
                  action={
                    <Link
                      href="/driver/stock"
                      className="inline-flex h-11 items-center rounded-[var(--radius-panel)] border border-[var(--border-strong)] px-4 text-sm font-medium"
                    >
                      My van stock
                    </Link>
                  }
                />
              ) : user.role === "manager" ? (
                <EmptyState
                  icon={Package}
                  title="No products in your categories"
                  description="You see the categories assigned to you. Ask an administrator if something is missing."
                />
              ) : can(user.role, "products.create") ? (
                <EmptyState
                  icon={Package}
                  title="No products yet"
                  description="Add the first product to start tracking stock."
                  action={categories.ok
                    ? <CreateProductButton categories={categories.data}
                                           canTrackBatches={capabilities.batchesAndExpiry} />
                    : undefined}
                />
              ) : (
                <EmptyState
                  icon={Package}
                  title="No products to show"
                  description="Nothing in the catalogue is visible to your role."
                />
              )}
            </Card>
          ) : (
            <>
              <ProductList products={result.data.products} />
              <Pagination
                page={result.data.page}
                pageSize={PAGE_SIZE}
                total={result.data.total}
                params={filters}
              />
            </>
          )}
        </>
      )}
    </>
  );
}
