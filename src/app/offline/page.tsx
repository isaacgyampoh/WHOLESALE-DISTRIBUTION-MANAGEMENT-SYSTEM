import type { Metadata } from "next";
import Link from "next/link";
import { CloudOff } from "lucide-react";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "Offline" };

/**
 * The shell the service worker serves when a navigation cannot reach
 * the network and nothing is cached for that address.
 *
 * Deliberately static: it must render with no session, no data and no
 * connection, which is exactly the moment a driver needs to be told
 * that their queued work is safe.
 */
export default function OfflinePage() {
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-[var(--surface-sunken)]">
          <CloudOff className="size-6 text-[var(--text-muted)]" aria-hidden />
        </div>
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">No connection</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          {BRAND.name} could not reach this screen. Anything you already
          recorded is still on this phone and will send by itself when the
          signal comes back.
        </p>
        <Link
          href="/driver"
          className="mt-6 inline-flex h-12 items-center rounded-[var(--radius-panel)] bg-brand-700 px-5 text-sm font-medium text-white"
        >
          Back to my round
        </Link>
      </div>
    </main>
  );
}
