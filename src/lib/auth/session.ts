import "server-only";
import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppError } from "@/lib/errors/app-error";
import type { AuthenticatedUser, UserRole } from "@/types/domain";
import { can, canAny, type Permission } from "@/types/permissions";

/**
 * Three states, not two.
 *
 * "anonymous" has no session at all and belongs at the sign-in page.
 * "pending" holds a valid session but no active profile: a self-
 * registered account that an administrator has not activated. Sending
 * that user to sign-in would bounce them straight back, because the
 * proxy sees a valid session and returns them to the application.
 */
export type SessionState =
  | { status: "anonymous" }
  | { status: "pending"; email: string | null }
  | { status: "active"; user: AuthenticatedUser; mustChangePin: boolean };

export const getSessionState = cache(async (): Promise<SessionState> => {
  const supabase = await createSupabaseServerClient();

  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return { status: "anonymous" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, org_id, is_active, must_change_pin")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (!profile || !profile.is_active) {
    return { status: "pending", email: auth.user.email ?? null };
  }

  return {
    status: "active",
    // The PIN was issued by somebody else - bootstrap, or an
    // administrator creating this account or resetting it - so it is a
    // way in rather than a credential. The shell sends this person to
    // choose their own before anything else. See migration 0039.
    mustChangePin: Boolean(profile.must_change_pin),
    user: {
      id: profile.id as string,
      email: (profile.email as string) ?? auth.user.email ?? "",
      fullName: (profile.full_name as string) || (profile.email as string) || "",
      role: profile.role as UserRole,
      organizationId: profile.org_id as string,
      isActive: true,
    },
  };
});

/**
 * Who is calling, according to the server.
 *
 * The organization and role come from the profiles table, read under the
 * caller's own session, never from anything the browser supplied. This is
 * the only place the application decides who someone is.
 *
 * Wrapped in React's cache so a render tree resolves it once per request.
 */
export const getCurrentUser = cache(async (): Promise<AuthenticatedUser | null> => {
  const state = await getSessionState();
  return state.status === "active" ? state.user : null;
});

/** Current user or an error; for code paths that cannot proceed anonymously. */
export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new AppError("unauthenticated", "Please sign in to continue.");
  }
  return user;
}

/**
 * Assert a capability before performing an action.
 *
 * This is a guard, not the security boundary. The database enforces the
 * same rules independently; this exists so the application fails early
 * with a clear message instead of relying on a policy rejection.
 */
export async function requirePermission(permission: Permission): Promise<AuthenticatedUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) {
    throw new AppError("forbidden", "You do not have permission to do that.");
  }
  return user;
}

export async function requireAnyPermission(
  permissions: readonly Permission[],
): Promise<AuthenticatedUser> {
  const user = await requireUser();
  if (!canAny(user.role, permissions)) {
    throw new AppError("forbidden", "You do not have permission to do that.");
  }
  return user;
}
