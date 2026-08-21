import "server-only";
import { createHmac, timingSafeEqual, randomInt } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { isValidPinFormat, isWeakPin, PIN_LENGTH } from "./pin";

/**
 * PIN verification and assignment.
 *
 * Everything here runs on the server with the service role, because it
 * must read credentials belonging to someone who is not yet signed in.
 * None of it is reachable from the browser.
 *
 * The PIN is reduced to an HMAC under PIN_PEPPER, a secret that lives
 * only in the server environment. A copy of the database is therefore
 * not enough to recover anyone's PIN: without the pepper the digest
 * cannot be reversed by trying all ten thousand values.
 */

export const MAX_FAILED_ATTEMPTS = 5;
export const COOLDOWN_MINUTES = 15;
export const ATTEMPT_WINDOW_MINUTES = 15;

/** Identical for every failure, so nothing can be learned from the wording. */
export const INCORRECT_PIN = "Incorrect PIN. Please try again.";

function pepper(): string {
  const value = process.env.PIN_PEPPER;
  if (!value || value.length < 32) {
    throw new Error(
      "PIN_PEPPER must be set to a random secret of at least 32 characters. " +
        "It is server-side only and must never carry a NEXT_PUBLIC_ prefix. " +
        "Generate one with: openssl rand -hex 32",
    );
  }
  return value;
}

/** Deterministic, so a PIN resolves in one indexed lookup. */
export function digestPin(pin: string): string {
  return createHmac("sha256", pepper()).update(pin).digest("hex");
}

export function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface AttemptContext {
  ip?: string | null;
  userAgent?: string | null;
}

export interface PinCheck {
  ok: boolean;
  message: string;
  profileId?: string;
  cooldownSeconds?: number;
}

/**
 * How long this caller must wait, if at all.
 *
 * Counted per address rather than per account, because a failed attempt
 * has no account: the PIN matched nobody. Successful sign-ins reset the
 * count so ordinary use never accumulates towards a lockout.
 */
async function cooldownRemaining(ip: string | null | undefined): Promise<number> {
  if (!ip) return 0;

  const admin = createSupabaseAdminClient();
  const windowStart = new Date(Date.now() - ATTEMPT_WINDOW_MINUTES * 60_000).toISOString();

  const { data } = await admin
    .from("auth_pin_attempts")
    .select("succeeded, attempted_at")
    .eq("request_ip", ip)
    .gte("attempted_at", windowStart)
    .order("attempted_at", { ascending: false })
    .limit(MAX_FAILED_ATTEMPTS + 1);

  const rows = data ?? [];
  let failures = 0;
  for (const row of rows) {
    if (row.succeeded) break; // A success clears what came before it.
    failures++;
  }

  if (failures < MAX_FAILED_ATTEMPTS) return 0;

  const newest = rows[0]?.attempted_at as string | undefined;
  if (!newest) return 0;
  const elapsed = Date.now() - new Date(newest).getTime();
  const remaining = COOLDOWN_MINUTES * 60_000 - elapsed;
  // Recovers on its own; nobody is locked out permanently by a few slips.
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

async function record(
  succeeded: boolean,
  context: AttemptContext,
  profileId?: string,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("auth_pin_attempts").insert({
    request_ip: context.ip ?? null,
    user_agent: context.userAgent ?? null,
    succeeded,
    profile_id: profileId ?? null,
  });
  if (error) console.error("[pin] could not record attempt", error);
}

/**
 * Check a PIN and, if it belongs to an active person, say who.
 *
 * Deliberately says the same thing for a PIN that matches nobody, a PIN
 * belonging to a deactivated account, and a PIN that is simply wrong.
 */
export async function checkPin(pin: string, context: AttemptContext = {}): Promise<PinCheck> {
  const waiting = await cooldownRemaining(context.ip);
  if (waiting > 0) {
    return {
      ok: false,
      message: `Too many incorrect attempts. Please try again in ${Math.ceil(waiting / 60)} minute(s).`,
      cooldownSeconds: waiting,
    };
  }

  if (!isValidPinFormat(pin)) {
    // Not recorded: a malformed entry is a typo, not a guess, and
    // counting it would let a clumsy user lock themselves out.
    return { ok: false, message: `Enter your ${PIN_LENGTH}-digit PIN.` };
  }

  const admin = createSupabaseAdminClient();
  const { data: profile, error } = await admin
    .from("profiles")
    .select("id, is_active")
    .eq("pin_hash", digestPin(pin))
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    // A fault here looks exactly like a wrong PIN to the person signing
    // in, which is right for them and useless for whoever has to fix it.
    // The reply stays generic; the reason goes to the log.
    console.error("[pin] could not look up the credential", error);
    return {
      ok: false,
      message: "Sign-in is temporarily unavailable. Please try again shortly.",
    };
  }

  if (!profile) {
    await record(false, context);
    return { ok: false, message: INCORRECT_PIN };
  }

  await record(true, context, profile.id as string);
  return { ok: true, message: "Verified.", profileId: profile.id as string };
}

export interface AssignResult {
  ok: boolean;
  message: string;
}

/**
 * Give a PIN to an account.
 *
 * Uniqueness is checked here for a clear message and enforced by a
 * unique index underneath, so two administrators acting at once cannot
 * both succeed.
 */
export async function assignPin(profileId: string, pin: string): Promise<AssignResult> {
  if (!isValidPinFormat(pin)) {
    return { ok: false, message: `A PIN must be exactly ${PIN_LENGTH} digits.` };
  }
  if (isWeakPin(pin)) {
    return { ok: false, message: "That PIN is too easy to guess. Please choose another." };
  }

  const admin = createSupabaseAdminClient();
  const digest = digestPin(pin);

  const { data: clash } = await admin
    .from("profiles")
    .select("id")
    .eq("pin_hash", digest)
    .eq("is_active", true)
    .maybeSingle();

  // Never says who holds it.
  if (clash && clash.id !== profileId) {
    return { ok: false, message: "This PIN is already assigned. Please choose another PIN." };
  }

  const { error } = await admin
    .from("profiles")
    .update({ pin_hash: digest })
    .eq("id", profileId);

  if (error) {
    if (error.code === "23505") {
      return { ok: false, message: "This PIN is already assigned. Please choose another PIN." };
    }
    console.error("[pin] could not assign", error);
    return { ok: false, message: "The PIN could not be saved. Please try again." };
  }

  return { ok: true, message: "PIN updated." };
}

/** A PIN an administrator can read out, avoiding the obvious ones. */
export async function suggestPin(): Promise<string> {
  const admin = createSupabaseAdminClient();
  for (let i = 0; i < 50; i++) {
    const candidate = String(randomInt(0, 10_000)).padStart(PIN_LENGTH, "0");
    if (isWeakPin(candidate)) continue;
    const { data } = await admin
      .from("profiles").select("id").eq("pin_hash", digestPin(candidate)).eq("is_active", true).maybeSingle();
    if (!data) return candidate;
  }
  throw new Error("Could not find an unused PIN. Too many active accounts for a four-digit space.");
}
