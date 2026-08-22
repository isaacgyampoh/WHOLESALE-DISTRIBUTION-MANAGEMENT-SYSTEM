import Link from "next/link";
import { Download } from "lucide-react";

/**
 * Download a report as it is currently filtered.
 *
 * A plain link rather than a button with a fetch behind it: the browser
 * already knows how to save a file it was sent, and a link works with
 * middle-click, right-click and a keyboard. The route authorises the
 * request itself, so this being absent is presentation and not the
 * control.
 */
export function ExportLink({
  report,
  periodDays,
  label = "CSV",
}: {
  report: string;
  periodDays?: number;
  label?: string;
}) {
  const href = periodDays
    ? `/reports/export?report=${report}&period=${periodDays}`
    : `/reports/export?report=${report}`;

  return (
    <Link
      href={href}
      prefetch={false}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 hover:underline dark:text-brand-300"
    >
      <Download className="size-3.5" aria-hidden />
      {label}
      <span className="sr-only"> export of this report</span>
    </Link>
  );
}
