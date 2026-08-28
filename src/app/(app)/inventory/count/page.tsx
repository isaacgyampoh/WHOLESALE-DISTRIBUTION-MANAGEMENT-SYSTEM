import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CountSheet, type CountableProduct } from "@/features/inventory/count-sheet";
import { getCapabilities } from "@/lib/db/capabilities";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Warehouse } from "lucide-react";

export const metadata: Metadata = { title: "Stock count" };
export const dynamic = "force-dynamic";

/**
 * Counting the shelf.
 *
 * This is also how stock first gets into the system: a business that
 * already has goods does not receive them against a purchase order that
 * never existed here, it counts what it has and says so. The same screen
 * does both, because they are the same act - state what is there, and
 * let the difference be the movement.
 */
export default async function StockCountPage({
  searchParams,
}: {
  searchParams: Promise<{ warehouse?: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, "inventory.adjust")) return <Forbidden />;

  const supabase = await createSupabaseServerClient();

  const { data: warehouses, error: warehouseError } = await supabase
    .from("warehouses")
    .select("id, name")
    .eq("is_active", true)
    .order("name");

  if (warehouseError) {
    return (
      <Card>
        <ErrorState title="Warehouses could not be loaded" message="Please try again." />
      </Card>
    );
  }

  if (!warehouses?.length) {
    return (
      <>
        <PageHeader title="Stock count" description="Count what is on the shelf." />
        <Card className="mt-6">
          <EmptyState
            icon={Warehouse}
            title="No warehouse to count"
            description="Add a warehouse first. Stock is always held somewhere, and the count needs to know where."
          />
        </Card>
      </>
    );
  }

  const { warehouse } = await searchParams;
  const chosen = warehouses.find((w) => w.id === warehouse)?.id ?? warehouses[0].id;

  // Read through products_priced: table-level SELECT on products was
  // withdrawn in 0023, and the view is the only route to a row.
  const capabilities = await getCapabilities();

  const [{ data: products }, { data: levels }] = await Promise.all([
    supabase
      .from("products_priced")
      .select("id, sku, name, unit_of_measure, units_per_case")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("inventory")
      .select(capabilities.loosePieces
        ? "product_id, qty_on_hand, qty_pieces"
        : "product_id, qty_on_hand")
      .eq("warehouse_id", chosen),
  ]);

  const rows = (levels ?? []) as unknown as {
    product_id: string; qty_on_hand: number | null; qty_pieces?: number | null;
  }[];

  const onHand = new Map(rows.map((l) => [l.product_id, Number(l.qty_on_hand ?? 0)]));
  const onHandPieces = new Map(rows.map((l) => [l.product_id, Number(l.qty_pieces ?? 0)]));

  const countable: CountableProduct[] = (products ?? []).map((p) => ({
    id: p.id as string,
    sku: p.sku as string,
    name: p.name as string,
    unit: (p.unit_of_measure as string) ?? "unit",
    onHand: onHand.get(p.id as string) ?? 0,
    onHandPieces: onHandPieces.get(p.id as string) ?? 0,
    // Against a database before 0048 every product reads as unsplittable,
    // so the sheet shows one box per line exactly as it did before.
    piecesPerUnit: capabilities.loosePieces ? Number(p.units_per_case ?? 1) : 1,
  }));

  return (
    <>
      <PageHeader
        title="Stock count"
        description="Type what is physically on the shelf. The system works out the difference and records it."
        breadcrumbs={[
          { label: "Warehouse" },
          { label: "Stock", href: "/inventory" },
          { label: "Count" },
        ]}
      />

      <div className="mt-6">
        {countable.length === 0 ? (
          <Card>
            <EmptyState
              title="No products to count"
              description="Add products to the catalogue first, then come back and count them."
            />
          </Card>
        ) : (
          <CountSheet
            warehouses={warehouses.map((w) => ({ id: w.id as string, name: w.name as string }))}
            products={countable}
            warehouseId={chosen}
          />
        )}
      </div>
    </>
  );
}
