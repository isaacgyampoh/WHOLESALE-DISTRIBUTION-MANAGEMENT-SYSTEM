"use client";

import { useEffect } from "react";

/**
 * Empties the offline caches when the sign-in screen is reached.
 *
 * The service worker caches whole rendered pages so a driver can open
 * their round with no signal. Those pages carry one person's data, and
 * a van's phone is handed between people. Reaching sign-in means the
 * previous session is over, which is the right moment to make sure the
 * next person cannot pull the last one's screens out of the cache.
 *
 * The queued operations in IndexedDB are deliberately left alone: work
 * that has not reached the office yet must survive a sign-out, and it
 * is re-authorised by the server when it finally uploads.
 */
export function ClearOfflineCaches() {
  useEffect(() => {
    if (!("caches" in window)) return;
    void caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key.startsWith("gab-shell")).map((key) => caches.delete(key)),
      ),
    ).catch(() => {});
  }, []);

  return null;
}
