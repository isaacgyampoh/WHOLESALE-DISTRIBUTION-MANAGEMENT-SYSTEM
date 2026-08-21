import { StatTile } from "./stat-tile";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { EmptyState, Alert } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/badge";
import { formatMoney, formatQuantity } from "@/lib/utils/format";
import type { DriverSummary } from "./driver-queries";
import { Truck } from "lucide-react";

/**
 * A driver's own round, not a shrunken copy of the admin dashboard.
 *
 * The figures a driver is answerable for at the end of the day are the
 * ones shown: what went out, what sold, what was collected. Expected cash
 * is deliberately absent - the database computes that at reconciliation,
 * and showing a driver a number to aim at would defeat the control.
 */
export function DriverDashboard({ summary }: { summary: DriverSummary }) {
  if (!summary.vanCode) {
    return (
      <Card>
        <EmptyState
          icon={Truck}
          title="No van assigned"
          description="A manager needs to assign you to a van before you can load stock or record sales."
        />
      </Card>
    );
  }

  const takings = summary.cashSalesToday + summary.collectionsToday;

  return (
    <>
      <Card className="mb-5">
        <CardHeader
          title={`Van ${summary.vanCode}`}
          description={summary.vanRegistration ?? undefined}
          action={summary.loadStatus ? <StatusBadge status={summary.loadStatus} /> : undefined}
        />
        <CardBody className="py-4">
          {summary.loadNumber ? (
            <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <div>
                <span className="text-[var(--text-muted)]">Load</span>{" "}
                <span className="font-medium">{summary.loadNumber}</span>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">Opening float</span>{" "}
                <span className="numeric font-medium">{formatMoney(summary.openingFloat)}</span>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">Lines on board</span>{" "}
                <span className="numeric font-medium">{formatQuantity(summary.lineCount)}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--text-secondary)]">
              No load is open. The warehouse will load and dispatch your van before you set off.
            </p>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Stock on board"
          value={formatQuantity(summary.unitsOnVan)}
          sub={`${formatMoney(summary.vanStockValue)} at cost`}
        />
        <StatTile
          label="Cash sales today"
          value={formatMoney(summary.cashSalesToday)}
          sub={`${summary.salesCountToday} sale${summary.salesCountToday === 1 ? "" : "s"} recorded`}
        />
        <StatTile
          label="Credit sales today"
          value={formatMoney(summary.creditSalesToday)}
          sub="Owed by customers"
        />
        <StatTile
          label="Collected today"
          value={formatMoney(summary.collectionsToday)}
          sub="Payments taken in the field"
        />
      </div>

      <div className="mt-5">
        <Alert tone="info" title="Cash to hand in">
          Float plus cash sales plus collections, currently{" "}
          <span className="numeric font-medium text-[var(--text-primary)]">
            {formatMoney(summary.openingFloat + takings)}
          </span>
          . The final figure is calculated from the ledger at reconciliation.
        </Alert>
      </div>
    </>
  );
}
