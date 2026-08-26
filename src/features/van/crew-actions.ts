"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { toAppError } from "@/lib/errors/app-error";

/**
 * Putting people on a van and taking them off.
 *
 * A crew row is what makes a driver responsible for a van and what lets
 * a salesperson sell from it, so this is a managed act: RLS refuses the
 * write to anyone below manager, and refuses a driver assigning
 * themselves outright.
 *
 * The database holds two rules this code does not have to repeat: one
 * active driver per van, and nobody crewed on two vans at once. Both are
 * unique indexes, so two managers acting at the same moment cannot slip
 * a second driver through between the check and the write.
 */

export interface CrewActionState {
  status: "idle" | "error" | "done";
  message?: string;
}

export const INITIAL_CREW_STATE: CrewActionState = { status: "idle" };

export async function assignCrewAction(
  _prev: CrewActionState,
  formData: FormData,
): Promise<CrewActionState> {
  const actor = await requirePermission("vans.manage");

  const vanId = String(formData.get("vanId") ?? "").trim();
  const memberId = String(formData.get("memberId") ?? "").trim();
  const crewRole = String(formData.get("crewRole") ?? "").trim();

  if (!vanId || !memberId) return { status: "error", message: "Choose someone to assign." };
  if (crewRole !== "driver" && crewRole !== "salesperson") {
    return { status: "error", message: "Choose whether they drive or sell." };
  }

  const supabase = await createSupabaseServerClient();

  const { data: member } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", memberId)
    .maybeSingle();

  if (!member) {
    return { status: "error", message: "That person could not be found." };
  }

  // The seat has to match the job. A driver in the salesperson's seat
  // would be handed the ability to sell, which is the whole thing this
  // change exists to prevent.
  if (crewRole === "driver" && member.role !== "driver") {
    return { status: "error", message: `${member.full_name} is not a driver.` };
  }
  if (crewRole === "salesperson" && member.role !== "sales_rep") {
    return { status: "error", message: `${member.full_name} is not a salesperson.` };
  }

  const { error } = await supabase.from("van_assignments").insert({
    van_id: vanId,
    member_id: memberId,
    crew_role: crewRole,
    assigned_by: actor.id,
  });

  if (error) {
    console.error("[fleet] could not assign crew", error);
    // The unique indexes surface as a conflict; say which rule was hit.
    const message =
      error.code === "23505"
        ? crewRole === "driver"
          ? "That van already has a driver, or that person is already on another van."
          : "That person is already crewed on a van. Take them off it first."
        : toAppError(error).userMessage;
    return { status: "error", message };
  }

  await recordAudit(actor, {
    action: "van.crew_assigned",
    targetType: "van",
    targetId: vanId,
    targetLabel: String(formData.get("vanLabel") ?? vanId),
    after: { member: member.full_name, crew_role: crewRole },
  });

  revalidatePath("/vans");
  revalidatePath("/my-van");
  return { status: "done", message: `${member.full_name} assigned.` };
}

export async function removeCrewAction(
  _prev: CrewActionState,
  formData: FormData,
): Promise<CrewActionState> {
  const actor = await requirePermission("vans.manage");

  const assignmentId = String(formData.get("assignmentId") ?? "").trim();
  if (!assignmentId) return { status: "error", message: "That assignment could not be found." };

  const supabase = await createSupabaseServerClient();

  // Closed, not deleted: who was on which van last Tuesday is part of
  // the record, and a reconciliation months later still needs it.
  const { data, error } = await supabase
    .from("van_assignments")
    .update({ unassigned_at: new Date().toISOString() })
    .eq("id", assignmentId)
    .is("unassigned_at", null)
    .select("van_id, member_id, crew_role")
    .maybeSingle();

  if (error || !data) {
    console.error("[fleet] could not remove crew", error);
    return {
      status: "error",
      message: error
        ? toAppError(error).userMessage
        : "That assignment has already ended.",
    };
  }

  await recordAudit(actor, {
    action: "van.crew_removed",
    targetType: "van",
    targetId: data.van_id as string,
    targetLabel: String(formData.get("vanLabel") ?? data.van_id),
    before: { crew_role: data.crew_role },
  });

  revalidatePath("/vans");
  revalidatePath("/my-van");
  return { status: "done", message: "Taken off the van." };
}
