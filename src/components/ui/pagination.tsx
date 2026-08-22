import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * Page links rather than buttons, so a page can be opened in a new tab
 * and the position survives a reload.
 */
export function Pagination({
  page, pageSize, total, params,
}: {
  page: number;
  pageSize: number;
  total: number;
  params: Record<string, string | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;

  const href = (target: number) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) next.set(k, v);
    if (target > 1) next.set("page", String(target));
    const qs = next.toString();
    return qs ? `?${qs}` : "?";
  };

  const link = "inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-panel)] border border-[var(--border-strong)] px-3 text-sm pointer-fine:min-h-9";
  const muted = "pointer-events-none opacity-40";

  return (
    <nav className="mt-4 flex items-center justify-between gap-3" aria-label="Pagination">
      <Link href={href(page - 1)} className={cn(link, page <= 1 && muted)} aria-disabled={page <= 1}>
        <ChevronLeft className="size-4" aria-hidden />
        Previous
      </Link>
      <p className="numeric text-sm text-[var(--text-secondary)]">
        Page {page} of {pages}
      </p>
      <Link href={href(page + 1)} className={cn(link, page >= pages && muted)} aria-disabled={page >= pages}>
        Next
        <ChevronRight className="size-4" aria-hidden />
      </Link>
    </nav>
  );
}
