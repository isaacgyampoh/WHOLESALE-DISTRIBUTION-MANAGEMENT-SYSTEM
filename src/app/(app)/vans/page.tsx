import type { Metadata } from "next";
import { Truck } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { getFleet, getCrewCandidates } from "@/features/van/fleet-queries";
import { CrewPanel, CrewBadges } from "@/features/van/crew-panel";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/badge";
import { formatMoney, formatQuantity } from "@/lib/utils/format";
import { toAppError } from "@/lib/errors/app-error";

export const metadata: Metadata = { title: "Vans" };

export default async function VansPage() {
  const user = await requirePermission("vans.view");
  const mayManage = can(user.role, "vans.manage");

  let fleet, candidates;
  try {
    [fleet, candidates] = await Promise.all([
      getFleet(),
      mayManage ? getCrewCandidates() : Promise.resolve([]),
    ]);
  } catch (error) {
    console.error("[fleet] could not load", error);
    return (
      <>
        <PageHeader title="Vans" />
        <Card>
          <ErrorState title="The fleet could not be loaded" message={toAppError(error).userMessage} />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Vans"
        description="Each van, what it is carrying, and who is on it."
      />

      {fleet.length === 0 ? (
        <Card>
          <EmptyState icon={Truck} title="No vans yet" description="Add a van to start running rounds." />
        </Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {fleet.map((van) => (
            <Card key={van.id}>
              <CardHeader
                title={van.code}
                description={`${van.registration}${van.homeWarehouse ? ` - based at ${van.homeWarehouse}` : ""}`}
                action={van.loadStatus ? <StatusBadge status={van.loadStatus} /> : undefined}
              />
              <CardBody className="space-y-4">
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <Figure label="Lines" value={formatQuantity(van.lineCount)} />
                  <Figure label="Units" value={formatQuantity(van.unitsOnBoard)} />
                  <Figure label="Value" value={formatMoney(van.stockValue)} />
                </div>

                {mayManage ? (
                  <CrewPanel van={van} candidates={candidates} />
                ) : (
                  <CrewBadges van={van} />
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-panel)] bg-[var(--surface-sunken)] px-3 py-2">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className="numeric font-semibold text-[var(--text-primary)]">{value}</p>
    </div>
  );
}
