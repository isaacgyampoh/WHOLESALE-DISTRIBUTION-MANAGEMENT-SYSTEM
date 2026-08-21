"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { checkPin, assignPin, digestPin, INCORRECT_PIN } from "./pin-server";
import { isValidPinFormat, PIN_LENGTH } from "./pin";
import { requirePermission, requireUser } from "./session";

/**
 * Signing in, and changing a PIN.
 *
 * The browser sends four digits and nothing else. It never sends a user
 * id, an organization or a role, and nothing it sends is trusted for
 * authorization: the server resolves who the caller is from the stored
 * credential, and Supabase issues the session.
 */

export interface SignInState {
  status: "idle" | "error";
  message?: string;
  cooldownSeconds?: number;
}

async function callerContext() {
  const h = await headers();
  // First entry of X-Forwarded-For is the client as the edge saw it.
  // Behind an untrusted proxy this can be spoofed, so it informs rate
  // limiting and never authorization.
  const forwarded = h.get("x-forwarded-for");
  return {
    ip: forwarded?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  };
}

export async function signInWithPinAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const pin = String(formData.get("pin") ?? "").replace(/\D/g, "");
  const rawNext = String(formData.get("next") ?? "/");
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  const result = await checkPin(pin, await callerContext());

  if (!result.ok || !result.profileId) {
    return {
      status: "error",
      message: result.message,
      cooldownSeconds: result.cooldownSeconds,
    };
  }

  const admin = createSupabaseAdminClient();
  const { data: profile } = await admin
    .from("profiles").select("email, is_active").eq("id", result.profileId).maybeSingle();

  // Belt and braces: checkPin already required an active account.
  if (!profile?.is_active || !profile.email) {
    return { status: "error", message: INCORRECT_PIN };
  }

  // Supabase issues the session. A single-use token is minted here and
  // redeemed immediately on the server, so it never crosses the network
  // to the browser. Nothing fabricates a session by hand.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: profile.email as string,
  });

  if (linkError || !link?.properties?.hashed_token) {
    console.error("[auth] could not mint a session token", linkError);
    return { status: "error", message: "Sign-in could not be completed. Please try again." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });

  if (error) {
    console.error("[auth] session redemption failed", error);
    return { status: "error", message: "Sign-in could not be completed. Please try again." };
  }

  // Where they land is decided by the shell from their role and
  // organization as the database reports them, not from anything here.
  redirect(next);
}

export interface ChangePinState {
  status: "idle" | "error" | "done";
  message?: string;
}

/** Changing your own PIN requires proving you know the current one. */
export async function changeOwnPinAction(
  _prev: ChangePinState,
  formData: FormData,
): Promise<ChangePinState> {
  const user = await requireUser();

  const current = String(formData.get("currentPin") ?? "").replace(/\D/g, "");
  const next = String(formData.get("newPin") ?? "").replace(/\D/g, "");
  const confirm = String(formData.get("confirmPin") ?? "").replace(/\D/g, "");

  if (!isValidPinFormat(next)) {
    return { status: "error", message: `A PIN must be exactly ${PIN_LENGTH} digits.` };
  }
  if (next !== confirm) {
    return { status: "error", message: "The two new PINs do not match." };
  }
  if (next === current) {
    return { status: "error", message: "The new PIN must be different from the current one." };
  }

  const admin = createSupabaseAdminClient();
  const { data: profile } = await admin
    .from("profiles").select("pin_hash").eq("id", user.id).maybeSingle();

  if (!profile?.pin_hash || profile.pin_hash !== digestPin(current)) {
    return { status: "error", message: "Your current PIN is not correct." };
  }

  const result = await assignPin(user.id, next);
  return result.ok
    ? { status: "done", message: "Your PIN has been changed." }
    : { status: "error", message: result.message };
}

export interface ResetPinState {
  status: "idle" | "error" | "done";
  message?: string;
  /** Shown to the administrator once, so they can pass it on. */
  assignedPin?: string;
  staffName?: string;
}

/** An administrator setting someone else's PIN. */
export async function resetStaffPinAction(
  _prev: ResetPinState,
  formData: FormData,
): Promise<ResetPinState> {
  const actor = await requirePermission("users.manage");

  const profileId = String(formData.get("profileId") ?? "");
  const pin = String(formData.get("pin") ?? "").replace(/\D/g, "");
  const confirm = String(formData.get("confirmPin") ?? "").replace(/\D/g, "");

  if (!profileId) return { status: "error", message: "No staff member was selected." };
  if (pin !== confirm) return { status: "error", message: "The two PINs do not match." };

  const admin = createSupabaseAdminClient();
  const { data: target } = await admin
    .from("profiles").select("id, full_name, org_id").eq("id", profileId).maybeSingle();

  // An administrator manages their own organization and no other. The
  // organization comes from the server's view of the actor, never from
  // the form.
  if (!target || target.org_id !== actor.organizationId) {
    return { status: "error", message: "That staff member could not be found." };
  }

  const result = await assignPin(profileId, pin);
  return result.ok
    ? {
        status: "done",
        message: "PIN updated.",
        assignedPin: pin,
        staffName: (target.full_name as string) || "Staff member",
      }
    : { status: "error", message: result.message };
}
