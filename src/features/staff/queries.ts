import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/domain";

/**
 * Staff reads.
 *
 * Every query runs under the caller's own session, so row level security
 * decides what comes back. An administrator sees their organization and
 * nobody else's, whatever these queries ask for.
 *
 * pin_hash is never selected. Nothing outside the server's PIN module
 * has any reason to see it, and a column that is never read cannot leak.
 */

export interface StaffMember {
  id: string;
  fullName: string;
  username: string;
  role: UserRole;
  isActive: boolean;
  hasPin: boolean;
  phone: string | null;
  createdAt: string;
  updatedAt: string;
  pinSetAt: string | null;
  mustChangePin: boolean;
}

export interface StaffFilters {
  search?: string;
  role?: string;
  status?: string;
}

export type Result<T> = { ok: true; data: T } | { ok: false; message: string };

const FAILED =
  "The staff list could not be loaded. Please try again, and tell your " +
  "administrator if it keeps happening.";

function toStaff(row: Record<string, unknown>): StaffMember {
  return {
    id: row.id as string,
    fullName: (row.full_name as string) || "Unnamed",
    username: (row.username as string) ?? "",
    role: row.role as UserRole,
    isActive: row.is_active as boolean,
    hasPin: Boolean(row.pin_set_at),
    phone: (row.phone as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    pinSetAt: (row.pin_set_at as string | null) ?? null,
    // Signed in on a PIN somebody else chose, and has not yet replaced
    // it. Worth showing: it is the difference between "not set up" and
    // "set up and in use".
    mustChangePin: Boolean(row.must_change_pin),
  };
}

export async function listStaff(filters: StaffFilters = {}): Promise<Result<StaffMember[]>> {
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("profiles")
    .select("id, full_name, username, role, is_active, phone, created_at, updated_at, pin_set_at, must_change_pin")
    .order("full_name", { ascending: true });

  // Filtering happens in the database, so a large roster does not have
  // to cross the network to be narrowed.
  if (filters.role && filters.role !== "all") query = query.eq("role", filters.role);
  if (filters.status === "active") query = query.eq("is_active", true);
  if (filters.status === "inactive") query = query.eq("is_active", false);

  const search = filters.search?.trim();
  if (search) {
    // Escape the characters PostgREST treats as pattern syntax so a
    // search for "a,b" cannot become two conditions.
    const safe = search.replace(/[%,()]/g, " ");
    query = query.or(
      `full_name.ilike.%${safe}%,username.ilike.%${safe}%,phone.ilike.%${safe}%`);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[staff] list failed", error);
    return { ok: false, message: FAILED };
  }

  return { ok: true, data: (data ?? []).map(toStaff) };
}

export async function getStaffMember(id: string): Promise<Result<StaffMember | null>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, username, role, is_active, phone, created_at, updated_at, pin_set_at, must_change_pin")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[staff] detail failed", error);
    return { ok: false, message: FAILED };
  }
  return { ok: true, data: data ? toStaff(data) : null };
}

export interface CategoryOption {
  id: string;
  name: string;
  granted: boolean;
}

/**
 * Categories in the organization, with the ones this manager already
 * holds marked. Read under the caller's session, so an administrator
 * cannot enumerate another organization's categories.
 */
export async function getCategoryScopes(profileId: string): Promise<Result<CategoryOption[]>> {
  const supabase = await createSupabaseServerClient();

  const [categories, scopes] = await Promise.all([
    supabase.from("categories").select("id, name").order("name"),
    supabase.from("manager_category_scopes").select("category_id").eq("profile_id", profileId),
  ]);

  if (categories.error || scopes.error) {
    console.error("[staff] category scopes failed", categories.error ?? scopes.error);
    return { ok: false, message: "Category access could not be loaded." };
  }

  const granted = new Set((scopes.data ?? []).map((r) => r.category_id as string));
  return {
    ok: true,
    data: (categories.data ?? []).map((c) => ({
      id: c.id as string,
      name: c.name as string,
      granted: granted.has(c.id as string),
    })),
  };
}

export interface AuditRow {
  id: string;
  occurredAt: string;
  actorName: string;
  actorRole: string | null;
  action: string;
  targetLabel: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface AuditFilters {
  search?: string;
  action?: string;
  /** How far back to look, in days. Resolved here rather than during a
   *  component render, which must stay free of clock reads. */
  periodDays?: number;
}

export async function listAudit(filters: AuditFilters = {}, limit = 100): Promise<Result<AuditRow[]>> {
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("audit_log")
    .select("id, occurred_at, actor_name, actor_role, action, target_label, before, after")
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (filters.action && filters.action !== "all") query = query.eq("action", filters.action);
  if (filters.periodDays) {
    const since = new Date(Date.now() - filters.periodDays * 86_400_000).toISOString();
    query = query.gte("occurred_at", since);
  }

  const search = filters.search?.trim();
  if (search) {
    const safe = search.replace(/[%,()]/g, " ");
    query = query.or(`actor_name.ilike.%${safe}%,target_label.ilike.%${safe}%`);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[audit] list failed", error);
    return { ok: false, message: "The audit trail could not be loaded." };
  }

  return {
    ok: true,
    data: (data ?? []).map((r) => ({
      id: r.id as string,
      occurredAt: r.occurred_at as string,
      actorName: (r.actor_name as string) || "Unknown",
      actorRole: (r.actor_role as string | null) ?? null,
      action: r.action as string,
      targetLabel: (r.target_label as string | null) ?? null,
      before: (r.before as Record<string, unknown> | null) ?? null,
      after: (r.after as Record<string, unknown> | null) ?? null,
    })),
  };
}
