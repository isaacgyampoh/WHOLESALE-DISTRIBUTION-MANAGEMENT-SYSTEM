import "server-only";
import { createHmac, timingSafeEqual, randomInt } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { isValidPinFormat, isWeakPin, normaliseUsername, PIN_LENGTH } from "./pin";

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

/**
 * Identical for every failure, so nothing can be learned from the
 * wording: a username that does not exist, one that does with the wrong
 * PIN, and a deactivated account all say this.
 */
export const INCORRECT_CREDENTIALS = "Incorrect username or PIN. Please try again.";

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

/**
 * Stands in for the digest of an account that does not exist or has no
 * PIN set. A digest of a value nothing can produce, so it never matches;
 * the point is only that it is the right length.
 */
const NO_SUCH_PIN = "0".repeat(64);

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
  /** The PIN was issued by somebody else and must be replaced. */
  mustChangePin?: boolean;
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
 * Check a username and PIN, and if they belong to an active person, say
 * who.
 *
 * Before migration 0039 this looked the account up *by* the PIN digest,
 * which made four digits both the name and the proof: a lucky guess
 * landed on whoever happened to hold it, and no username was needed.
 * Now the username selects exactly one row and the PIN is compared
 * against that row alone.
 *
 * Every failure is reported identically. A wrong username, a wrong PIN
 * and a deactivated account are indistinguishable from outside, so the
 * screen cannot be used to find out who works here.
 */
export async function checkCredentials(
  username: string,
  pin: string,
  context: AttemptContext = {},
): Promise<PinCheck> {
  const waiting = await cooldownRemaining(context.ip);
  if (waiting > 0) {
    return {
      ok: false,
      message: `Too many incorrect attempts. Please try again in ${Math.ceil(waiting / 60)} minute(s).`,
      cooldownSeconds: waiting,
    };
  }

  const name = normaliseUsername(username);

  // Not recorded: an empty or malformed entry is a slip, not a guess,
  // and counting it would let someone lock themselves out by fumbling.
  if (!name) return { ok: false, message: "Enter your username." };
  if (!isValidPinFormat(pin)) {
    return { ok: false, message: `Enter your ${PIN_LENGTH}-digit PIN.` };
  }

  const admin = createSupabaseAdminClient();
  const { data: profile, error } = await admin
    .from("profiles")
    .select("id, pin_hash, is_active, must_change_pin")
    .eq("username", name)
    .maybeSingle();

  if (error) {
    // A fault here looks exactly like a wrong PIN to the person signing
    // in, which is right for them and useless for whoever has to fix it.
    // The reply stays generic; the reason goes to the log.
    console.error("[pin] could not look up the credential", error);
    return {
      ok: false,
      message: "We couldn't complete your sign-in right now. Please try again shortly.",
    };
  }

  // Compared even when there is no such account, and even when it holds
  // no PIN, so that an unknown username costs the same as a wrong PIN.
  // Without this, response time answers "does this person work here?"
  // on its own. NO_SUCH_PIN is the same length as a real digest, so the
  // comparison below is the same work either way.
  const supplied = digestPin(pin);
  const stored = (profile?.pin_hash as string | null) || NO_SUCH_PIN;
  const matches = digestsMatch(stored, supplied);

  if (!profile || !profile.is_active || !matches) {
    await record(false, context, profile?.id as string | undefined);
    return { ok: false, message: INCORRECT_CREDENTIALS };
  }

  await record(true, context, profile.id as string);
  return {
    ok: true,
    message: "Verified.",
    profileId: profile.id as string,
    mustChangePin: Boolean(profile.must_change_pin),
  };
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
    .update({
      pin_hash: digest,
      pin_set_at: new Date().toISOString(),
      // Whoever this belongs to has now chosen it themselves, so it is
      // a credential rather than a way in. Callers handing out a PIN on
      // somebody else's behalf set the flag again afterwards.
      must_change_pin: false,
    })
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
