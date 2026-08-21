import * as React from "react";
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
      <p className="text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">
        {label}
      </p>
      <p className={cn("numeric mt-2 text-2xl font-semibold tracking-tight", accent || "text-[var(--text-primary)]")}>
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-[var(--text-secondary)]">{sub}</p>}
    </>
  );

  const className = cn(
    "surface rounded-[var(--radius-panel)] border border-[var(--border-subtle)] p-4",
    href && "transition-colors hover:border-[var(--border-strong)]",
  );

  return href ? (
    <a href={href} className={className}>
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  );
}
