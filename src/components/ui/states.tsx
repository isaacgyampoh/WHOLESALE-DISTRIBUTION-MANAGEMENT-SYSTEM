import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { AlertTriangle, Inbox, RefreshCw, Info, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "./button";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-[var(--surface-sunken)]", className)}
      aria-hidden
    />
  );
}

/** Placeholder rows that match the table they stand in for. */
export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-[var(--border-subtle)]" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cn("h-4", c === 0 ? "w-1/4" : "flex-1")} />
          ))}
        </div>
      ))}
      <span className="sr-only">Loading</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 rounded-full bg-[var(--surface-sunken)] p-3">
        <Icon className="size-5 text-[var(--text-muted)]" />
      </div>
      <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-[var(--text-secondary)]">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * Error presentation. Takes the user-safe message only; technical detail
 * belongs in the server log, never on screen.
 */
export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 rounded-full bg-critical-soft p-3 dark:bg-critical/15">
        <AlertTriangle className="size-5 text-critical" />
      </div>
      <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-[var(--text-secondary)]">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw className="size-3.5" />
          Try again
        </Button>
      )}
    </div>
  );
}

const ALERT_TONES = {
  info: { cls: "border-info/25 bg-info-soft dark:bg-info/10", icon: Info, fg: "text-info" },
  success: {
    cls: "border-positive/25 bg-positive-soft dark:bg-positive/10",
    icon: CheckCircle2, fg: "text-positive",
  },
  warning: {
    cls: "border-caution/30 bg-caution-soft dark:bg-caution/10",
    icon: AlertTriangle, fg: "text-caution",
  },
  danger: {
    cls: "border-critical/25 bg-critical-soft dark:bg-critical/10",
    icon: XCircle, fg: "text-critical",
  },
} as const;

export function Alert({
  tone = "info",
  title,
  children,
}: {
  tone?: keyof typeof ALERT_TONES;
  title?: string;
  children: React.ReactNode;
}) {
  const { cls, icon: Icon, fg } = ALERT_TONES[tone];
  return (
    <div className={cn("flex gap-3 rounded-[var(--radius-panel)] border p-3.5", cls)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", fg)} aria-hidden />
      <div className="min-w-0 text-sm">
        {title && <p className="font-medium text-[var(--text-primary)]">{title}</p>}
        <div className="text-[var(--text-secondary)]">{children}</div>
      </div>
    </div>
  );
}
