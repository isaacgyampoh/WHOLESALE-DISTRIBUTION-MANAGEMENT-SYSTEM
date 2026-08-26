import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { getProduct, getWarehouses, getCategories } from "@/features/catalogue/queries";
import { ProductForm } from "@/features/catalogue/product-form";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Edit product" };

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("products.edit");
  const { id } = await params;

  const [product, warehouses, categories] = await Promise.all([
    getProduct(id),
    getWarehouses(),
    getCategories(),
  ]);
  if (!product) notFound();

  return (
    <>
      <PageHeader
        title={`Edit ${product.name}`}
        description="Stock is not edited here: use Add stock or Adjust stock, so the history is kept."
        breadcrumbs={[
          { label: "Products", href: "/products" },
          { label: product.name, href: `/products/${product.id}` },
          { label: "Edit" },
        ]}
      />
      <ProductForm warehouses={warehouses} categories={categories} product={product} />
    </>
  );
}
