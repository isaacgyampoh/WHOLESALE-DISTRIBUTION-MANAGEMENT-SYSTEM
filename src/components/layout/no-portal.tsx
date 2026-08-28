import { BRAND } from "@/lib/brand";
import { Truck } from "lucide-react";

/**
 * What a driver sees if they sign in.
 *
 * Drivers have no portal: they drive, and the office records the van,
 * the load and the round on their behalf. Their account still exists
 * because vans, waybills, reports and the audit trail all name them.
 *
 * An empty shell would read as a fault - a person hunting for the screen
 * they were told about. This says plainly that there is nothing to do
 * here, which is the truth and takes ten seconds to understand.
 */
export function NoPortal({ name }: { name?: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="grid size-14 place-items-center rounded-2xl bg-[var(--surface-sunken)]">
        <Truck className="size-7 text-[var(--text-muted)]" aria-hidden />
      </div>

      <h1 className="mt-5 text-lg font-semibold text-[var(--text-primary)]">
        {name ? `${name}, there is nothing here for you` : "There is nothing here for you"}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
        Drivers do not use this application. Your van, its load and the
        round are all recorded by the office, and your name is on every
        one of those records.
      </p>
      <p className="mt-4 text-sm leading-relaxed text-[var(--text-secondary)]">
        If you need to know what is on your van, ask whoever loaded it.
      </p>

      <form action="/auth/sign-out" method="post" className="mt-8 w-full">
        <button
          type="submit"
          className="inline-flex h-12 w-full items-center justify-center rounded-[var(--radius-panel)] border border-[var(--border-strong)] px-4 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-sunken)]"
        >
          Sign out
        </button>
      </form>

      <p className="mt-8 text-xs text-[var(--text-muted)]">{BRAND.name}</p>
    </main>
  );
}
