import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import {
  getVanCrew, listAssignableDrivers, listAssignableSalespeople,
} from "@/features/distribution/queries";
import { AssignCrewButton, RemoveCrewButton } from "@/features/distribution/crew-forms";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card, CardHeader } from "@/components/ui/card";
import { StatTile, StatGrid } from "@/components/ui/stat-tile";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, Alert } from "@/components/ui/states";
import { formatMoney, formatQuantity, formatDate } from "@/lib/utils/format";
import { ArrowLeft, UserRound, Users } from "lucide-react";

export const metadata: Metadata = { title: "Van crew" };

/**
 * Who is on a van.
 *
 * A van goes out with a driver who drives it and one or more people who
 * sell from it. They are listed separately because they are different
 * jobs with different accountability - the driver answers for the
 * vehicle and its load, the salespeople for the money.
 */
export default async function VanCrewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, "vans.view")) return <Forbidden />;

  const { id } = await params;
  const mayCrew = can(user.role, "vans.crew");

  const [result, drivers, sellers] = await Promise.all([
    getVanCrew(id),
    mayCrew ? listAssignableDrivers() : Promise.resolve(null),
    mayCrew ? listAssignableSalespeople() : Promise.resolve(null),
  ]);

  if (!result.ok) {
    return (
      <>
        <PageHeader title="Van crew" breadcrumbs={[{ label: "Distribution" }, { label: "Vans" }]} />
        <Card><ErrorState title="Crew could not be loaded" message={result.message} /></Card>
      </>
    );
  }
  if (!result.data) notFound();

  const van = result.data;
  const out = van.loadStatus === "dispatched";

  return (
    <>
      <PageHeader
        title={van.vanCode}
        description={`${van.registrationNo}${van.homeWarehouse ? ` · ${van.homeWarehouse}` : ""}`}
        breadcrumbs={[
          { label: "Distribution" },
          { label: "Vans", href: "/vans" },
          { label: "Crew" },
        ]}
      />

      <Link
        href="/vans"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All vans
      </Link>

      <StatGrid>
        <StatTile
          label="Status"
          value={out ? "Out" : van.openLoad ? "Loading" : "In"}
          sub={van.openLoad ? van.openLoad : "No open load"}
          tone={out ? "caution" : "neutral"}
        />
        <StatTile label="Sold today" value={formatMoney(van.today.revenue)}
                  sub={`${formatQuantity(van.today.saleCount)} sales`}
                  tone={van.today.revenue > 0 ? "positive" : "neutral"} />
        <StatTile label="On account today" value={formatMoney(van.today.credit)}
                  sub="Sold on credit"
                  tone={van.today.credit > 0 ? "caution" : "neutral"} />
        <StatTile label="Stock on board" value={formatQuantity(van.today.stockUnits)}
                  sub="Units remaining" href={`/vans?van=${van.vanId}`} />
      </StatGrid>

      {!van.isActive && (
        <Alert tone="warning">
          This van is not active. It cannot be loaded or dispatched until it is.
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ---- the driver ---- */}
        <Card>
          <CardHeader
            title="Driver"
            description="One per van. Answers for the vehicle and its load."
            action={
              mayCrew && drivers?.ok ? (
                <AssignCrewButton
                  vanId={van.vanId}
                  vanCode={van.vanCode}
                  crewRole="driver"
                  people={drivers.data}
                  replacing={van.driver?.memberName ?? null}
                />
              ) : undefined
            }
          />

          {!van.driver ? (
            <EmptyState
              icon={UserRound}
              title="No driver assigned"
              description="A van cannot be dispatched without one."
            />
          ) : (
            <div className="flex items-center justify-between gap-3 px-5 py-4">
              <div className="min-w-0">
                <p className="font-medium text-[var(--text-primary)]">
                  {van.driver.memberName}
                </p>
                <p className="numeric mt-0.5 text-xs text-[var(--text-muted)]">
                  {van.driver.memberPhone ?? "No phone number"} · since{" "}
                  {formatDate(van.driver.assignedAt)}
                </p>
              </div>
              {mayCrew && (
                <RemoveCrewButton
                  assignmentId={van.driver.assignmentId}
                  memberName={van.driver.memberName}
                  vanCode={van.vanCode}
                  crewRole="driver"
                />
              )}
            </div>
          )}
        </Card>

        {/* ---- the salespeople ---- */}
        <Card>
          <CardHeader
            title="Salespeople"
            description="Whoever sells from this van. There can be several."
            action={
              mayCrew && sellers?.ok ? (
                <AssignCrewButton
                  vanId={van.vanId}
                  vanCode={van.vanCode}
                  crewRole="salesperson"
                  people={sellers.data}
                />
              ) : undefined
            }
          />

          {van.salespeople.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Nobody is selling from this van"
              description="A van with no salesperson cannot be dispatched: goods would leave the warehouse with no way to record what happened to them."
            />
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {van.salespeople.map((person) => (
                <li key={person.assignmentId}
                    className="flex items-center justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <p className="font-medium text-[var(--text-primary)]">
                      {person.memberName}
                    </p>
                    <p className="numeric mt-0.5 text-xs text-[var(--text-muted)]">
                      {person.memberPhone ?? "No phone number"} · since{" "}
                      {formatDate(person.assignedAt)}
                    </p>
                  </div>
                  {mayCrew && (
                    <RemoveCrewButton
                      assignmentId={person.assignmentId}
                      memberName={person.memberName}
                      vanCode={van.vanCode}
                      crewRole="salesperson"
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {van.history.length > 0 && (
        <Card>
          <CardHeader
            title="Who has been on this van"
            description="Kept so a question about an old round can be answered."
          />
          <ul className="divide-y divide-[var(--border-subtle)]">
            {van.history.map((entry, i) => (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3">
                <span className="text-sm text-[var(--text-primary)]">
                  {entry.memberName}
                  <Badge tone="neutral" className="ml-2">
                    {entry.crewRole === "driver" ? "Driver" : "Salesperson"}
                  </Badge>
                </span>
                <span className="numeric text-xs text-[var(--text-muted)]">
                  {formatDate(entry.assignedAt)} — {formatDate(entry.unassignedAt)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
