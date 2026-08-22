import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCapabilities } from "@/lib/db/capabilities";
import { type Result, failed } from "@/lib/query/result";

/**
 * What needs somebody.
 *
 * Reads are deliberately forgiving: this is a bell in the corner of
 * every screen, and a database that has not had upgrade 0028 should
 * leave the bell absent rather than take the page down with it. So a
 * failure here returns an empty list, not an error panel.
 */

export interface NotificationRow {
  id: string;
  kind: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string | null;
  link: string | null;
  standing: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface Inbox {
  notifications: NotificationRow[];
  unread: number;
  /** False when the database is behind; the bell is then not rendered. */
  available: boolean;
}

const EMPTY: Inbox = { notifications: [], unread: 0, available: false };

export async function getInbox(limit = 20): Promise<Inbox> {
  const { notifications: hasTable } = await getCapabilities();
  if (!hasTable) return EMPTY;

  const supabase = await createSupabaseServerClient();

  // Row level security decides what comes back: addressed to this
  // person, or to the job they hold. Nothing is filtered here.
  const { data, error } = await supabase
    .from("notifications")
    .select("id, kind, severity, title, body, link, standing, read_at, created_at")
    .is("resolved_at", null)
    .order("read_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[notifications]", error);
    return EMPTY;
  }

  const notifications = (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    kind: row.kind as string,
    severity: (row.severity as NotificationRow["severity"]) ?? "info",
    title: row.title as string,
    body: (row.body as string) ?? null,
    link: (row.link as string) ?? null,
    standing: Boolean(row.standing),
    readAt: (row.read_at as string) ?? null,
    createdAt: row.created_at as string,
  }));

  return {
    notifications,
    unread: notifications.filter((n) => !n.readAt).length,
    available: true,
  };
}

/**
 * Recompute the conditions - low stock, overdue money, goods still on
 * the road.
 *
 * Called from the dashboard rather than from a scheduled job. The
 * conditions are recomputed in place, so calling it on every dashboard
 * load produces the same single row per condition that calling it once a
 * day would, and the business does not have to install anything to make
 * notifications work.
 */
export async function refreshStandingAlerts(): Promise<void> {
  const { notifications: hasTable } = await getCapabilities();
  if (!hasTable) return;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("refresh_standing_alerts", { p_org: undefined });

  // Never fatal. A dashboard that cannot refresh its alerts is still a
  // dashboard; one that throws is not.
  if (error) console.error("[notifications] alerts could not be refreshed", error);
}

/** Everything unresolved, for the notifications screen. */
export async function listAllNotifications(): Promise<Result<NotificationRow[]>> {
  const { notifications: hasTable } = await getCapabilities();
  if (!hasTable) {
    return {
      ok: false,
      message:
        "Notifications need database upgrade 0028. " +
        "Run database/UPGRADE_0028_NOTIFICATIONS.sql, then reload.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("id, kind, severity, title, body, link, standing, read_at, created_at")
    .is("resolved_at", null)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return failed("notifications", error, "Notifications could not be loaded.");

  return {
    ok: true,
    data: (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      kind: row.kind as string,
      severity: (row.severity as NotificationRow["severity"]) ?? "info",
      title: row.title as string,
      body: (row.body as string) ?? null,
      link: (row.link as string) ?? null,
      standing: Boolean(row.standing),
      readAt: (row.read_at as string) ?? null,
      createdAt: row.created_at as string,
    })),
  };
}
