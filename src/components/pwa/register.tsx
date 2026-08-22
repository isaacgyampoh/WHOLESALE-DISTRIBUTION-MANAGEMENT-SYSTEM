"use client";

import { useEffect } from "react";

/**
 * Registers the service worker.
 *
 * Registration is deliberately not conditional on the driver's role:
 * the worker only caches the shell and static assets, and a supervisor
 * on a phone in a warehouse basement benefits from the same thing. What
 * it never caches is a session or a Supabase response, so an installed
 * app cannot show one person's data to the next.
 *
 * Kept out of the layout's own module so the layout can stay a server
 * component.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // A worker registered over plain http on a phone is silently
    // ignored by the browser; localhost is the documented exception.
    const secure = window.isSecureContext || window.location.hostname === "localhost";
    if (!secure) return;

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((registration) => {
          // Take a new deploy on the next navigation rather than
          // leaving a driver on yesterday's shell for days.
          registration.addEventListener("updatefound", () => {
            const installing = registration.installing;
            if (!installing) return;
            installing.addEventListener("statechange", () => {
              if (installing.state === "installed" && navigator.serviceWorker.controller) {
                installing.postMessage({ type: "gab-skip-waiting" });
              }
            });
          });
        })
        .catch((error) => {
          // Not fatal: the application works online without it.
          console.warn("[pwa] service worker registration failed", error);
        });
    };

    // Registering after load keeps the worker's install off the
    // critical path for the first screen.
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
