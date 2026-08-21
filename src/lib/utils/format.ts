/**
 * Money and quantity formatting.
 *
 * Currency is per-organization (organizations.currency), so it is passed
 * in rather than assumed. Amounts arrive from PostgreSQL numeric columns
 * as strings to avoid float drift; parse at the edge, format here.
 */
export function parseAmount(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : Number.parseFloat(value);
}

export function formatMoney(
  value: string | number | null | undefined,
  currency = "GHS",
  locale = "en-GH",
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(parseAmount(value));
}

/** Signed money, for variances where direction is the point. */
export function formatSignedMoney(
  value: string | number | null | undefined,
  currency = "GHS",
): string {
  const n = parseAmount(value);
  const formatted = formatMoney(Math.abs(n), currency);
  if (n === 0) return formatted;
  return `${n > 0 ? "+" : "-"}${formatted}`;
}

export function formatQuantity(value: number | string | null | undefined): string {
  return new Intl.NumberFormat("en-GH").format(parseAmount(value));
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  }).format(d);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(d);
}
