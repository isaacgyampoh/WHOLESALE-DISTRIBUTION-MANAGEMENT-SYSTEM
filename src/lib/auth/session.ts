import "server-only";
import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppError } from "@/lib/errors/app-error";
import type { AuthenticatedUser, UserRole } from "@/types/domain";
import { can, canAny, type Permission } from "@/types/permissions";

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
  const supabase = await createSupabaseServerClient();

  // getUser revalidates the token with the auth server; getSession would
  // trust whatever is in the cookie.
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return null;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, org_id, is_active")
    .eq("id", auth.user.id)
    .single();

  if (error || !profile) return null;
  if (!profile.is_active) return null;

  return {
    id: profile.id as string,
    email: profile.email as string,
    fullName: (profile.full_name as string) || (profile.email as string),
    role: profile.role as UserRole,
    organizationId: profile.org_id as string,
    isActive: profile.is_active as boolean,
  };
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
