import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ErrorState, EmptyState } from "@/components/ui/states";
import { listCounterStock } from "@/features/commercial/queries";
import { listWarehouses } from "@/features/catalogue/queries";
import { CounterTill, type CounterCustomer } from "@/features/commercial/counter-till";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Warehouse } from "lucide-react";

export const metadata: Metadata = { title: "Counter" };

/**
 * The shop counter.
 *
 * Separate from the van till at /driver/sell, which caches a round so a
 * salesperson can work with no signal. This one stands next to the
 * stock it is selling, so it reads the shelf.
 */
export default async function CounterPage({
  searchParams,
}: {
  searchParams: Promise<{ warehouse?: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, "sales.create")) return <Forbidden />;

  const depots = await listWarehouses();
  if (!depots.ok) {
    return <Card><ErrorState title="Warehouses could not be loaded" message={depots.message} /></Card>;
  }
  if (!depots.data.length) {
    return (
      <>
        <PageHeader title="Counter" description="Sell to a customer at the shop." />
        <Card className="mt-6">
          <EmptyState
            icon={Warehouse}
            title="No warehouse to sell from"
            description="Add a warehouse first. A counter sale comes off a shelf, and the shelf has to exist."
          />
        </Card>
      </>
    );
  }

  const { warehouse } = await searchParams;
  const chosen = depots.data.find((w) => w.id === warehouse)?.id
    ?? depots.data.find((w) => w.isDefault)?.id
    ?? depots.data[0].id;

  const stock = await listCounterStock(chosen);
  if (!stock.ok) {
    return <Card><ErrorState title="Shop stock could not be loaded" message={stock.message} /></Card>;
  }

  /*
   * Customers, with what they may still owe.
   *
   * Only for credit - a walk-in paying cash needs none of this - so the
   * credit position is read once here rather than per customer, and the
   * till refuses a credit sale beyond the limit before it is sent.
   */
  const supabase = await createSupabaseServerClient();
  const [{ data: rows }, { data: positions }] = await Promise.all([
    supabase.from("customers").select("id, name").eq("is_active", true).order("name"),
    supabase.from("customer_credit_position").select("customer_id, credit_available"),
  ]);
  const available = new Map(
    (positions ?? []).map((p) => [p.customer_id as string, Number(p.credit_available ?? 0)]));
  const customers: CounterCustomer[] = (rows ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    creditAvailable: available.get(c.id as string) ?? 0,
  }));

  return (
    <>
      <PageHeader
        title="Counter"
        description={`Selling from ${depots.data.find((w) => w.id === chosen)?.name ?? "the shelf"}.`}
        breadcrumbs={[{ label: "Commercial" }, { label: "Sales", href: "/sales" }, { label: "Counter" }]}
      />
      <div className="mt-6">
        <CounterTill
          warehouses={depots.data.map((w) => ({ id: w.id, name: w.name }))}
          warehouseId={chosen}
          products={stock.data}
          customers={customers}
          // Anyone who may record a sale may record a credit one; the
          // customer's limit is what actually governs, and the database
          // checks it again.
          canSellOnCredit={can(user.role, "sales.create")}
        />
      </div>
    </>
  );
}
