import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { listCategories } from "@/features/catalogue/queries";
import { CategoryList, CreateCategoryButton } from "@/features/catalogue/category-list";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Tags } from "lucide-react";

export const metadata: Metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const user = await requireUser();
  // Category maintenance is a management screen; a driver or sales rep
  // has no use for it and no permission to reach it.
  if (!can(user.role, "products.edit")) return <Forbidden />;

  const result = await listCategories();

  return (
    <>
      <PageHeader
        title="Categories"
        description="How products are grouped, and what a scoped manager can reach."
        breadcrumbs={[{ label: "Catalogue" }, { label: "Categories" }]}
        actions={<CreateCategoryButton />}
      />

      {!result.ok ? (
        <Card><ErrorState title="Categories could not be loaded" message={result.message} /></Card>
      ) : result.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={Tags}
            title="No categories yet"
            description="Create a category before adding products, so they can be grouped and scoped."
          />
        </Card>
      ) : (
        <CategoryList categories={result.data} canManage />
      )}
    </>
  );
}
