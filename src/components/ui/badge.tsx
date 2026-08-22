import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { formatSignedMoney } from "@/lib/utils/format";
import type {
  OrderStatus, VanLoadStatus, ReconciliationStatus, InvoiceStatus,
} from "@/types/domain";

type Tone = "neutral" | "positive" | "caution" | "critical" | "info" | "brand";

const TONES: Record<Tone, string> = {
  neutral: "bg-[var(--surface-sunken)] text-[var(--text-secondary)] border-[var(--border-subtle)]",
  positive: "bg-positive-soft text-positive border-positive/25 dark:bg-positive/15",
  caution: "bg-caution-soft text-caution border-caution/30 dark:bg-caution/15",
  critical: "bg-critical-soft text-critical border-critical/25 dark:bg-critical/15",
  info: "bg-info-soft text-info border-info/25 dark:bg-info/15",
  brand: "bg-brand-50 text-brand-700 border-brand-200 dark:bg-brand-950 dark:text-brand-300 dark:border-brand-800",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5",
        "text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

/**
 * Status colour is load-bearing here: an operator scanning a list should
 * see a stuck reconciliation or an overdue invoice without reading. The
 * mapping is centralised so the same status never renders two ways.
 */
const STATUS_TONES: Record<string, Tone> = {
  // Order lifecycle
  draft: "neutral", confirmed: "info", picking: "info", packed: "info",
  shipped: "brand", delivered: "positive", cancelled: "critical",
  // Loads
  loaded: "info", dispatched: "brand", returned: "caution", reconciled: "positive",
  // Reconciliation
  submitted: "caution", approved: "positive", rejected: "critical", settled: "positive",
  // Invoices
  issued: "info", partially_paid: "caution", paid: "positive",
  overdue: "critical", void: "neutral",
  // Van sales and purchase orders
  completed: "positive", partially_received: "caution", received: "positive",
};

const LABELS: Record<string, string> = {
  partially_paid: "Partially paid",
  partially_received: "Partially received",
};

export function StatusBadge({
  status,
}: {
  status: OrderStatus | VanLoadStatus | ReconciliationStatus | InvoiceStatus | string;
}) {
  const label = LABELS[status] ?? status.charAt(0).toUpperCase() + status.slice(1);
  return <Badge tone={STATUS_TONES[status] ?? "neutral"}>{label}</Badge>;
}

/**
 * Variance reads by direction, not magnitude: short is critical, over is
 * a caution worth investigating, exact is settled.
 */
export function VarianceBadge({ value, currency = "GHS" }: { value: number; currency?: string }) {
  const tone: Tone = value === 0 ? "positive" : value < 0 ? "critical" : "caution";
  const label = value === 0 ? "Matched" : formatSignedMoney(value, currency);
  return (
    <Badge tone={tone} className="numeric">
      {label}
    </Badge>
  );
}
