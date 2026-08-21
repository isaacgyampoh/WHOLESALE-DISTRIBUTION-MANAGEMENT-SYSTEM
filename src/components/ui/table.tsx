import * as React from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Table primitives. Wide operational tables scroll inside their own
 * container so the page itself never scrolls sideways.
 */
export function TableWrap({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "surface overflow-x-auto rounded-[var(--radius-panel)] border border-[var(--border-subtle)]",
        className,
      )}
      {...props}
    />
  );
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full border-collapse text-sm", className)} {...props} />;
}

export function Th({
  className,
  numeric,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      className={cn(
        "border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)]",
        "px-4 py-2.5 text-xs font-semibold tracking-wide text-[var(--text-secondary)] uppercase",
        numeric ? "text-right" : "text-left",
        className,
      )}
      {...props}
    />
  );
}

export function Td({
  className,
  numeric,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        "border-b border-[var(--border-subtle)] px-4 py-3 text-[var(--text-primary)]",
        numeric && "numeric text-right",
        className,
      )}
      {...props}
    />
  );
}

export function Tr({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn("transition-colors hover:bg-[var(--surface-sunken)]/60", className)}
      {...props}
    />
  );
}
