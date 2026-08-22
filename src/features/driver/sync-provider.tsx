"use client";

import {
  createContext, useContext, useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import {
  countByStatus, allItems, readSnapshot, lastSyncedAt, clearSynced,
  type QueueItem, type OfflineSnapshot, type QueueStatus,
} from "@/lib/offline/queue";
import { syncNow, refreshSnapshot } from "@/lib/offline/sync";

/**
 * One place that knows whether the device is online, what is waiting to
 * upload, and what the van looked like the last time there was a
 * signal.
 *
 * navigator.onLine is not a reliable answer to "can I reach the
 * server" - it reports the radio, not the route - so it is treated as a
 * hint that starts a sync, never as proof one will succeed. What the
 * driver is shown comes from whether the last attempt actually got
 * through.
 */

interface SyncContextValue {
  online: boolean;
  syncing: boolean;
  counts: Record<QueueStatus, number>;
  items: QueueItem[];
  snapshot: OfflineSnapshot | null;
  lastSync: string | null;
  /** Upload everything outstanding, then refresh the cached view. */
  sync: () => Promise<void>;
  /** Re-read the queue after something was added to it. */
  refresh: () => Promise<void>;
  /** Forget operations that reached the server. */
  clearDone: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

const EMPTY: Record<QueueStatus, number> = {
  pending: 0, syncing: 0, synced: 0, failed: 0, conflict: 0,
};

export function SyncProvider({ children }: { children: React.ReactNode }) {
  // Read once at mount rather than assigned from inside the effect:
  // setting it there triggers a second render before the first has
  // painted. Server-side there is no navigator, and optimistic "online"
  // is the right default - the first sync corrects it.
  const [online, setOnline] = useState(
    () => (typeof navigator === "undefined" ? true : navigator.onLine),
  );
  const [syncing, setSyncing] = useState(false);
  const [counts, setCounts] = useState(EMPTY);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [snapshot, setSnapshot] = useState<OfflineSnapshot | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  // Guards against two syncs overlapping - the online event and the
  // interval both fire when a van comes back into coverage.
  const running = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setCounts(await countByStatus());
      setItems(await allItems());
      setSnapshot(await readSnapshot());
      setLastSync(await lastSyncedAt());
    } catch {
      // No IndexedDB (private mode, an old browser). The app still
      // works online; it just cannot queue.
    }
  }, []);

  const sync = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setSyncing(true);
    try {
      const { outcome } = await syncNow();
      setOnline(!outcome.interrupted);
    } catch {
      setOnline(false);
    } finally {
      running.current = false;
      setSyncing(false);
      await refresh();
    }
  }, [refresh]);

  const clearDone = useCallback(async () => {
    await clearSynced();
    await refresh();
  }, [refresh]);

  useEffect(() => {
    // Reading IndexedDB is asynchronous and can only happen in the
    // browser, so the queue genuinely cannot be part of the first
    // render. The lint rule is about effects that set state
    // synchronously and cascade; every write here lands after an await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();

    // A first snapshot so the app has something to show if the signal
    // drops before the driver has done anything.
    if (navigator.onLine) {
      void refreshSnapshot().then((s) => { if (s) setSnapshot(s); });

      // Ask the service worker to put the driver's screens in the cache
      // while there is still a signal, so a dead spot does not depend on
      // them having opened each one first.
      void navigator.serviceWorker?.ready
        .then((registration) => {
          registration.active?.postMessage({
            type: "gab-warm",
            routes: ["/driver", "/driver/sell", "/driver/collect",
                     "/driver/return", "/driver/reconcile", "/driver/queue"],
          });
        })
        .catch(() => {});
    }

    const goOnline = () => { setOnline(true); void sync(); };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    // The service worker asks for a drain when the browser's background
    // sync fires, which covers the app being closed when signal returns.
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "gab-sync-now") void sync();
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);

    // A slow trickle for the case neither event fires: some Android
    // browsers stay "online" through a dead cell and recover silently.
    const timer = setInterval(() => {
      if (navigator.onLine) void sync();
    }, 60_000);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<SyncContextValue>(
    () => ({ online, syncing, counts, items, snapshot, lastSync, sync, refresh, clearDone }),
    [online, syncing, counts, items, snapshot, lastSync, sync, refresh, clearDone],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const value = useContext(SyncContext);
  if (!value) throw new Error("useSync must be used inside a SyncProvider.");
  return value;
}
