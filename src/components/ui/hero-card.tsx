import * as React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * The one thing on the screen that is bigger than everything else.
 *
 * A dashboard of eight identical tiles makes the reader do the ranking:
 * every figure is the same size, in the same box, with the same border,
 * so the one that needs acting on today looks exactly like the one that
 * has not moved in a month. This is the answer to that - one card that
 * says what is happening right now, and nothing else allowed to look
 * like it.
 *
 * Painted rather than bordered. The colour is the hierarchy; if this
 * were another white card with another thin outline it would be back in
 * the row it is trying to lead.
 */
export function HeroCard({
  eyebrow,
  headline,
  detail,
  footer,
  href,
  hrefLabel,
  tone = "spotlight",
  className,
}: {
  /** The small pill above the headline: "Today", "This round". */
  eyebrow?: string;
  /** The sentence, not the number. Kept short enough to read at a glance. */
  headline: React.ReactNode;
  /** One line under it, for the qualifier the headline had to leave out. */
  detail?: React.ReactNode;
  /** Anything that belongs along the bottom - a progress strip, a face. */
  footer?: React.ReactNode;
  href?: string;
  hrefLabel?: string;
  tone?: "spotlight" | "money" | "attention";
  className?: string;
}) {
  const painted = {
    spotlight: "bg-[var(--surface-spotlight)] text-[var(--on-spotlight)]",
    money: "bg-[var(--surface-money)] text-[var(--on-money)]",
    attention: "bg-[var(--surface-attention)] text-[var(--on-attention)]",
  }[tone];

  const body = (
    <>
      {eyebrow && (
        <span className="inline-flex items-center rounded-full border border-current/30 px-3 py-1 text-xs font-medium opacity-90">
          {eyebrow}
        </span>
      )}
      <div className={cn("text-2xl font-semibold tracking-tight sm:text-3xl", eyebrow && "mt-4")}>
        {headline}
      </div>
      {detail && <div className="mt-2 text-sm opacity-85">{detail}</div>}
      {footer && <div className="mt-5">{footer}</div>}
    </>
  );

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[var(--radius-hero)] p-6 sm:p-7",
        painted,
        className,
      )}
    >
      {/*
        The curve. Purely decorative, drawn in the card's own foreground
        at low opacity so it cannot fight the words - and aria-hidden,
        because a screen reader has no use for a swoosh.
      */}
      <svg
        className="pointer-events-none absolute -top-8 right-0 h-48 w-64 opacity-20"
        viewBox="0 0 240 180" fill="none" aria-hidden
      >
        <path
          d="M240 8C188 8 196 96 140 108S52 84 0 172"
          stroke="currentColor" strokeWidth="3" strokeLinecap="round"
        />
      </svg>

      {/* The arrow sits above the curve and clear of the headline. */}
      {href && (
        <Link
          href={href}
          aria-label={hrefLabel ?? "Open"}
          className="absolute top-6 right-6 grid size-11 place-items-center rounded-full bg-white/95 text-ink-900 transition-transform hover:scale-105"
        >
          <ArrowUpRight className="size-5" aria-hidden />
        </Link>
      )}

      <div className={cn("relative", href && "pr-14")}>{body}</div>
    </div>
  );
}

/**
 * The strip along the bottom of a hero: one segment per thing, coloured
 * by whether it is done, waiting, or a problem.
 *
 * Twelve segments is the most that can be told apart at a glance; past
 * that it is a texture rather than a count, so it says the number
 * instead.
 */
export function HeroProgress({
  segments,
  label,
}: {
  segments: { tone: "done" | "waiting" | "problem"; title?: string }[];
  label?: string;
}) {
  const colour = {
    done: "bg-[var(--color-lime-400)]",
    waiting: "bg-white/25",
    problem: "bg-[var(--color-ember-400)]",
  };

  if (segments.length > 12) {
    const done = segments.filter((s) => s.tone === "done").length;
    const problem = segments.filter((s) => s.tone === "problem").length;
    return (
      <p className="numeric text-sm opacity-85">
        {done} of {segments.length} done{problem > 0 && `, ${problem} to sort out`}
      </p>
    );
  }

  return (
    // Capped, because a strip of two segments stretched across a
    // fifteen-hundred-pixel screen stops reading as a count of anything.
    <div className="flex max-w-md items-center gap-1.5" role="img"
         aria-label={label ?? `${segments.filter((s) => s.tone === "done").length} of ${segments.length} done`}>
      {segments.map((s, i) => (
        <span key={i} title={s.title}
              className={cn("h-1.5 flex-1 rounded-full", colour[s.tone])} />
      ))}
    </div>
  );
}
