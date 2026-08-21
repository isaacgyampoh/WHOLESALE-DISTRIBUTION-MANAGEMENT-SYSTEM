"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { NavIcon } from "./nav-icon";
import { primaryMobileItems, type NavSection, type NavItem } from "@/lib/navigation";

/**
 * Primary navigation on phones.
 *
 * A drawer alone means every move costs two taps. The four destinations
 * a role uses most sit on the bar; everything else is one tap away under
 * "More". Which four depends on the role, because navigation is filtered
 * by capability before it reaches here.
 *
 * The bar is fixed to the bottom and respects the home-indicator inset,
 * so it stays reachable one-handed - the posture a driver actually uses.
 */
export function BottomNav({ sections }: { sections: NavSection[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const primary: NavItem[] = primaryMobileItems(sections);
  const onBar = new Set(primary.map((i) => i.href));
  const rest = sections.flatMap((s) => s.items).filter((i) => !onBar.has(i.href));

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      <nav
        aria-label="Primary"
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 lg:hidden",
          "border-t border-[var(--border-subtle)] bg-[var(--surface-raised)]",
          "pb-[env(safe-area-inset-bottom)]",
        )}
      >
        <ul className="grid grid-cols-5">
          {primary.map((item) => {
            const active = isActive(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-14 flex-col items-center justify-center gap-0.5 text-[0.6875rem]",
                    active
                      ? "text-brand-700 dark:text-brand-300"
                      : "text-[var(--text-muted)]",
                  )}
                >
                  <NavIcon name={item.icon} className="size-5" />
                  <span className="max-w-full truncate px-1">{item.label}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="More navigation"
              aria-expanded={open}
              className="flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[0.6875rem] text-[var(--text-muted)]"
            >
              <MoreHorizontal className="size-5" aria-hidden />
              <span>More</span>
            </button>
          </li>
        </ul>
      </nav>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-ink-950/50"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            className={cn(
              "absolute inset-x-0 bottom-0 max-h-[75dvh] overflow-y-auto",
              "rounded-t-2xl border-t border-[var(--border-subtle)] bg-[var(--surface-raised)]",
              "pb-[env(safe-area-inset-bottom)]",
            )}
          >
            <div className="sticky top-0 flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--surface-raised)] px-4 py-3">
              <p className="text-sm font-semibold text-[var(--text-primary)]">All areas</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="grid size-11 place-items-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="px-3 py-3">
              {sections.map((section) => {
                const items = section.items.filter((i) => rest.includes(i));
                if (items.length === 0) return null;
                return (
                  <div key={section.label} className="mb-4">
                    <p className="px-2 pb-1.5 text-[0.6875rem] font-semibold tracking-wider text-[var(--text-muted)] uppercase">
                      {section.label}
                    </p>
                    <ul className="grid grid-cols-2 gap-1.5">
                      {items.map((item) => (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            onClick={() => setOpen(false)}
                            className={cn(
                              "flex min-h-12 items-center gap-2.5 rounded-lg px-3 py-2 text-sm",
                              isActive(item.href)
                                ? "bg-brand-50 font-medium text-brand-800 dark:bg-brand-950 dark:text-brand-200"
                                : "bg-[var(--surface-sunken)] text-[var(--text-secondary)]",
                            )}
                          >
                            <NavIcon name={item.icon} className="size-4 shrink-0" />
                            <span className="truncate">{item.label}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
