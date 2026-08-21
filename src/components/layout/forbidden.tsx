import Link from "next/link";
import { ShieldOff } from "lucide-react";
import { Card } from "@/components/ui/card";

/**
 * Shown when a signed-in user reaches something their role does not
 * cover. Deliberately says nothing about what the resource contains.
 */
export function Forbidden({
  message = "Your role does not include access to this area.",
}: {
  message?: string;
}) {
  return (
    <Card>
      <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
        <div className="mb-3 rounded-full bg-[var(--surface-sunken)] p-3">
          <ShieldOff className="size-5 text-[var(--text-muted)]" aria-hidden />
        </div>
        <p className="text-sm font-medium text-[var(--text-primary)]">Not available to you</p>
        <p className="mt-1 max-w-sm text-sm text-[var(--text-secondary)]">{message}</p>
        <p className="mt-4 text-xs text-[var(--text-muted)]">
          If you believe this is wrong, ask an administrator to review your role.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex h-11 items-center rounded-[var(--radius-panel)] border border-[var(--border-strong)] px-4 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-sunken)] pointer-fine:h-9"
        >
          Back to dashboard
        </Link>
      </div>
    </Card>
  );
}
