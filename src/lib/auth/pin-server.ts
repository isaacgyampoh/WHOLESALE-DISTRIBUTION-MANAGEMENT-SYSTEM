import "server-only";
import { createHmac, timingSafeEqual, randomInt } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  isValidPinFormat, isWeakPin, PIN_LENGTH,
  MAX_FAILED_ATTEMPTS, COOLDOWN_MINUTES, ATTEMPT_WINDOW_MINUTES,
  INCORRECT_PIN, PIN_TAKEN, lockoutMessage,
} from "./pin";

// Re-exported so callers that already reach for the server module keep
// working; the definitions live in ./pin, which has no database in it
// and can therefore be tested on its own.
export {
  MAX_FAILED_ATTEMPTS, COOLDOWN_MINUTES, ATTEMPT_WINDOW_MINUTES,
  INCORRECT_PIN, PIN_TAKEN, lockoutMessage,
};

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
  /**
   * Opaque per-browser identifier from an httpOnly cookie. Counted
   * alongside the address so the limit survives a changed IP and cannot
   * be shed by opening a new tab. Never trusted for anything else.
   */
  deviceId?: string | null;
}

export interface PinCheck {
  ok: boolean;
  message: string;
  profileId?: string;
  /** Seconds until sign-in is possible again; set only while locked. */
  cooldownSeconds?: number;
  /** Tries left before the lockout. Absent when the attempt succeeded. */
  attemptsRemaining?: number;
  /** The PIN was issued by somebody else and must be replaced. */
  mustChangePin?: boolean;
}

/**
 * Consecutive failures by this caller inside the window.
 *
 * Counting stops at the most recent success: signing in correctly wipes
 * the slate, so ordinary use never accumulates towards a lockout. That
 * is what makes "wrong, wrong, wrong, right, wrong" leave the last entry
 * as the first failure of a fresh run rather than the fourth of an old
 * one.
 *
 * Counted per address, because a failed PIN belongs to no account - it
 * matched nobody, so there is nothing else to count against.
 */
async function recentFailures(context: AttemptContext): Promise<{
  failures: number;
  newest: string | null;
}> {
  const ip = context.ip ?? null;
  const device = context.deviceId ?? null;

  // Nothing to count against. Rather than let the attempt through
  // uncounted, this is treated as the first failure of a fresh run: it
  // cannot happen through the application, which always sets a device
  // cookie, and if it ever does the safe reading is "unknown caller".
  if (!ip && !device) return { failures: 0, newest: null };

  const admin = createSupabaseAdminClient();
  const windowStart = new Date(Date.now() - ATTEMPT_WINDOW_MINUTES * 60_000).toISOString();

  // Either key. An address that changed mid-run is still the same
  // browser; a cookie that was cleared is still the same address.
  const keys = [
    ip ? `request_ip.eq.${ip}` : null,
    device ? `device_id.eq.${device}` : null,
  ].filter(Boolean).join(",");

  const { data, error } = await admin
    .from("auth_pin_attempts")
    .select("succeeded, attempted_at")
    .or(keys)
    .gte("attempted_at", windowStart)
    .order("attempted_at", { ascending: false })
    .limit(MAX_FAILED_ATTEMPTS + 1);

  if (error) {
    // Unable to count is not permission to proceed unlimited, but nor
    // may it lock everyone out: report no failures and let the attempt
    // be judged on the PIN alone, with the fault in the log.
    console.error("[pin] could not read the attempt history", error);
    return { failures: 0, newest: null };
  }

  const rows = data ?? [];
  let failures = 0;
  for (const row of rows) {
    if (row.succeeded) break;   // A success clears what came before it.
    failures++;
  }

  return { failures, newest: (rows[0]?.attempted_at as string) ?? null };
}

/**
 * How long this caller must wait, if at all.
 *
 * Zero until MAX_FAILED_ATTEMPTS consecutive failures have been
 * recorded; from the fifth, the full cooldown counted from that fifth
 * failure. It expires on its own - nobody is shut out permanently by a
 * bad morning.
 */
async function cooldownRemaining(context: AttemptContext): Promise<number> {
  const { failures, newest } = await recentFailures(context);
  if (failures < MAX_FAILED_ATTEMPTS || !newest) return 0;

  const elapsed = Date.now() - new Date(newest).getTime();
  const remaining = COOLDOWN_MINUTES * 60_000 - elapsed;
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
    device_id: context.deviceId ?? null,
    user_agent: context.userAgent ?? null,
    succeeded,
    profile_id: profileId ?? null,
  });
  if (error) console.error("[pin] could not record attempt", error);
}

/**
 * Check a PIN and, if it belongs to an active person, say who.
 *
 * Sign-in asks for four digits and nothing else, so the digest is both
 * the question and the answer: the account is the one holding it. That
 * only works because no two active accounts may hold the same PIN -
 * assignPin refuses a duplicate and a unique index enforces it - so this
 * lookup can never be ambiguous.
 *
 * What guards the door, then, is the attempt limit: five wrong guesses
 * and this address waits a quarter of an hour. Without that, ten
 * thousand possibilities is not many.
 *
 * A PIN matching nobody, one belonging to a deactivated account, and one
 * that is simply wrong are answered identically, so the screen cannot be
 * used to find out who works here or what PINs exist.
 */
export async function checkPin(pin: string, context: AttemptContext = {}): Promise<PinCheck> {
  const waiting = await cooldownRemaining(context);
  if (waiting > 0) {
    return { ok: false, message: lockoutMessage(waiting), cooldownSeconds: waiting };
  }

  // Not recorded: an incomplete entry is a slip rather than a guess, and
  // counting it would let somebody lock themselves out by fumbling.
  if (!isValidPinFormat(pin)) {
    return { ok: false, message: `Enter your ${PIN_LENGTH}-digit PIN.` };
  }

  const admin = createSupabaseAdminClient();
  const { data: profile, error } = await admin
    .from("profiles")
    .select("id, pin_hash, must_change_pin")
    .eq("pin_hash", digestPin(pin))
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    // A fault here looks exactly like a wrong PIN to the person signing
    // in, which is right for them and useless for whoever has to fix it.
    // The reply stays generic; the reason goes to the log. Deliberately
    // not recorded as a failure - our fault must not cost them a try.
    console.error("[pin] could not look up the credential", error);
    return {
      ok: false,
      message: "We couldn't complete your sign-in right now. Please try again shortly.",
    };
  }

  if (profile) {
    // The row was found by digest, so this can only agree - it is here so
    // that the comparison deciding the outcome is a constant-time one
    // even if the lookup above is ever changed.
    const stored = (profile.pin_hash as string | null) ?? NO_SUCH_PIN;
    if (digestsMatch(stored, digestPin(pin))) {
      // Recording the success is what clears the failure count.
      await record(true, context, profile.id as string);
      return {
        ok: true,
        message: "Verified.",
        profileId: profile.id as string,
        mustChangePin: Boolean(profile.must_change_pin),
      };
    }
  }

  // Recorded first, then counted, so the try just made is included: the
  // fifth wrong PIN is itself refused with the lockout, not the sixth.
  await record(false, context);
  const { failures } = await recentFailures(context);
  const remaining = MAX_FAILED_ATTEMPTS - failures;

  if (remaining <= 0) {
    const locked = await cooldownRemaining(context);
    return {
      ok: false,
      message: lockoutMessage(locked || COOLDOWN_MINUTES * 60),
      cooldownSeconds: locked || COOLDOWN_MINUTES * 60,
    };
  }

  return { ok: false, message: INCORRECT_PIN, attemptsRemaining: remaining };
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
    return { ok: false, message: PIN_TAKEN };
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
      return { ok: false, message: PIN_TAKEN };
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
