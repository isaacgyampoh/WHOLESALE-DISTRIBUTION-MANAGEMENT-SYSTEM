import { cn } from "@/lib/utils/cn";
import { BRAND } from "@/lib/brand";

/**
 * The company mark, for pages that stand outside the application shell:
 * sign-in, the pending screen, not-found. Without it those pages read as
 * a stray card rather than part of the product.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="grid size-8 shrink-0 place-items-center rounded-md bg-brand-700 text-xs font-bold tracking-tight text-white">
        {BRAND.initials}
      </div>
      <span className="font-semibold text-[var(--text-primary)]">{BRAND.name}</span>
    </div>
  );
}
