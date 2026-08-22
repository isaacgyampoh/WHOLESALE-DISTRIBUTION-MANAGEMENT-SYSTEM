"use client";

import { useSync } from "./sync-provider";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Alert } from "@/components/ui/states";
import { formatDateTime } from "@/lib/utils/format";
import { ListChecks, RefreshCw, Trash2 } from "lucide-react";
import type { QueueStatus } from "@/lib/offline/queue";

/**
 * Everything this device has recorded, and where each item got to.
 *
 * A driver who sold all morning with no signal needs to be able to
 * point at a screen and say what has and has not reached the office.
 * Nothing is hidden once it succeeds either - "synced" is the evidence
 * that the sale is really there.
 */
const LABEL: Record<QueueStatus, string> = {
  pending: "Waiting to send",
  syncing: "Sending",
  synced: "Sent",
  failed: "Refused",
  conflict: "Needs attention",
};

const TONE: Record<QueueStatus, "neutral" | "info" | "positive" | "critical" | "caution"> = {
  pending: "caution",
  syncing: "info",
  synced: "positive",
  failed: "critical",
  conflict: "critical",
};

export function QueueList() {
  const { items, counts, syncing, online, sync, clearDone } = useSync();
  const attention = counts.conflict + counts.failed;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void sync()} loading={syncing} disabled={!online || syncing}>
          {!syncing && <RefreshCw className="size-4" aria-hidden />}
          Send everything
        </Button>
        {counts.synced > 0 && (
          <Button variant="outline" onClick={() => void clearDone()}>
            <Trash2 className="size-4" aria-hidden />
            Clear {counts.synced} sent
          </Button>
        )}
      </div>

      {attention > 0 && (
        <Alert tone="danger" title={`${attention} need${attention === 1 ? "s" : ""} attention`}>
          These did not go through. Show them to your supervisor before you
          hand in your cash - the office has not recorded them.
        </Alert>
      )}

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={ListChecks}
            title="Nothing recorded on this phone"
            description="Sales, collections and returns you record show up here until the office has them."
          />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-[var(--border-subtle)]">
            {[...items].reverse().map((item) => (
              <li key={item.id} className="px-5 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 text-sm font-medium text-[var(--text-primary)]">
                    {item.summary}
                  </p>
                  <Badge tone={TONE[item.status]}>{LABEL[item.status]}</Badge>
                </div>
                <p className="numeric mt-1 text-xs text-[var(--text-muted)]">
                  {formatDateTime(item.occurredAt)}
                  {item.attempts > 1 ? ` · ${item.attempts} attempts` : ""}
                </p>
                {item.error && (
                  <p className="mt-1 text-xs text-critical">{item.error}</p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardBody>
          <p className="text-xs text-[var(--text-secondary)]">
            Each item carries an identifier made on this phone when you
            recorded it. Sending twice cannot create it twice, so it is
            always safe to press Send everything again.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
