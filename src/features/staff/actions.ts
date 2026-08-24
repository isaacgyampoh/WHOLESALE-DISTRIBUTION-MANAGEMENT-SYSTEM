"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import { assignPin } from "@/lib/auth/pin-server";
import {
  isValidPinFormat, PIN_LENGTH, normaliseUsername, usernameProblem,
} from "@/lib/auth/pin";
import { recordAudit } from "@/lib/audit";
import { USER_ROLES, type UserRole } from "@/types/domain";
import type { AuthenticatedUser } from "@/types/domain";
import type { StaffActionState } from "./state";

/**
 * Administrative changes to staff.
 *
 * Every action here re-checks permission on the server, reads the target
 * under the actor's own organization, and records what happened. Nothing
 * trusts the browser for who is acting, which organization they belong
 * to, or what they are allowed to do: a hidden button is a courtesy, not
 * a control.
 */

/**
 * Fetch the target and confirm it belongs to the actor's organization.
 * A caller who supplies someone else's id gets the same answer as one
 * who supplies a nonsense id.
 */
async function loadTarget(actor: AuthenticatedUser, profileId: string) {
  if (!profileId) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("id, full_name, username, role, is_active, org_id, email")
    .eq("id", profileId)
    .maybeSingle();

  if (!data || data.org_id !== actor.organizationId) return null;
  return data;
}

export async function createStaffAction(
  _prev: StaffActionState,
  formData: FormData,
): Promise<StaffActionState> {
  const actor = await requirePermission("users.manage");

  const fullName = String(formData.get("fullName") ?? "").trim();
  const username = normaliseUsername(String(formData.get("username") ?? ""));
  const role = String(formData.get("role") ?? "") as UserRole;
  const pin = String(formData.get("pin") ?? "").replace(/\D/g, "");
  const confirm = String(formData.get("confirmPin") ?? "").replace(/\D/g, "");
  const phone = String(formData.get("phone") ?? "").trim();

  if (!fullName) return { status: "error", message: "Enter the staff member's full name." };

  const badUsername = usernameProblem(username);
  if (badUsername) return { status: "error", message: badUsername };

  if (!USER_ROLES.includes(role)) return { status: "error", message: "Choose a role." };
  if (!isValidPinFormat(pin)) {
    return { status: "error", message: `A PIN must be exactly ${PIN_LENGTH} digits.` };
  }
  if (pin !== confirm) return { status: "error", message: "The two PINs do not match." };

  // Only an administrator may hand out administrative roles. Without
  // this a user manager could create an account more powerful than
  // their own and sign in as it.
  if ((role === "admin" || role === "senior_manager") && actor.role !== "admin") {
    return {
      status: "error",
      message: "Only an administrator can create an administrator account.",
    };
  }

  const admin = createSupabaseAdminClient();

  // Checked here for a sentence worth reading; enforced underneath by
  // the unique index, so two administrators creating the same username
  // at once cannot both succeed.
  const { data: taken } = await admin
    .from("profiles").select("id").eq("username", username).maybeSingle();
  if (taken) {
    return { status: "error", message: `The username "${username}" is already taken.` };
  }

  // Supabase Auth identifies an account by email and the session depends
  // on one, so a stable internal address is minted. It is never used to
  // sign in and never shown.
  const handle = fullName.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "").slice(0, 24);
  const email = `${handle || "staff"}.${Date.now().toString(36)}@staff.internal`;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    // org_id here is what migration 0017 reads to mark the account
    // active. It comes from the server's view of the actor.
    user_metadata: { full_name: fullName, role, org_id: actor.organizationId, username },
  });

  if (createError || !created?.user) {
    console.error("[staff] could not create account", createError);
    return { status: "error", message: "The account could not be created. Please try again." };
  }

  const assigned = await assignPin(created.user.id, pin);
  if (!assigned.ok) {
    // Roll back rather than leave an account nobody can sign in to.
    await admin.auth.admin.deleteUser(created.user.id);
    return { status: "error", message: assigned.message };
  }

  // The PIN was chosen by the administrator creating this account, so
  // it is a way in rather than a credential: the application will let
  // this person do nothing but replace it. assignPin above cleared the
  // flag, so it is set after, not before.
  const { error: flagError } = await admin
    .from("profiles")
    .update({ must_change_pin: true, ...(phone ? { phone } : {}) })
    .eq("id", created.user.id);

  if (flagError) {
    console.error("[staff] could not flag the new PIN as provisional", flagError);
  }

  await recordAudit(actor, {
    action: "user.created",
    targetType: "profile",
    targetId: created.user.id,
    targetLabel: fullName,
    after: { full_name: fullName, username, role, is_active: true },
  });

  revalidatePath("/users");
  return {
    status: "done",
    message: "Staff created.",
    revealedPin: pin,
    staffName: fullName,
    username,
  };
}

export async function resetStaffPinAction(
  _prev: StaffActionState,
  formData: FormData,
): Promise<StaffActionState> {
  const actor = await requirePermission("users.manage");

  const profileId = String(formData.get("profileId") ?? "");
  const pin = String(formData.get("pin") ?? "").replace(/\D/g, "");
  const confirm = String(formData.get("confirmPin") ?? "").replace(/\D/g, "");

  if (pin !== confirm) return { status: "error", message: "The two PINs do not match." };

  const target = await loadTarget(actor, profileId);
  if (!target) return { status: "error", message: "That staff member could not be found." };

  const assigned = await assignPin(profileId, pin);
  if (!assigned.ok) return { status: "error", message: assigned.message };

  // Same reasoning as creating an account: a PIN read out by somebody
  // else gets this person through the door once.
  const { error: flagError } = await createSupabaseAdminClient()
    .from("profiles").update({ must_change_pin: true }).eq("id", profileId);
  if (flagError) console.error("[staff] could not flag the reset PIN as provisional", flagError);

  await recordAudit(actor, {
    action: "user.pin_reset",
    targetType: "profile",
    targetId: profileId,
    targetLabel: target.full_name as string,
  });

  revalidatePath("/users");
  revalidatePath(`/users/${profileId}`);
  return {
    status: "done",
    message: "PIN updated.",
    revealedPin: pin,
    staffName: (target.full_name as string) || "Staff member",
    username: (target.username as string) ?? undefined,
  };
}

export async function setStaffActiveAction(
  _prev: StaffActionState,
  formData: FormData,
): Promise<StaffActionState> {
  const actor = await requirePermission("users.manage");

  const profileId = String(formData.get("profileId") ?? "");
  const active = String(formData.get("active") ?? "") === "true";

  const target = await loadTarget(actor, profileId);
  if (!target) return { status: "error", message: "That staff member could not be found." };

  // Removing your own access leaves nobody able to undo it.
  if (profileId === actor.id && !active) {
    return { status: "error", message: "You cannot deactivate your own account." };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("profiles").update({ is_active: active }).eq("id", profileId);

  if (error) {
    console.error("[staff] could not change status", error);
    return { status: "error", message: "The change could not be saved. Please try again." };
  }

  // A deactivated account keeps a valid token until it expires, though
  // it can already reach nothing: auth_role() requires an active
  // profile. Ending the session makes that immediate.
  if (!active) {
    const { error: signOutError } = await admin.auth.admin.signOut(profileId);
    if (signOutError) console.error("[staff] could not end sessions", signOutError);
  }

  await recordAudit(actor, {
    action: active ? "user.activated" : "user.deactivated",
    targetType: "profile",
    targetId: profileId,
    targetLabel: target.full_name as string,
    before: { is_active: target.is_active },
    after: { is_active: active },
  });

  revalidatePath("/users");
  revalidatePath(`/users/${profileId}`);
  return { status: "done", message: active ? "Account activated." : "Account deactivated." };
}

export async function changeRoleAction(
  _prev: StaffActionState,
  formData: FormData,
): Promise<StaffActionState> {
  // A stronger requirement than users.manage: changing a role changes
  // what someone can do, so it belongs to whoever manages roles.
  const actor = await requirePermission("roles.manage");

  const profileId = String(formData.get("profileId") ?? "");
  const role = String(formData.get("role") ?? "") as UserRole;

  if (!USER_ROLES.includes(role)) return { status: "error", message: "Choose a valid role." };

  const target = await loadTarget(actor, profileId);
  if (!target) return { status: "error", message: "That staff member could not be found." };

  // Self-promotion is refused here and by guard_role_change underneath.
  if (profileId === actor.id && role !== actor.role) {
    return { status: "error", message: "You cannot change your own role." };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("profiles").update({ role }).eq("id", profileId);

  if (error) {
    console.error("[staff] could not change role", error);
    return { status: "error", message: "The role could not be changed. Please try again." };
  }

  await recordAudit(actor, {
    action: "user.role_changed",
    targetType: "profile",
    targetId: profileId,
    targetLabel: target.full_name as string,
    before: { role: target.role },
    after: { role },
  });

  revalidatePath("/users");
  revalidatePath(`/users/${profileId}`);
  return { status: "done", message: "Role updated." };
}

export async function setManagerCategoriesAction(
  _prev: StaffActionState,
  formData: FormData,
): Promise<StaffActionState> {
  const actor = await requirePermission("roles.manage");

  const profileId = String(formData.get("profileId") ?? "");
  const categoryIds = formData.getAll("categoryIds").map(String).filter(Boolean);

  const target = await loadTarget(actor, profileId);
  if (!target) return { status: "error", message: "That staff member could not be found." };

  // Widening your own product access is the same escalation as changing
  // your own role, and is refused for the same reason.
  if (profileId === actor.id) {
    return { status: "error", message: "You cannot change your own category access." };
  }

  const admin = createSupabaseAdminClient();

  const { data: existing } = await admin
    .from("manager_category_scopes")
    .select("category_id")
    .eq("profile_id", profileId);
  const before = (existing ?? []).map((r) => r.category_id as string);

  // Only categories belonging to the actor's organization are accepted,
  // whatever the form supplied.
  const { data: allowed } = await admin
    .from("categories").select("id").eq("org_id", actor.organizationId);
  const allowedIds = new Set((allowed ?? []).map((c) => c.id as string));
  const wanted = categoryIds.filter((id) => allowedIds.has(id));

  await admin.from("manager_category_scopes").delete().eq("profile_id", profileId);

  if (wanted.length) {
    const { error } = await admin.from("manager_category_scopes").insert(
      wanted.map((categoryId) => ({
        org_id: actor.organizationId,
        profile_id: profileId,
        category_id: categoryId,
        granted_by: actor.id,
      })),
    );
    if (error) {
      console.error("[staff] could not set categories", error);
      return { status: "error", message: "Category access could not be saved." };
    }
  }

  await recordAudit(actor, {
    action: "user.categories_changed",
    targetType: "profile",
    targetId: profileId,
    targetLabel: target.full_name as string,
    before: { categories: before.length },
    after: { categories: wanted.length },
  });

  revalidatePath(`/users/${profileId}`);
  return { status: "done", message: "Category access updated." };
}
