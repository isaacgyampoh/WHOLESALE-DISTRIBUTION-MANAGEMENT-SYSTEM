"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * A modal panel. Escape closes it, the background is inert while it is
 * open, and on a phone it sits at the bottom where a thumb reaches.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    // Stop the page behind from scrolling under the panel.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-ink-950/50" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "surface relative max-h-[90dvh] w-full overflow-y-auto border border-[var(--border-subtle)]",
          "rounded-t-2xl pb-[env(safe-area-inset-bottom)] sm:max-w-md sm:rounded-[var(--radius-panel)] sm:pb-0",
          className,
        )}
      >
        <div className="sticky top-0 flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)] px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
            {description && (
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-11 shrink-0 place-items-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] pointer-fine:size-8"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
