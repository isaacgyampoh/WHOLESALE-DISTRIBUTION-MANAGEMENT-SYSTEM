"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { NavIcon } from "./nav-icon";
import { BrandMark } from "./sidebar";
import type { NavSection } from "@/lib/navigation";

/** Admin navigation on small screens. The driver PWA has its own shell. */
export function MobileNav({ sections }: { sections: NavSection[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="rounded-md p-2 text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] lg:hidden"
      >
        <Menu className="size-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-ink-950/50"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <nav
            aria-label="Main"
            className="absolute inset-y-0 left-0 flex w-72 flex-col bg-[var(--surface-raised)] shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pr-2">
              <div className="flex-1">
                <BrandMark />
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="rounded-md p-2 text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-4">
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
                            onClick={() => setOpen(false)}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                              "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm",
                              active
                                ? "bg-brand-50 font-medium text-brand-800 dark:bg-brand-950 dark:text-brand-200"
                                : "text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]",
                            )}
                          >
                            <NavIcon name={item.icon} className="size-4 shrink-0" />
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
        </div>
      )}
    </>
  );
}
