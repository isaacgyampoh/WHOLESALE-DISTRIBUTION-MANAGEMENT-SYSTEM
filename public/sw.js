/**
 * Service worker for the GAB Premium Ent driver app.
 *
 * The job here is narrow on purpose: keep the application shell
 * openable without a signal, and never serve a stale answer where a
 * fresh one matters. It does not queue mutations - that belongs to
 * IndexedDB and the sync engine in the page, which can re-derive
 * authorization from the live session. A service worker replaying a
 * POST it captured has no way to know the driver's role was revoked
 * while they were offline.
 *
 * Cache names carry a version. Bumping VERSION retires every previous
 * cache on the next activate, which is how a deploy takes effect
 * instead of a stale shell surviving forever.
 */
const VERSION = "v6";
const SHELL = `gab-shell-${VERSION}`;
const ASSETS = `gab-assets-${VERSION}`;

// The screens a driver reaches with no signal. Each is precached as a
// navigation fallback; the data they render comes from IndexedDB.
const SHELL_URLS = [
  "/offline",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) =>
      // One failing URL must not fail the whole install, or a single
      // renamed asset leaves the driver with no offline app at all.
      Promise.allSettled(SHELL_URLS.map((url) => cache.add(url))),
    ).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

/** Anything that must never be answered from a cache. */
function isNeverCached(url) {
  return (
    url.pathname.startsWith("/auth/") ||
    url.pathname.startsWith("/sign-in") ||
    url.pathname.startsWith("/api/") ||
    // Supabase: auth, and every read that could be stale in a way that
    // matters. The page caches what it needs itself, deliberately.
    url.hostname.endsWith(".supabase.co")
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin && !url.hostname.endsWith(".supabase.co")) return;
  if (isNeverCached(url)) return;

  // Navigations: try the network, fall back to the offline shell. A
  // driver who taps a screen in a dead spot gets the app, not the
  // browser's dinosaur.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(async () => {
          const cached =
            (await caches.match(request)) ??
            // Warmed entries are stored under the bare path, so a
            // navigation carrying a query string still finds one.
            (await caches.match(url.pathname));
          if (cached) return cached;
          const offline = await caches.match("/offline");
          return offline ?? new Response(
            "<!doctype html><meta charset=utf-8><title>Offline</title>" +
            "<body style='font-family:system-ui;padding:2rem'>" +
            "<h1>No connection</h1><p>Reopen the app when you have a signal.</p>",
            { headers: { "content-type": "text/html; charset=utf-8" }, status: 503 },
          );
        }),
    );
    return;
  }

  // The router's own data request.
  //
  // Next fetches an RSC payload for the route it is on. Offline that
  // fetch fails, the router falls back to a full browser navigation,
  // the worker answers that from cache, the router asks again - and the
  // app reloads in a loop that never settles. Caching the payload under
  // the same key it was warmed with breaks the cycle: the router gets
  // an answer, and stops.
  if (request.headers.get("RSC") === "1") {
    const key = `${url.origin}${url.pathname}__rsc`;
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL).then((cache) => cache.put(key, copy)).catch(() => {});
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(key);
          if (cached) return cached;
          // Nothing cached: an empty 204 stops the router retrying in a
          // loop, and the screen keeps whatever it already rendered.
          return new Response(null, { status: 204 });
        }),
    );
    return;
  }

  // Build output is content-hashed, so a hit is always correct and a
  // miss is worth caching for the next dead spot.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then((cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(ASSETS).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        }),
      ),
    );
  }
});

/**
 * Pull the build output a page references into the asset cache.
 *
 * Read off the HTML rather than guessed: the filenames are
 * content-hashed and change every deploy, so any hardcoded list would
 * be wrong by the next one.
 */
async function cacheAssetsFrom(response) {
  const html = await response.text();
  const urls = new Set();
  for (const match of html.matchAll(/"(\/_next\/static\/[^"']+?)"/g)) {
    urls.add(match[1].replace(/\\u002F/g, "/"));
  }
  for (const match of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) {
    urls.add(match[1]);
  }
  if (!urls.size) return;

  const cache = await caches.open(ASSETS);
  await Promise.all(
    [...urls].map(async (url) => {
      try {
        if (await cache.match(url)) return;
        const asset = await fetch(url, { credentials: "same-origin" });
        if (asset.ok) await cache.put(url, asset.clone());
      } catch {
        // One missing chunk should not fail the rest.
      }
    }),
  );
}

/**
 * Nudge the page to drain its queue when the browser says connectivity
 * is back. The page owns the queue; this only wakes it.
 */
self.addEventListener("sync", (event) => {
  if (event.tag === "gab-sync") {
    event.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true, type: "window" })
        .then((clients) => {
          for (const client of clients) client.postMessage({ type: "gab-sync-now" });
        }),
    );
  }
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "gab-skip-waiting") {
    self.skipWaiting();
    return;
  }

  // The page asks for the driver's screens to be put in the cache while
  // there is still a signal. It is done here rather than in the page
  // because a plain fetch() is not a navigation, so the handler above
  // would never store it - and because the cache name is versioned and
  // belongs to this file.
  if (event.data?.type === "gab-warm" && Array.isArray(event.data.routes)) {
    event.waitUntil(
      caches.open(SHELL).then((cache) =>
        // In parallel: warming ran sequentially before, and the worker
        // was being shut down partway through, leaving the last screens
        // uncached - which are exactly the ones a driver reaches at the
        // end of a round.
        Promise.all(
          event.data.routes.map(async (route) => {
            try {
              const response = await fetch(route, { credentials: "same-origin" });
              // Only a real page. A redirect to sign-in cached here
              // would send the driver to a login screen mid-round.
              if (response.ok && !response.redirected) {
                await cache.put(route, response.clone());
                // Cached HTML alone gives a page that cannot hydrate:
                // the scripts it references were never fetched, so
                // offline it renders once and stays inert - which for
                // the queue screen means showing "nothing recorded"
                // over a full queue. Pull them in too.
                await cacheAssetsFrom(response.clone());
              }
              // And the router's data for the same route, or the first
              // client-side navigation offline reloads the whole app.
              const rsc = await fetch(route, {
                credentials: "same-origin",
                headers: { RSC: "1" },
              });
              if (rsc.ok) {
                await cache.put(`${self.location.origin}${route}__rsc`, rsc.clone());
              }
            } catch {
              // No signal, or the route moved. The next run retries.
            }
          }),
        ),
      ),
    );
  }
});
