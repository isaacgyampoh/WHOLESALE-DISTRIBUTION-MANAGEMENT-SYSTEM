"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { NavIcon } from "./nav-icon";
import type { NavSection } from "@/lib/navigation";
import { BRAND } from "@/lib/brand";

/**
 * Desktop navigation. Solid surface with a clear right edge rather than
 * a translucent panel: this sits beside dense tables all day and must not
 * compete with them or let content show through.
 */
export function Sidebar({ sections }: { sections: NavSection[] }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="flex h-full w-60 shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--surface-raised)]"
    >
      <BrandMark />
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {sections.map((section) => (
          <div key={section.label} className="mb-5">
            <p className="px-2.5 pb-1.5 text-[0.6875rem] font-semibold tracking-wider text-[var(--text-muted)] uppercase">
              {section.label}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active =
                  item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-11 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors pointer-fine:min-h-0 pointer-fine:py-1.5",
                        active
                          ? "bg-brand-50 font-medium text-brand-800 dark:bg-brand-950 dark:text-brand-200"
                          : "text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]",
                      )}
                    >
                      <NavIcon
                        name={item.icon}
                        className={cn("size-4 shrink-0", active && "text-brand-700 dark:text-brand-300")}
                      />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

export function BrandMark() {
  return (
    <div className="flex h-14 items-center gap-2.5 border-b border-[var(--border-subtle)] px-4">
      <div className="grid size-7 shrink-0 place-items-center rounded-md bg-brand-700 text-[0.625rem] font-bold tracking-tight text-white">
        {BRAND.initials}
      </div>
      <div className="min-w-0 leading-tight">
        <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{BRAND.name}</p>
        <p className="truncate text-[0.6875rem] text-[var(--text-muted)]">{BRAND.tagline}</p>
      </div>
    </div>
  );
}
