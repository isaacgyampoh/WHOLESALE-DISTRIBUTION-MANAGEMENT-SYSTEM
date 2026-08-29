import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import {
  getProduct, listCategories, listWarehouses, listMovements
} from "@/features/catalogue/queries";
import { ProductActions } from "@/features/catalogue/product-detail";
import { ProductImageForm } from "@/features/catalogue/product-image-form";
import { getCapabilities } from "@/lib/db/capabilities";
import { StockBadge } from "@/features/catalogue/stock-badge";
import { formatHolding, formatPackSize } from "@/lib/catalogue/quantity";
import { MovementList } from "@/features/catalogue/movement-list";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ErrorState, EmptyState } from "@/components/ui/states";
import { unitLabel } from "@/lib/catalogue/units";
import { formatMoney, formatQuantity, formatDate } from "@/lib/utils/format";
import { ArrowLeftRight } from "lucide-react";

export const metadata: Metadata = { title: "Product" };

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, "products.view")) return <Forbidden />;

  const { id } = await params;
  const capabilities = await getCapabilities();
  const result = await getProduct(id);

  if (!result.ok) {
    return (
      <>
        <PageHeader title="Product" />
        <Card><ErrorState title="This product could not be loaded" message={result.message} /></Card>
      </>
    );
  }
  // A product outside the caller's organization or category scope is
  // invisible to row level security, so it is indistinguishable from one
  // that does not exist.
  if (!result.data) notFound();

  const product = result.data;
  const [categories, warehouses, movements] = await Promise.all([
    listCategories(),
    listWarehouses(),
    listMovements({ productId: product.id }, 50),
  ]);

  return (
    <>
      <PageHeader
        title={product.name}
        description={`${product.sku} · ${product.categoryName ?? "No category"}`}
        breadcrumbs={[
          { label: "Catalogue" },
          { label: "Products", href: "/products" },
          { label: product.name },
        ]}
        actions={
          <ProductActions
            canTrackBatches={capabilities.batchesAndExpiry}
            product={product}
            categories={categories.ok ? categories.data : []}
            warehouses={warehouses.ok ? warehouses.data : []}
            canEdit={can(user.role, "products.edit")}
            canAdjust={can(user.role, "inventory.adjust")}
          />
        }
      />

      <div className="mb-5 grid gap-3 grid-cols-2 xl:grid-cols-4">
        <Tile label="Available" value={formatQuantity(product.available)}
              sub={`${unitLabel(product.unit)}${product.available === 1 ? "" : "s"}`} />
        {/*
          Both halves of what is on the shelf, and never added together.
          A product with no pack size has no loose pieces and reads
          exactly as it always did.
        */}
        <Tile label="On hand"
              value={formatHolding({ units: product.onHand, pieces: product.onHandPieces }, product.unit)}
              sub={product.reserved > 0 ? `${formatQuantity(product.reserved)} reserved` : "Nothing reserved"} />
        <Tile label="Selling price" value={formatMoney(product.listPrice)}
              sub={`Cost ${formatMoney(product.costPrice)}`} />
        <Tile label="Low stock at" value={formatQuantity(product.reorderPoint)}
              sub={`Reorder ${formatQuantity(product.reorderQty)}`} />
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        {can(user.role, "products.edit") && (
          <Card>
            <CardHeader
              title="Picture"
              description="What a salesperson sees on the till."
            />
            <CardBody>
              <ProductImageForm
                productId={product.id}
                productName={product.name}
                imagePath={product.imagePath}
              />
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader title="Details" />
          <CardBody className="space-y-3 text-sm">
            <Row label="Stock status" value={<StockBadge state={product.state} />} />
            <Row label="Status" value={
              product.isActive
                ? <Badge tone="neutral">Active</Badge>
                : <Badge tone="critical">Inactive</Badge>} />
            <Row label="Unit" value={unitLabel(product.unit)} />
            {/*
              Shown only where it has been set. "1 piece per carton" is
              what the column says for a product nobody has configured,
              and printing that would read as a fact rather than a
              default.
            */}
            <Row
              label="Pack size"
              value={formatPackSize(product.unit, product.unitsPerCase) ?? "Not split into pieces"}
            />
            {/*
              Only for a product that can be split, and it says plainly
              when nobody has set one - because the fallback the till
              uses is the carton rate, which undercharges every single
              sold and is the reason to set a real figure.
            */}
            {formatPackSize(product.unit, product.unitsPerCase) && (
              <Row
                label="Price per piece"
                value={product.piecePrice === null
                  ? "Not set - pieces cannot be sold until it is"
                  : formatMoney(product.piecePrice)}
              />
            )}
            <Row label="Tax rate" value={`${product.taxRate}%`} />
            <Row label="Created" value={<span className="numeric">{formatDate(product.createdAt)}</span>} />
            <Row label="Updated" value={<span className="numeric">{formatDate(product.updatedAt)}</span>} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Description" />
          <CardBody>
            <p className="text-sm text-[var(--text-secondary)]">
              {product.description || "No description recorded."}
            </p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Stock movement history"
          description="Every change to this product's quantity, in order. Entries cannot be edited."
        />
        {!movements.ok ? (
          <ErrorState title="History unavailable" message={movements.message} />
        ) : movements.data.length === 0 ? (
          <EmptyState
            icon={ArrowLeftRight}
            title="No stock movements yet"
            description="Adjust the stock to record the first one."
          />
        ) : (
          <MovementList movements={movements.data} showProduct={false} />
        )}
      </Card>
    </>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="surface rounded-[var(--radius-panel)] border border-[var(--border-subtle)] p-3 sm:p-4">
      <p className="text-[0.6875rem] font-medium tracking-wide text-[var(--text-muted)] uppercase sm:text-xs">
        {label}
      </p>
      <p className="numeric mt-1.5 text-lg font-semibold tracking-tight text-[var(--text-primary)] sm:mt-2 sm:text-2xl">
        {value}
      </p>
      {sub && <p className="mt-1 text-[0.6875rem] text-[var(--text-secondary)] sm:text-xs">{sub}</p>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="font-medium text-[var(--text-primary)]">{value}</span>
    </div>
  );
}
