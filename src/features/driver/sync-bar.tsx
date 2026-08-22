"use client";

import { useSync } from "./sync-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Cloud, CloudOff, RefreshCw, AlertTriangle, Check } from "lucide-react";
import { formatDateTime } from "@/lib/utils/format";

/**
 * Connection and queue state, always visible while a driver is working.
 *
 * A driver deciding whether to hand over cash needs to know whether the
 * office has actually seen their sales. "3 waiting to send" is that
 * answer; a spinner is not.
 */
export function SyncBar() {
  const { online, syncing, counts, lastSync, sync } = useSync();
  const waiting = counts.pending + counts.syncing + counts.failed;
  const attention = counts.conflict + counts.failed;

  return (
    <div
      className={
        "sticky top-0 z-30 flex items-center justify-between gap-3 border-b px-4 py-2.5 " +
        (online
          ? "border-[var(--border-subtle)] bg-[var(--surface-raised)]"
          : "border-caution/30 bg-caution-soft dark:bg-caution/15")
      }
    >
      <div className="flex min-w-0 items-center gap-2">
        {online ? (
          <Cloud className="size-4 shrink-0 text-positive" aria-hidden />
        ) : (
          <CloudOff className="size-4 shrink-0 text-caution" aria-hidden />
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--text-primary)]">
            {online ? "Connected" : "Working offline"}
          </p>
          <p className="numeric truncate text-xs text-[var(--text-secondary)]">
            {waiting > 0
              ? `${waiting} waiting to send`
              : lastSync
                ? `Sent ${formatDateTime(lastSync)}`
                : "Nothing to send"}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {attention > 0 && (
          <Badge tone="critical">
            <AlertTriangle className="size-3" aria-hidden />
            {attention}
          </Badge>
        )}
        {waiting === 0 && attention === 0 && online && (
          <Badge tone="positive">
            <Check className="size-3" aria-hidden />
            Up to date
          </Badge>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => void sync()}
          loading={syncing}
          disabled={!online || syncing}
        >
          {!syncing && <RefreshCw className="size-3.5" aria-hidden />}
          Sync
        </Button>
      </div>
    </div>
  );
}

/** A quieter version for screens that are not the driver's home. */
export function SyncPill() {
  const { online, counts } = useSync();
  const waiting = counts.pending + counts.syncing + counts.failed;

  if (online && waiting === 0) return null;

  return (
    <Badge tone={online ? "info" : "caution"}>
      {online ? <Cloud className="size-3" aria-hidden /> : <CloudOff className="size-3" aria-hidden />}
      {online ? `${waiting} to send` : "Offline"}
    </Badge>
  );
}
