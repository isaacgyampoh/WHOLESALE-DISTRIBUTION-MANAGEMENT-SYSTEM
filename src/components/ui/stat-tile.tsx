import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";

/**
 * A single figure with its label. No sparklines or deltas until there is
 * real history to compute them from - an invented trend arrow is worse
 * than none.
 */
export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "positive" | "caution" | "critical";
  href?: string;
}) {
  const accent = {
    neutral: "",
    positive: "text-positive",
    caution: "text-caution",
    critical: "text-critical",
  }[tone];

  const body = (
    <>
      <p className="text-[0.6875rem] font-medium tracking-wide text-[var(--text-muted)] uppercase sm:text-xs">
        {label}
      </p>
      <p
        className={cn(
          // Smaller on phones so a figure like GHS 108,500.00 still fits
          // a half-width card without truncating.
          "numeric mt-1.5 text-lg font-semibold tracking-tight sm:mt-2 sm:text-2xl",
          accent || "text-[var(--text-primary)]",
        )}
      >
        {value}
      </p>
      {sub && (
        <p className="mt-1 text-[0.6875rem] text-[var(--text-secondary)] sm:text-xs">{sub}</p>
      )}
    </>
  );

  const className = cn(
    "surface rounded-[var(--radius-panel)] border border-[var(--border-subtle)] p-3 sm:p-4",
    href && "transition-colors hover:border-[var(--border-strong)]",
  );

  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** A row of tiles. Two across on a phone, four where there is room. */
export function StatGrid({ children }: { children: React.ReactNode }) {
  return <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">{children}</div>;
}
