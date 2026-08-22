"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { markNotificationsReadAction } from "./actions";
import type { NotificationRow } from "./queries";
import { Bell, AlertTriangle, AlertCircle, Info, X } from "lucide-react";

const ICONS = {
  info: Info,
  warning: AlertTriangle,
  critical: AlertCircle,
} as const;

const TONE = {
  info: "text-info",
  warning: "text-caution",
  critical: "text-critical",
} as const;

/** "3 minutes ago" reads better than a timestamp on something this small. */
function ago(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 90) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * The bell.
 *
 * Standing conditions - low stock, money past due - are not stamped with
 * a time, because "3 days ago" on something that is still true reads as
 * stale news rather than as a live problem. Events get a time, because
 * for those it is the point.
 */
export function NotificationBell({
  notifications,
  unread,
}: {
  notifications: NotificationRow[];
  unread: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const markAll = () =>
    startTransition(async () => {
      await markNotificationsReadAction();
      router.refresh();
    });

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        className="relative grid size-11 place-items-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)] pointer-fine:size-9"
      >
        <Bell className="size-4" aria-hidden />
        {unread > 0 && (
          <span className="numeric absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-critical px-1 text-[10px] font-semibold leading-4 text-white pointer-fine:right-0.5 pointer-fine:top-0.5">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Tapping anywhere else closes it, which is what a phone user
              expects and what a mouse user tries first. */}
          <button
            type="button"
            aria-label="Close notifications"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-50 mt-1 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border-subtle)] bg-[var(--surface-raised)] shadow-lg">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-2.5">
              <p className="text-sm font-medium text-[var(--text-primary)]">Notifications</p>
              <div className="flex items-center gap-1">
                {unread > 0 && (
                  <button
                    type="button"
                    onClick={markAll}
                    disabled={pending}
                    className="rounded px-2 py-1 text-xs text-brand-700 hover:bg-[var(--surface-sunken)] disabled:opacity-50"
                  >
                    Mark all read
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setOpen(false)}
                  className="grid size-7 place-items-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </div>
            </div>

            {notifications.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">
                Nothing needs you right now.
              </p>
            ) : (
              <ul className="max-h-[24rem] divide-y divide-[var(--border-subtle)] overflow-y-auto">
                {notifications.map((n) => {
                  const Icon = ICONS[n.severity] ?? Info;
                  const body = (
                    <div className="flex gap-2.5 px-4 py-3">
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
                        {n.body && (
                          <p className="mt-0.5 text-xs text-[var(--text-muted)]">{n.body}</p>
                        )}
                        {/* A condition that is still true has no useful
                            age: it is not news from Tuesday, it is the
                            situation now. */}
                        {!n.standing && (
                          <p className="mt-1 text-xs text-[var(--text-muted)]">
                            {ago(n.createdAt)}
                          </p>
                        )}
                      </div>
                      {!n.readAt && (
                        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-600" aria-label="Unread" />
                      )}
                    </div>
                  );

                  return (
                    <li key={n.id}>
                      {n.link ? (
                        <Link
                          href={n.link}
                          onClick={() => setOpen(false)}
                          className="block hover:bg-[var(--surface-sunken)]"
                        >
                          {body}
                        </Link>
                      ) : (
                        body
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
