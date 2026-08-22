import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { PrintButton } from "./print-button";
import { ArrowLeft } from "lucide-react";

/**
 * The frame every printed document sits in.
 *
 * One component rather than three, because an invoice, a receipt and a
 * waybill from the same business should be recognisably the same
 * document. What differs is the title, the reference and the body.
 *
 * Printing goes through the browser's own dialog. That is deliberate:
 * it produces a PDF on every platform the business uses, needs no font
 * licence and no rendering service, and prints straight to the shop's
 * existing printer. The print rules live in globals.css.
 */
export function DocumentShell({
  title,
  reference,
  backHref,
  backLabel,
  meta,
  parties,
  status,
  children,
  footer,
}: {
  title: string;
  reference: string;
  backHref: string;
  backLabel: string;
  /** Dates and other short facts, printed under the reference. */
  meta: { label: string; value: string }[];
  /** Usually "From" and "To". */
  parties: { label: string; lines: (string | null)[] }[];
  status?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <>
      <div className="print-hide mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {backLabel}
        </Link>
        <div className="flex items-center gap-2">
          {status}
          <PrintButton />
        </div>
      </div>

      <article className="print-sheet mx-auto max-w-3xl surface rounded-lg border border-[var(--border-subtle)] p-6 sm:p-10">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-[var(--border-strong)] pb-6">
          <div>
            <p className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
              {BRAND.name}
            </p>
            <p className="mt-0.5 text-sm text-[var(--text-muted)]">{BRAND.tagline}</p>
          </div>
          <div className="text-right">
            <h1 className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
              {title}
            </h1>
            <p className="numeric mt-1 text-lg font-semibold text-[var(--text-primary)]">
              {reference}
            </p>
          </div>
        </header>

        <div className="grid gap-6 border-b border-[var(--border-subtle)] py-6 sm:grid-cols-2">
          {parties.map((party) => (
            <div key={party.label}>
              <p className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                {party.label}
              </p>
              <div className="mt-1.5 space-y-0.5">
                {party.lines.filter(Boolean).map((line, i) => (
                  <p
                    key={i}
                    className={
                      i === 0
                        ? "text-sm font-medium text-[var(--text-primary)]"
                        : "text-sm text-[var(--text-secondary)]"
                    }
                  >
                    {line}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>

        {meta.length > 0 && (
          <dl className="flex flex-wrap gap-x-10 gap-y-3 border-b border-[var(--border-subtle)] py-4">
            {meta.map((m) => (
              <div key={m.label}>
                <dt className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                  {m.label}
                </dt>
                <dd className="numeric mt-0.5 text-sm text-[var(--text-primary)]">{m.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {children}

        {footer && (
          <footer className="mt-8 border-t border-[var(--border-subtle)] pt-4 text-xs text-[var(--text-muted)]">
            {footer}
          </footer>
        )}
      </article>
    </>
  );
}

/** Line items, printed the same way on every document. */
export function DocumentTable({
  head,
  children,
}: {
  head: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full min-w-[32rem] text-sm">
        <thead>
          <tr className="border-b border-[var(--border-strong)] text-left">{head}</tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-subtle)]">{children}</tbody>
      </table>
    </div>
  );
}

/** The totals block, right-aligned under the lines. */
export function DocumentTotals({
  rows,
}: {
  rows: { label: string; value: string; emphasis?: boolean }[];
}) {
  return (
    <div className="mt-6 flex justify-end">
      <dl className="w-full max-w-xs space-y-1.5">
        {rows.map((row) => (
          <div
            key={row.label}
            className={
              row.emphasis
                ? "flex items-baseline justify-between gap-6 border-t border-[var(--border-strong)] pt-2"
                : "flex items-baseline justify-between gap-6"
            }
          >
            <dt
              className={
                row.emphasis
                  ? "text-sm font-semibold text-[var(--text-primary)]"
                  : "text-sm text-[var(--text-secondary)]"
              }
            >
              {row.label}
            </dt>
            <dd
              className={
                row.emphasis
                  ? "numeric text-base font-semibold text-[var(--text-primary)]"
                  : "numeric text-sm text-[var(--text-primary)]"
              }
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Where a person signs for the goods. Printed, never filled in on screen. */
export function SignatureBlock({ lines }: { lines: string[] }) {
  return (
    <div className="print-keep mt-10 grid gap-8 sm:grid-cols-2">
      {lines.map((label) => (
        <div key={label}>
          <div className="h-10 border-b border-[var(--border-strong)]" />
          <p className="mt-1.5 text-xs text-[var(--text-muted)]">{label}</p>
        </div>
      ))}
    </div>
  );
}
