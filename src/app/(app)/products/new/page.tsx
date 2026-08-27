import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { getWarehouses, getCategories } from "@/features/catalogue/queries";
import { ProductForm } from "@/features/catalogue/product-form";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Add product" };

export default async function NewProductPage() {
  await requirePermission("products.create");

  const [warehouses, categories] = await Promise.all([getWarehouses(), getCategories()]);

  return (
    <>
      <PageHeader
        title="Add product"
        description="Enter what you have of it here. There is no need to run a stock count."
        breadcrumbs={[{ label: "Products", href: "/products" }, { label: "Add product" }]}
      />
      <ProductForm warehouses={warehouses} categories={categories} />
    </>
  );
}
