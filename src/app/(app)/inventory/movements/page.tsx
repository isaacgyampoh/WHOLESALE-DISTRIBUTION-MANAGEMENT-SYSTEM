import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { listMovements } from "@/features/catalogue/queries";
import { MovementList } from "@/features/catalogue/movement-list";
import { MovementFilters } from "@/features/catalogue/movement-filters";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, Alert } from "@/components/ui/states";
import { ArrowLeftRight } from "lucide-react";

export const metadata: Metadata = { title: "Stock movements" };

const PERIODS: Record<string, number> = { "24h": 1, "7d": 7, "30d": 30 };

export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; type?: string; period?: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, "inventory.view")) return <Forbidden />;

  const { search, type, period } = await searchParams;
  const result = await listMovements({
    search,
    type,
    periodDays: period ? PERIODS[period] : undefined,
  }, 200);

  return (
    <>
      <PageHeader
        title="Stock movements"
        description="Every change to stock, in the order it happened."
        breadcrumbs={[
          { label: "Warehouse" },
          { label: "Inventory", href: "/inventory" },
          { label: "Movements" },
        ]}
      />

      <div className="mb-5">
        <Alert tone="info" title="The ledger cannot be edited">
          Stock quantities are derived from these entries. A mistake is
          corrected by posting a reversing movement, never by changing history.
        </Alert>
      </div>

      {!result.ok ? (
        <Card><ErrorState title="Stock movements could not be loaded" message={result.message} /></Card>
      ) : (
        <>
          <MovementFilters total={result.data.length} />
          {result.data.length === 0 ? (
            <Card>
              <EmptyState
                icon={ArrowLeftRight}
                title="No stock movements match"
                description="Try a different product, movement type or period."
              />
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <MovementList movements={result.data} />
            </Card>
          )}
        </>
      )}
    </>
  );
}
