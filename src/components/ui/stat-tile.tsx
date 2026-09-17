import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";

/**
 * A single figure with its label. No sparklines or deltas until there is
 * real history to compute them from - an invented trend arrow is worse
 * than none.
 *
 * TONE AND EMPHASIS ARE DIFFERENT QUESTIONS
 *
 * `tone` colours the number: a receivable that is overdue prints amber
 * wherever it appears. `emphasis` paints the whole card, and is the
 * answer to a row of tiles that all look equally important because they
 * all look the same. A figure somebody is pleased to see and a figure
 * somebody has to act on today should not be two white boxes side by
 * side, and on a phone - where the row becomes a column eight tiles
 * long - they were.
 *
 * Used sparingly on purpose. One painted card leads a screen; three
 * painted cards lead nothing.
 */
export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
  emphasis = "plain",
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "positive" | "caution" | "critical";
  emphasis?: "plain" | "money" | "attention";
  href?: string;
}) {
  const painted = emphasis !== "plain";

  const accent = {
    neutral: "",
    positive: "text-positive",
    caution: "text-caution",
    critical: "text-critical",
  }[tone];

  const surface = {
    plain: "surface border border-[var(--border-subtle)] rounded-[var(--radius-card)]",
    money: "bg-[var(--surface-money)] text-[var(--on-money)] rounded-[var(--radius-card)]",
    attention: "bg-[var(--surface-attention)] text-[var(--on-attention)] rounded-[var(--radius-card)]",
  }[emphasis];

  const body = (
    <>
      <p className={cn(
        "text-[0.6875rem] font-medium tracking-wide uppercase sm:text-xs",
        // On a painted card the label rides the card's own colour. Left
        // as --text-muted it would be grey text on lime, which is the
        // one combination here that cannot be read.
        painted ? "opacity-80" : "text-[var(--text-muted)]",
      )}>
        {label}
      </p>
      <p
        className={cn(
          // Smaller on phones so a figure like GHS 108,500.00 still fits
          // a half-width card without truncating.
          "numeric mt-1.5 font-semibold tracking-tight sm:mt-2",
          painted ? "text-2xl sm:text-3xl" : "text-lg sm:text-2xl",
          painted ? "" : accent || "text-[var(--text-primary)]",
        )}
      >
        {value}
      </p>
      {sub && (
        <p className={cn(
          "mt-1 text-[0.6875rem] sm:text-xs",
          painted ? "opacity-80" : "text-[var(--text-secondary)]",
        )}>
          {sub}
        </p>
      )}
    </>
  );

  const className = cn(
    surface,
    "p-4 sm:p-5",
    href && (painted
      ? "transition-transform hover:-translate-y-0.5"
      : "transition-colors hover:border-[var(--border-strong)]"),
  );

  return href ? (
    <Link href={href} className={cn(className, "block")}>
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
