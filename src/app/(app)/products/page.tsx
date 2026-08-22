import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { listProducts, listCategories, PAGE_SIZE } from "@/features/catalogue/queries";
import { ProductList, CreateProductButton } from "@/features/catalogue/product-list";
import { CatalogueFilters } from "@/features/catalogue/catalogue-filters";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Pagination } from "@/components/ui/pagination";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, Alert } from "@/components/ui/states";
import { Package, SearchX } from "lucide-react";

export const metadata: Metadata = { title: "Products" };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user.role, "products.view")) return <Forbidden />;

  const filters = await searchParams;
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
        description="The catalogue, and what is on hand for each line."
        breadcrumbs={[{ label: "Catalogue" }, { label: "Products" }]}
        actions={
          can(user.role, "products.create") && categories.ok
            ? <CreateProductButton categories={categories.data} />
            : undefined
        }
      />

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
              ) : (
                <EmptyState
                  icon={Package}
                  title="No products yet"
                  description="Add the first product to start tracking stock."
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
