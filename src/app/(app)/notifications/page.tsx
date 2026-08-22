import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listAllNotifications, refreshStandingAlerts } from "@/features/notifications/queries";
import { MarkAllReadButton } from "@/features/notifications/mark-read-button";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { formatDateTime } from "@/lib/utils/format";
import { BellOff, AlertTriangle, AlertCircle, Info } from "lucide-react";

export const metadata: Metadata = { title: "Notifications" };

const ICONS = { info: Info, warning: AlertTriangle, critical: AlertCircle } as const;
const TONE = { info: "text-info", warning: "text-caution", critical: "text-critical" } as const;

/**
 * Everything addressed to this person or to their job.
 *
 * Split into what is still true and what has already happened, because
 * they need different things done to them: a condition ends when the
 * situation ends, and an event is dealt with and marked read.
 */
export default async function NotificationsPage() {
  await requireUser();
  await refreshStandingAlerts();

  const result = await listAllNotifications();

  if (!result.ok) {
    return (
      <>
        <PageHeader title="Notifications" description="What needs you." />
        <Card><ErrorState title="Notifications could not be loaded" message={result.message} /></Card>
      </>
    );
  }

  const standing = result.data.filter((n) => n.standing);
  const events = result.data.filter((n) => !n.standing);
  const unread = result.data.filter((n) => !n.readAt).length;

  const Row = ({ n }: { n: (typeof result.data)[number] }) => {
    const Icon = ICONS[n.severity] ?? Info;
    const body = (
      <div className="flex gap-3 px-5 py-3.5">
        <Icon className={`mt-0.5 size-4 shrink-0 ${TONE[n.severity]}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <p
            className={
              n.readAt
                ? "text-sm text-[var(--text-secondary)]"
                : "text-sm font-medium text-[var(--text-primary)]"
            }
          >
            {n.title}
          </p>
          {n.body && <p className="mt-0.5 text-sm text-[var(--text-muted)]">{n.body}</p>}
          {!n.standing && (
            <p className="numeric mt-1 text-xs text-[var(--text-muted)]">
              {formatDateTime(n.createdAt)}
            </p>
          )}
        </div>
        {!n.readAt && (
          <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-600" aria-label="Unread" />
        )}
      </div>
    );
    return (
      <li>
        {n.link ? (
          <Link href={n.link} className="block hover:bg-[var(--surface-sunken)]">{body}</Link>
        ) : (
          body
        )}
      </li>
    );
  };

  return (
    <>
      <PageHeader
        title="Notifications"
        description="What needs you, and what is still true until somebody deals with it."
        actions={unread > 0 ? <MarkAllReadButton /> : undefined}
      />

      {result.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={BellOff}
            title="Nothing needs you"
            description="Stock is above its reorder points, nothing is past due, and no work is waiting on approval."
          />
        </Card>
      ) : (
        <>
          {standing.length > 0 && (
            <Card className="overflow-hidden">
              <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-5 py-3">
                <h2 className="text-sm font-medium text-[var(--text-primary)]">
                  Still true right now
                </h2>
                <Badge tone="caution">{standing.length}</Badge>
              </div>
              <ul className="divide-y divide-[var(--border-subtle)]">
                {standing.map((n) => <Row key={n.id} n={n} />)}
              </ul>
              <p className="border-t border-[var(--border-subtle)] px-5 py-2.5 text-xs text-[var(--text-muted)]">
                These clear themselves when the situation ends. Marking one read does not make it
                go away.
              </p>
            </Card>
          )}

          {events.length > 0 && (
            <Card className="overflow-hidden">
              <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-5 py-3">
                <h2 className="text-sm font-medium text-[var(--text-primary)]">What happened</h2>
                <Badge tone="neutral">{events.length}</Badge>
              </div>
              <ul className="divide-y divide-[var(--border-subtle)]">
                {events.map((n) => <Row key={n.id} n={n} />)}
              </ul>
            </Card>
          )}
        </>
      )}
    </>
  );
}
