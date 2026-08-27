import Link from "next/link";
import { ShoppingCart, Truck, Store } from "lucide-react";
import { StatTile } from "./stat-tile";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState, Alert } from "@/components/ui/states";
import { formatMoney, formatQuantity } from "@/lib/utils/format";
import type { SalespersonSummary } from "@/features/selling/queries";

/**
 * A salesperson's home: where they are selling from, and the one button
 * that matters. A field salesperson opens this at the roadside; a shop
 * assistant opens it behind the counter, and the only difference between
 * them is what the server said their location is.
 */
export function SalespersonDashboard({ summary }: { summary: SalespersonSummary }) {
  const { context } = summary;

  if (!context || context.blockedReason) {
    return (
      <Card>
        <EmptyState
          icon={Truck}
          title="You have nowhere to sell from yet"
          description={
            context?.blockedReason ??
            "A manager assigns you to a van, or to a shop counter. Until then there is no stock you can sell."
          }
        />
      </Card>
    );
  }

  const onVan = context.kind === "van";

  return (
    <>
      <Card className="mb-5">
        <CardBody className="flex flex-wrap items-center justify-between gap-4 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-[var(--surface-sunken)] p-2.5">
              {onVan ? (
                <Truck className="size-5 text-[var(--text-secondary)]" aria-hidden />
              ) : (
                <Store className="size-5 text-[var(--text-secondary)]" aria-hidden />
              )}
            </div>
            <div>
              <p className="text-xs text-[var(--text-muted)]">
                {onVan ? "You are selling from" : "Your counter"}
              </p>
              <p className="font-semibold text-[var(--text-primary)]">{context.locationName}</p>
            </div>
          </div>

          <Link
            href="/sell"
            className="inline-flex h-12 items-center gap-2 rounded-[var(--radius-panel)] bg-brand-700 px-6 text-sm font-medium text-white hover:bg-brand-800"
          >
            <ShoppingCart className="size-4" aria-hidden />
            Start a sale
          </Link>
        </CardBody>
      </Card>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile
          label={onVan ? "Lines on your van" : "Lines you can sell"}
          value={formatQuantity(summary.linesAvailable)}
          sub={`${formatQuantity(summary.unitsAvailable)} units available`}
          href="/sell"
        />
        <StatTile
          label="Sales today"
          value={formatQuantity(summary.salesToday)}
          sub="Completed by you"
        />
        <StatTile label="Cash taken today" value={formatMoney(summary.cashToday)} sub="Paid at the point of sale" />
        <StatTile
          label="Sold on credit today"
          value={formatMoney(summary.creditToday)}
          sub="Added to customer accounts"
          tone={summary.creditToday > 0 ? "caution" : "neutral"}
        />
      </div>

      {onVan && summary.linesAvailable === 0 && (
        <div className="mt-5">
          <Alert tone="warning" title="Your van is empty">
            There is nothing loaded on {context.locationName} to sell. The warehouse
            loads and dispatches the van before the round.
          </Alert>
        </div>
      )}
    </>
  );
}
