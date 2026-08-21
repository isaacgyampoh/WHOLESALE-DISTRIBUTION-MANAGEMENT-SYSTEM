import * as React from "react";
import { cn } from "@/lib/utils/cn";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "surface rounded-[var(--radius-panel)] border border-[var(--border-subtle)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-4",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
        {description && (
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{description}</p>
        )}
      </div>
      {/* Actions here are usually small text links. The negative margin
          keeps them visually aligned while the padding gives them a
          touch-sized hit area. */}
      {action && (
        <div className="-m-2 shrink-0 [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_a]:px-2 lg:[&_a]:min-h-0 lg:[&_a]:py-0">
          {action}
        </div>
      )}
    </div>
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...props} />;
}
