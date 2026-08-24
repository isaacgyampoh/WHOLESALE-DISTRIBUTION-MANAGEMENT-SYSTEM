/**
 * The offline queue.
 *
 * A driver in a dead spot records a sale, a collection or a return. It
 * goes in here first and is uploaded later, and the two halves of that
 * sentence are what make it safe:
 *
 *   - Every operation is given a uuid on the device *before* it is
 *     stored. That uuid is the primary key of `sync_operations` in the
 *     database, so uploading twice cannot apply the work twice. The
 *     retry safety is a constraint, not a promise this file makes.
 *
 *   - Nothing here is trusted for authorization. The queue records what
 *     the driver did, never who they are or what they may do. The
 *     server re-derives that from the session doing the syncing, which
 *     matters most in exactly the case this file exists for: a device
 *     that has been offline for hours may be holding a role that was
 *     revoked while it was away.
 *
 * IndexedDB rather than localStorage: a round can be a hundred
 * operations, localStorage is synchronous and capped at a few
 * megabytes, and losing a queue because a quota was hit silently is
 * not an acceptable failure for somebody's day of sales.
 */

export type QueuedOperation = "van_sale" | "collection" | "van_return" | "reconciliation";

export type QueueStatus = "pending" | "syncing" | "synced" | "failed" | "conflict";

export interface QueueItem {
  /** Idempotency key. Generated here, before the work is stored. */
  id: string;
  operation: QueuedOperation;
  payload: Record<string, unknown>;
  status: QueueStatus;
  /** What the driver was doing, in words, for the queue screen. */
  summary: string;
  attempts: number;
  error?: string;
  /** When the driver performed it, as this device saw the clock. */
  occurredAt: string;
  updatedAt: string;
}

const DB_NAME = "gab-offline";
const DB_VERSION = 1;
const STORE = "queue";
const META = "meta";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("This browser has no IndexedDB."));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("status", "status");
        store.createIndex("occurredAt", "occurredAt");
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB refused to open."));
  });
  return dbPromise;
}

function run<T>(
  storeName: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const request = work(tx.objectStore(storeName));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
      }),
  );
}

/**
 * A uuid, from the platform where it exists.
 *
 * crypto.randomUUID needs a secure context; a phone on plain http over
 * a depot's wifi is a real case, so there is a fallback. Both draw on
 * crypto.getRandomValues - Math.random is not acceptable for a key
 * whose collision would merge two drivers' sales.
 */
export function newOperationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;   // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80;   // variant 1
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * This device's identity, so a sale can be traced to the phone that
 * took it. Not a credential and not used for authorization - it is a
 * label in the sync history.
 */
export function deviceId(): string {
  const KEY = "gab-device-id";
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const id = `dev-${newOperationId().slice(0, 13)}`;
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    // Private mode, or storage blocked. A per-session label is still
    // more useful than none.
    return "dev-ephemeral";
  }
}

export async function enqueue(
  operation: QueuedOperation,
  payload: Record<string, unknown>,
  summary: string,
): Promise<QueueItem> {
  const now = new Date().toISOString();
  const item: QueueItem = {
    id: newOperationId(),
    operation,
    payload,
    summary,
    status: "pending",
    attempts: 0,
    occurredAt: now,
    updatedAt: now,
  };
  await run(STORE, "readwrite", (store) => store.put(item));
  return item;
}

export async function allItems(): Promise<QueueItem[]> {
  const items = await run<QueueItem[]>(STORE, "readonly", (store) => store.getAll());
  return items.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}

export async function pendingItems(): Promise<QueueItem[]> {
  const items = await allItems();
  // "syncing" is included deliberately: a tab closed mid-upload leaves
  // an item stuck in that state, and the idempotency key makes
  // retrying it free.
  return items.filter((i) => i.status === "pending" || i.status === "syncing" || i.status === "failed");
}

export async function countByStatus(): Promise<Record<QueueStatus, number>> {
  const items = await allItems();
  const counts: Record<QueueStatus, number> = {
    pending: 0, syncing: 0, synced: 0, failed: 0, conflict: 0,
  };
  for (const item of items) counts[item.status] += 1;
  return counts;
}

export async function updateItem(id: string, patch: Partial<QueueItem>): Promise<void> {
  const existing = await run<QueueItem | undefined>(STORE, "readonly", (store) => store.get(id));
  if (!existing) return;
  await run(STORE, "readwrite", (store) =>
    store.put({ ...existing, ...patch, updatedAt: new Date().toISOString() }),
  );
}

export async function removeItem(id: string): Promise<void> {
  await run(STORE, "readwrite", (store) => store.delete(id));
}

/**
 * Clear operations that reached the server. Conflicts and failures are
 * kept: they are the ones somebody has to look at, and deleting them
 * would lose the only record that the work was attempted.
 */
export async function clearSynced(): Promise<number> {
  const items = await allItems();
  const done = items.filter((i) => i.status === "synced");
  for (const item of done) await removeItem(item.id);
  return done.length;
}

// ------------------------------------------------------------- cache
//
// The read-side snapshot: the van, its load, what is on board and the
// active customers. Written whenever the device is online and read when
// it is not.

export interface OfflineSnapshot {
  cached_at: string;
  van: { id: string; code: string; registration_no: string } | null;
  load: { id: string; load_number: string; status: string; opening_float: number } | null;
  stock: { product_id: string; sku: string; name: string; qty_on_hand: number }[];
  prices: {
    product_id: string; unit_price: number; tax_rate: number;
    /** Public bucket path. Cacheable, so the picture survives the signal going. */
    image_path?: string | null;
  }[];
  customers: {
    id: string; code: string; name: string; phone: string | null;
    balance: number; credit_available: number;
  }[];
}

/**
 * Replace the cached round.
 *
 * Named apart from saveSnapshot so a caller reading the code can see
 * that this is a deliberate refresh - after adding a customer at the
 * counter, say - rather than the periodic one the sync engine does.
 */
export async function refreshSnapshotInto(snapshot: OfflineSnapshot): Promise<void> {
  await saveSnapshot(snapshot);
}

export async function saveSnapshot(snapshot: OfflineSnapshot): Promise<void> {
  await run(META, "readwrite", (store) =>
    store.put({ key: "snapshot", value: snapshot, savedAt: new Date().toISOString() }),
  );
}

export async function readSnapshot(): Promise<OfflineSnapshot | null> {
  try {
    const row = await run<{ value: OfflineSnapshot } | undefined>(
      META, "readonly", (store) => store.get("snapshot"),
    );
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export async function lastSyncedAt(): Promise<string | null> {
  try {
    const row = await run<{ value: string } | undefined>(
      META, "readonly", (store) => store.get("lastSync"),
    );
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export async function setLastSyncedAt(when: string): Promise<void> {
  await run(META, "readwrite", (store) => store.put({ key: "lastSync", value: when }));
}
