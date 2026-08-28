import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { getMyVanCrew, getVanDayActivity } from "@/features/driver/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card, CardHeader } from "@/components/ui/card";
import { StatTile, StatGrid } from "@/components/ui/stat-tile";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { formatQuantity, formatDate } from "@/lib/utils/format";
import { Truck, Users, PackageMinus } from "lucide-react";

export const metadata: Metadata = { title: "My van" };

/**
 * The driver's van.
 *
 * A driver's questions are about the vehicle: which one is mine, what is
 * on it, who is selling from it today. There is no money on this page
 * and no till, because neither is their job — the salespeople handle
 * that, and this screen names them so the driver knows who is aboard.
 */
export default async function MyVanPage() {
  const user = await requireUser();
  if (!can(user.role, "vans.view")) return <Forbidden />;

  const result = await getMyVanCrew(user.id);
  // Read-only, and only once there is a van to ask about.
  const activity = result.ok && result.data
    ? await getVanDayActivity(result.data.vanId)
    : null;

  if (!result.ok) {
    return (
      <>
        <PageHeader title="My van" breadcrumbs={[{ label: "My van" }]} />
        <Card><ErrorState title="Your van could not be loaded" message={result.message} /></Card>
      </>
    );
  }

  const van = result.data;

  if (!van) {
    return (
      <>
        <PageHeader title="My van" breadcrumbs={[{ label: "My van" }]} />
        <Card>
          <EmptyState
            icon={Truck}
            title="You are not on a van"
            description="Somebody in the office assigns a van and its crew. Until then there is nothing here for you to do."
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={van.vanCode}
        description={van.registrationNo}
        breadcrumbs={[{ label: "My van" }]}
      />

      <StatGrid>
        <StatTile
          label="Status"
          value={van.loadStatus === "dispatched" ? "Out" : van.openLoad ? "Loading" : "In the yard"}
          sub={van.openLoad ?? "No load open"}
          tone={van.loadStatus === "dispatched" ? "caution" : "neutral"}
        />
        <StatTile label="On board" value={formatQuantity(van.stockUnits)}
                  sub={`${formatQuantity(van.stockLines)} lines`} href="/driver/stock" />
        <StatTile label="Selling today" value={formatQuantity(van.salespeople.length)}
                  sub={van.salespeople.length === 1 ? "salesperson" : "salespeople"}
                  tone={van.salespeople.length === 0 ? "critical" : "neutral"} />
        <StatTile label="My role" value="Driver" sub="You drive; they sell" />
      </StatGrid>

      <Card>
        <CardHeader
          title="Who is aboard"
          description="The people selling from your van today."
        />

        {van.salespeople.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Nobody is selling from this van"
            description="It cannot be dispatched until somebody is. Tell the office."
          />
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {van.salespeople.map((person) => (
              <li key={person.memberId} className="flex items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="font-medium text-[var(--text-primary)]">{person.memberName}</p>
                  {person.memberPhone && (
                    <a href={`tel:${person.memberPhone}`}
                       className="numeric mt-0.5 block text-xs text-brand-700">
                      {person.memberPhone}
                    </a>
                  )}
                </div>
                <Badge tone="info">Salesperson</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/*
        What has gone off the van today, and who took it.
        
        The driver's actual question: the load went out at fifty, there
        are forty-five on the shelf, and until this nothing on screen
        accounted for the five. Read-only - the vehicle is the driver's
        responsibility, the till is not.
      */}
      {activity?.ok && activity.data.lines.length > 0 && (
        <Card>
          <CardHeader
            title="Sold from this van today"
            description={activity.data.soldBy.length > 0
              ? `${activity.data.saleCount} sale${activity.data.saleCount === 1 ? "" : "s"} by ${activity.data.soldBy.join(", ")}.`
              : `${activity.data.saleCount} sale${activity.data.saleCount === 1 ? "" : "s"}.`}
          />
          <ul className="divide-y divide-[var(--border-subtle)]">
            {activity.data.lines.map((line) => (
              <li key={line.productId} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                    {line.productName}
                  </p>
                  <p className="numeric text-xs text-[var(--text-muted)]">{line.sku}</p>
                </div>
                <div className="text-right">
                  <p className="numeric text-sm text-[var(--text-primary)]">
                    {formatQuantity(line.soldToday)} sold
                  </p>
                  <p className="numeric text-xs text-[var(--text-muted)]">
                    {formatQuantity(line.remaining)} left
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {activity?.ok && activity.data.lines.length === 0 && (
        <Card>
          <EmptyState
            icon={PackageMinus}
            title="Nothing sold from this van yet today"
            description="What the salespeople sell will show here, with what is left on board."
          />
        </Card>
      )}

      {van.openLoad && (
        <Card>
          <CardHeader
            title="Today's load"
            description="What you signed for when it left the warehouse."
          />
          <dl className="grid gap-4 px-5 py-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Load</dt>
              <dd className="numeric mt-0.5 text-sm text-[var(--text-primary)]">{van.openLoad}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Dated</dt>
              <dd className="numeric mt-0.5 text-sm text-[var(--text-primary)]">
                {van.loadDate ? formatDate(van.loadDate) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Status</dt>
              <dd className="mt-0.5">
                <Badge tone={van.loadStatus === "dispatched" ? "caution" : "neutral"}>
                  {van.loadStatus === "dispatched" ? "Out on the road" : "Being loaded"}
                </Badge>
              </dd>
            </div>
          </dl>
        </Card>
      )}
    </>
  );
}
