"use client";

import { useSync } from "./sync-provider";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Alert } from "@/components/ui/states";
import { formatQuantity, formatMoney, formatDateTime } from "@/lib/utils/format";
import { Boxes } from "lucide-react";
import type { OfflineSnapshot } from "@/lib/offline/queue";

/**
 * What is on the van right now.
 *
 * Quantities and selling prices only. The value of that stock at cost is
 * a management figure and the database will not hand a driver one, so it
 * is not asked for and not shown - what a driver needs is how many are
 * left and what they charge for them.
 */
export function VanStock({ initial }: { initial?: OfflineSnapshot | null }) {
  const { snapshot: cached, online } = useSync();
  const snapshot = cached ?? initial ?? null;

  const stock = snapshot?.stock ?? [];
  const priceBy = new Map((snapshot?.prices ?? []).map((p) => [p.product_id, p.unit_price]));
  const units = stock.reduce((s, i) => s + i.qty_on_hand, 0);
  const empty = stock.filter((s) => s.qty_on_hand === 0).length;

  if (!snapshot?.load) {
    return (
      <Card>
        <EmptyState
          icon={Boxes}
          title="Nothing loaded on your van"
          description="A supervisor loads your van at the depot before the round."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {!online && (
        <Alert tone="warning" title="Working offline">
          These are the figures as at your last sync. Sales you have made
          since are already taken off.
        </Alert>
      )}

      <Card>
        <CardBody className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="numeric text-sm font-medium text-[var(--text-primary)]">
              {snapshot.load.load_number}
            </span>
            <Badge tone={snapshot.load.status === "dispatched" ? "brand" : "info"}>
              {snapshot.load.status === "dispatched" ? "On the road" : snapshot.load.status}
            </Badge>
          </div>
          <p className="numeric text-xs text-[var(--text-secondary)]">
            {formatQuantity(units)} units across {formatQuantity(stock.length)} products
            {empty > 0 ? ` · ${empty} sold out` : ""}
          </p>
          {snapshot.cached_at && (
            <p className="numeric text-xs text-[var(--text-muted)]">
              As at {formatDateTime(snapshot.cached_at)}
            </p>
          )}
        </CardBody>
      </Card>

      {stock.length === 0 ? (
        <Card>
          <EmptyState
            icon={Boxes}
            title="Your van is empty"
            description="Everything on this load has been sold. Time to close the day."
          />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-[var(--border-subtle)]">
            {stock.map((s) => {
              const price = priceBy.get(s.product_id) ?? 0;
              return (
                <li key={s.product_id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                      {s.name}
                    </p>
                    <p className="numeric mt-0.5 text-xs text-[var(--text-muted)]">
                      {s.sku}{price ? ` · ${formatMoney(price)} each` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p
                      className={
                        "numeric text-lg font-semibold " +
                        (s.qty_on_hand === 0 ? "text-critical" : "text-[var(--text-primary)]")
                      }
                    >
                      {formatQuantity(s.qty_on_hand)}
                    </p>
                    <p className="text-[0.6875rem] text-[var(--text-muted)]">
                      {s.qty_on_hand === 0 ? "sold out" : "left"}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
