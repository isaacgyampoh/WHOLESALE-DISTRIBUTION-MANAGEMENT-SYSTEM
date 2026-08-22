"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  allItems, pendingItems, updateItem, deviceId, saveSnapshot, setLastSyncedAt,
  type QueueItem, type OfflineSnapshot,
} from "./queue";

/**
 * Draining the offline queue.
 *
 * Every item goes to one database function, sync_submit(), carrying the
 * uuid it was given when it was queued. That function is idempotent on
 * that uuid, so this file is free to be simple-minded about retrying:
 * uploading the same operation ten times leaves one sale.
 *
 * What it must not do is decide whether the driver is allowed to do the
 * work. sync_submit() re-derives that from the session making the call.
 * A queue that sat on a phone overnight may belong to somebody whose
 * account was switched off, and this is the moment that has to be
 * caught.
 */

export type SyncOutcome = {
  attempted: number;
  synced: number;
  conflicts: number;
  failed: number;
  /** Set when the run stopped early because the network went away. */
  interrupted?: boolean;
};

/** Server verdicts, as returned by sync_submit(). */
interface SubmitResult {
  id: string;
  status: "applied" | "failed" | "conflict";
  result?: Record<string, unknown>;
  error?: string;
  replayed?: boolean;
}

function isNetworkFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /fetch|network|failed to|timeout|abort|offline/i.test(message);
}

/**
 * Push everything outstanding.
 *
 * Items are sent one at a time and in the order they happened. A round
 * usually has a sale and then a collection against the same customer,
 * and applying those out of order would produce a balance the driver
 * would not recognise.
 */
export async function drainQueue(): Promise<SyncOutcome> {
  const supabase = createSupabaseBrowserClient();
  const items = await pendingItems();
  const outcome: SyncOutcome = { attempted: 0, synced: 0, conflicts: 0, failed: 0 };

  if (!items.length) return outcome;

  const device = deviceId();

  for (const item of items) {
    outcome.attempted += 1;
    await updateItem(item.id, { status: "syncing", attempts: item.attempts + 1 });

    try {
      const { data, error } = await supabase.rpc("sync_submit", {
        p_id: item.id,
        p_device_id: device,
        p_operation: item.operation,
        p_payload: item.payload,
        p_occurred_at: item.occurredAt,
      });

      if (error) {
        // A transport failure means the server never saw it. Put it
        // back as pending so the next run picks it up; the attempt
        // counter still went up, which is what surfaces a stuck item.
        if (isNetworkFailure(error)) {
          await updateItem(item.id, { status: "pending", error: undefined });
          outcome.interrupted = true;
          break;
        }
        // Anything else is the server refusing: authorization, a
        // deactivated account, a malformed payload. Retrying will not
        // change the answer.
        await updateItem(item.id, {
          status: "failed",
          error: error.message.replace(/^.*?:\s*/, ""),
        });
        outcome.failed += 1;
        continue;
      }

      const verdict = data as SubmitResult | null;
      if (verdict?.status === "applied") {
        await updateItem(item.id, { status: "synced", error: undefined });
        outcome.synced += 1;
      } else if (verdict?.status === "conflict") {
        // The world moved while the driver was offline: stock gone, a
        // load closed, a product retired. This needs a person.
        await updateItem(item.id, { status: "conflict", error: verdict.error });
        outcome.conflicts += 1;
      } else {
        await updateItem(item.id, {
          status: "failed",
          error: verdict?.error ?? "The server rejected this operation.",
        });
        outcome.failed += 1;
      }
    } catch (thrown) {
      if (isNetworkFailure(thrown)) {
        await updateItem(item.id, { status: "pending", error: undefined });
        outcome.interrupted = true;
        break;
      }
      await updateItem(item.id, {
        status: "failed",
        error: thrown instanceof Error ? thrown.message : "Unknown error",
      });
      outcome.failed += 1;
    }
  }

  if (!outcome.interrupted) await setLastSyncedAt(new Date().toISOString());
  return outcome;
}

/**
 * Refresh what the device holds for working offline.
 *
 * Deliberately narrow - the van, its load, what is on board and the
 * active customers. A phone that is lost should not be carrying the
 * whole product catalogue at cost.
 */
export async function refreshSnapshot(): Promise<OfflineSnapshot | null> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("sync_bootstrap");
  if (error || !data) {
    if (error) console.error("[offline] snapshot refresh failed", error);
    return null;
  }
  const snapshot = data as OfflineSnapshot;
  await saveSnapshot(snapshot);
  return snapshot;
}

/** Push, then pull. Used by the sync button and by the online listener. */
export async function syncNow(): Promise<{ outcome: SyncOutcome; snapshot: OfflineSnapshot | null }> {
  const outcome = await drainQueue();
  // Only refresh the cached view once the queue is clear, or the driver
  // would see stock that does not account for sales still waiting to
  // upload.
  const snapshot = outcome.interrupted ? null : await refreshSnapshot();
  return { outcome, snapshot };
}

/** Anything the driver has to look at before the round can be closed. */
export async function itemsNeedingAttention(): Promise<QueueItem[]> {
  const items = await allItems();
  return items.filter((i) => i.status === "conflict" || i.status === "failed");
}
