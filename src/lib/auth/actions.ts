"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { checkCredentials, assignPin, digestPin, INCORRECT_CREDENTIALS } from "./pin-server";
import { isValidPinFormat, PIN_LENGTH } from "./pin";
import { requireUser } from "./session";
import { recordAudit } from "@/lib/audit";

/**
 * Signing in, and changing a PIN.
 *
 * The browser sends a username and four digits. It never sends a user
 * id, an organization or a role, and nothing it sends is trusted for
 * authorization: the server resolves who the caller is from the stored
 * credential, and Supabase issues the session.
 */

/**
 * Shown when the fault is ours rather than theirs. Says nothing about
 * PostgREST, Supabase, JWTs or SQL: the person signing in can do nothing
 * with any of that, and an attacker can. The detail goes to the server
 * log instead.
 */
const SIGN_IN_UNAVAILABLE =
  "We couldn't complete your sign-in right now. Please try again shortly.";

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
  const username = String(formData.get("username") ?? "");
  const pin = String(formData.get("pin") ?? "").replace(/\D/g, "");
  const rawNext = String(formData.get("next") ?? "/");
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  const result = await checkCredentials(username, pin, await callerContext());

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

  // Belt and braces: checkCredentials already required an active account.
  if (!profile?.is_active || !profile.email) {
    return { status: "error", message: INCORRECT_CREDENTIALS };
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
    return { status: "error", message: SIGN_IN_UNAVAILABLE };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });

  if (error) {
    console.error("[auth] session redemption failed", error);
    return { status: "error", message: SIGN_IN_UNAVAILABLE };
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
  if (!result.ok) return { status: "error", message: result.message };

  // Recorded without either PIN: that a change happened is the fact
  // worth keeping, and the values never belong in a log.
  await recordAudit(user, {
    action: "user.pin_changed",
    targetType: "profile",
    targetId: user.id,
    targetLabel: user.fullName,
  });

  return { status: "done", message: "Your PIN has been changed." };
}

/**
 * Choosing a PIN for the first time, when the current one was issued by
 * somebody else.
 *
 * The current PIN is not asked for, and that is the point: it was handed
 * over by an administrator or printed in the setup notes, so requiring
 * it again proves nothing and only invites people to keep it.
 *
 * What makes this safe is that it refuses unless the caller's own
 * profile is flagged must_change_pin. An ordinary account cannot reach
 * this path to change its PIN without knowing the current one - that
 * still goes through changeOwnPinAction. The flag is set only by
 * bootstrap and by an administrator issuing a PIN, and assignPin clears
 * it, so this works exactly once per issued PIN.
 */
export async function setInitialPinAction(
  _prev: ChangePinState,
  formData: FormData,
): Promise<ChangePinState> {
  const user = await requireUser();

  const admin = createSupabaseAdminClient();
  const { data: profile } = await admin
    .from("profiles").select("must_change_pin, pin_hash").eq("id", user.id).maybeSingle();

  if (!profile?.must_change_pin) {
    // Already done, or never applied. Changing it now needs the current
    // PIN like anyone else's.
    return {
      status: "error",
      message: "Your PIN has already been set. Change it from your account page.",
    };
  }

  const next = String(formData.get("newPin") ?? "").replace(/\D/g, "");
  const confirm = String(formData.get("confirmPin") ?? "").replace(/\D/g, "");

  if (!isValidPinFormat(next)) {
    return { status: "error", message: `A PIN must be exactly ${PIN_LENGTH} digits.` };
  }
  if (next !== confirm) {
    return { status: "error", message: "The two PINs do not match." };
  }
  // Covers the bootstrap PIN, which isWeakPin refuses by name: the whole
  // exercise is pointless if the documented one can simply be kept.
  if (profile.pin_hash === digestPin(next)) {
    return {
      status: "error",
      message: "Please choose a PIN different from the one you were given.",
    };
  }

  const result = await assignPin(user.id, next);
  if (!result.ok) return { status: "error", message: result.message };

  await recordAudit(user, {
    action: "user.pin_changed",
    targetType: "profile",
    targetId: user.id,
    targetLabel: user.fullName,
    after: { first_use: true },
  });

  return { status: "done", message: "Your PIN has been set." };
}
