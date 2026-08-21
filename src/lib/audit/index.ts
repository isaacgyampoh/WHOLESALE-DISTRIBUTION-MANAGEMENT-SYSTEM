import "server-only";
import { headers } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { AuthenticatedUser } from "@/types/domain";

/**
 * Recording administrative actions.
 *
 * Written with the service role because the log is not writable by
 * anyone else: an administrator may read history and may never author
 * it. The organization comes from the server's view of the actor, never
 * from the caller.
 *
 * Secrets are stripped again in the database, but the honest place to
 * keep them out is here, by never passing them.
 */

export type AuditAction =
  | "user.created"
  | "user.updated"
  | "user.activated"
  | "user.deactivated"
  | "user.role_changed"
  | "user.pin_reset"
  | "user.pin_changed"
  | "user.categories_changed";

export interface AuditEntry {
  action: AuditAction;
  targetType: "profile";
  targetId?: string;
  targetLabel?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

const NEVER_LOG = new Set([
  "pin", "pin_hash", "pin_salt", "password", "token", "secret", "code_hash",
]);

function scrub(input?: Record<string, unknown>): Record<string, unknown> | null {
  if (!input) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (NEVER_LOG.has(key)) continue;
    out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Never throws. A failure to record must not undo the action that was
 * already taken, but it must be visible to whoever runs the system.
 */
export async function recordAudit(actor: AuthenticatedUser, entry: AuditEntry): Promise<void> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for");

    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("audit_log").insert({
      org_id: actor.organizationId,
      actor_id: actor.id,
      actor_name: actor.fullName,
      actor_role: actor.role,
      action: entry.action,
      target_type: entry.targetType,
      target_id: entry.targetId ?? null,
      target_label: entry.targetLabel ?? null,
      before: scrub(entry.before),
      after: scrub(entry.after),
      request_ip: forwarded?.split(",")[0]?.trim() ?? null,
      user_agent: h.get("user-agent"),
    });

    if (error) console.error("[audit] could not record", entry.action, error);
  } catch (error) {
    console.error("[audit] could not record", entry.action, error);
  }
}
