import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseAmount } from "@/lib/utils/format";

/**
 * The fleet, for whoever manages it.
 *
 * Crew comes from van_assignments, which is the one authoritative record
 * of who is on a van. There is no second table for salespeople: a row
 * carries the person and the seat they are in.
 */

export interface FleetCrew {
  assignmentId: string;
  profileId: string;
  name: string;
  crewRole: "driver" | "salesperson";
}

export interface FleetVan {
  id: string;
  code: string;
  registration: string;
  homeWarehouse: string | null;
  isActive: boolean;
  crew: FleetCrew[];
  lineCount: number;
  unitsOnBoard: number;
  stockValue: number;
  loadNumber: string | null;
  loadStatus: string | null;
}

export interface StaffOption {
  id: string;
  name: string;
  role: string;
  /** The van they are already on, if any: nobody crews two vans. */
  assignedVanCode: string | null;
}

export async function getFleet(): Promise<FleetVan[]> {
  const supabase = await createSupabaseServerClient();

  const [vans, crew, stock, loads] = await Promise.all([
    supabase
      .from("vans")
      .select("id, code, registration_no, is_active, warehouses!vans_home_warehouse_id_fkey(name)")
      .order("code"),
    supabase
      .from("van_assignments")
      .select("id, van_id, member_id, crew_role, profiles!van_assignments_member_id_fkey(full_name)")
      .is("unassigned_at", null),
    supabase.from("van_stock_summary").select("van_id, qty_on_hand, stock_value"),
    supabase
      .from("van_loads")
      .select("van_id, load_number, status")
      .in("status", ["loaded", "dispatched"]),
  ]);

  const crewByVan = new Map<string, FleetCrew[]>();
  for (const row of crew.data ?? []) {
    const list = crewByVan.get(row.van_id as string) ?? [];
    list.push({
      assignmentId: row.id as string,
      profileId: row.member_id as string,
      name: String(embedded(row.profiles)?.full_name ?? "Unnamed"),
      crewRole: (row.crew_role as "driver" | "salesperson") ?? "driver",
    });
    crewByVan.set(row.van_id as string, list);
  }

  const stockByVan = new Map<string, { lines: number; units: number; value: number }>();
  for (const row of stock.data ?? []) {
    const vanId = row.van_id as string;
    const current = stockByVan.get(vanId) ?? { lines: 0, units: 0, value: 0 };
    current.lines += 1;
    current.units += Number(row.qty_on_hand ?? 0);
    current.value += parseAmount(row.stock_value);
    stockByVan.set(vanId, current);
  }

  const loadByVan = new Map(
    (loads.data ?? []).map((l) => [
      l.van_id as string,
      { number: l.load_number as string, status: l.status as string },
    ]),
  );

  return (vans.data ?? []).map((v) => {
    const id = v.id as string;
    const totals = stockByVan.get(id);
    const load = loadByVan.get(id);
    return {
      id,
      code: v.code as string,
      registration: v.registration_no as string,
      homeWarehouse: (embedded(v.warehouses)?.name as string) ?? null,
      isActive: Boolean(v.is_active),
      crew: crewByVan.get(id) ?? [],
      lineCount: totals?.lines ?? 0,
      unitsOnBoard: totals?.units ?? 0,
      stockValue: totals?.value ?? 0,
      loadNumber: load?.number ?? null,
      loadStatus: load?.status ?? null,
    };
  });
}

/** People who can be crew: the drivers and the salespeople. */
export async function getCrewCandidates(): Promise<StaffOption[]> {
  const supabase = await createSupabaseServerClient();

  const [staff, assignments] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, role")
      .in("role", ["driver", "sales_rep"])
      .eq("is_active", true)
      .order("full_name"),
    supabase
      .from("van_assignments")
      .select("member_id, vans!van_assignments_van_id_fkey(code)")
      .is("unassigned_at", null),
  ]);

  const onVan = new Map(
    (assignments.data ?? []).map((a) => [
      a.member_id as string,
      String(embedded(a.vans)?.code ?? ""),
    ]),
  );

  return (staff.data ?? []).map((p) => ({
    id: p.id as string,
    name: (p.full_name as string) || "Unnamed",
    role: p.role as string,
    assignedVanCode: onVan.get(p.id as string) ?? null,
  }));
}

function embedded(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
}
