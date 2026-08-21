import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/domain";

export interface StaffMember {
  id: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  hasPin: boolean;
  phone: string | null;
}

/**
 * Staff in the caller's organization.
 *
 * Read under the caller's own session, so row level security decides
 * what comes back: an administrator sees their organization and nobody
 * else's, whatever this query asks for.
 *
 * pin_hash is deliberately not selected. Nothing outside the server's
 * PIN module has any reason to see it.
 */
export type StaffResult =
  | { ok: true; staff: StaffMember[] }
  | { ok: false; message: string };

export async function listStaff(): Promise<StaffResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, is_active, phone, pin_set_at")
    .order("full_name", { ascending: true });

  if (error) {
    // An empty list and a failed query look identical on screen unless
    // they are kept apart. Reporting "no staff" when the query broke
    // sends an administrator looking for the wrong problem.
    console.error("[staff] could not list", error);
    return {
      ok: false,
      message:
        "The staff list could not be loaded. If this database has not yet had " +
        "the PIN upgrade applied, run database/UPGRADE_0018_PIN_AUTH.sql.",
    };
  }

  const staff = (data ?? []).map((row) => ({
    id: row.id as string,
    fullName: (row.full_name as string) || (row.email as string) || "Unnamed",
    role: row.role as UserRole,
    isActive: row.is_active as boolean,
    hasPin: Boolean(row.pin_set_at),
    phone: (row.phone as string | null) ?? null,
  }));

  return { ok: true, staff };
}
