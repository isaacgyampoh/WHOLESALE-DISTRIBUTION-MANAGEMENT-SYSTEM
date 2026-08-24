/** Shared credential rules. Safe on the client: contains no secret. */
export const PIN_LENGTH = 4;

const PIN_PATTERN = /^\d{4}$/;

/** Exactly four digits. Not three, not five, nothing but digits. */
export function isValidPinFormat(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

/**
 * The PIN the first administrator is created with.
 *
 * Documented, and therefore public: it is written in the setup notes and
 * anyone reading this file can see it. That is deliberate and it is safe,
 * because it is never a credential for long. `production:bootstrap` is
 * the only thing that can assign it, it works only while the
 * installation has no administrator at all, and the account it creates
 * can do nothing except choose a real PIN - see must_change_pin in
 * migration 0039.
 *
 * It appears in TOO_OBVIOUS below so that nobody can then choose to keep
 * it.
 */
export const BOOTSTRAP_PIN = "1024";

/**
 * A handful of PINs are so common that allowing them undoes the point of
 * having one. Rejected when a PIN is chosen, never at sign-in - refusing
 * to accept a weak PIN at the door would tell an attacker which guesses
 * to skip.
 */
const TOO_OBVIOUS = new Set([
  "0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999",
  "1234", "4321", "0123", "1212", "2020", "2021", "2022", "2023", "2024", "2025",
  // The bootstrap PIN. Choosing it would leave the documented way in
  // open for as long as the account lasts.
  BOOTSTRAP_PIN,
]);

export function isWeakPin(pin: string): boolean {
  return TOO_OBVIOUS.has(pin);
}

// ------------------------------------------------------------------
// Usernames
// ------------------------------------------------------------------

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 24;

/**
 * Letters, digits, and a dot, hyphen or underscore between them.
 *
 * Deliberately narrow. A username is typed on a phone in a warehouse,
 * often by someone reading it off a slip of paper, so anything that
 * needs a shifted key or looks like something else is left out. It must
 * start and end with a letter or digit, which rules out the invisible
 * differences between `bea.`, `bea`, and `.bea`.
 */
const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

/** Lower-cased and trimmed. The column is citext, so this only tidies. */
export function normaliseUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function usernameProblem(raw: string): string | null {
  const name = normaliseUsername(raw);
  if (!name) return "Enter a username.";
  if (name.length < USERNAME_MIN) {
    return `A username must be at least ${USERNAME_MIN} characters.`;
  }
  if (name.length > USERNAME_MAX) {
    return `A username may be at most ${USERNAME_MAX} characters.`;
  }
  if (!USERNAME_PATTERN.test(name)) {
    return "Use letters and numbers, with dots, hyphens or underscores between them.";
  }
  return null;
}

/** A username suggested from a person's name; the server settles clashes. */
export function suggestUsername(fullName: string): string {
  const base = normaliseUsername(fullName)
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.{2,}/g, ".")
    .slice(0, USERNAME_MAX);
  return base.length >= USERNAME_MIN ? base : "";
}

// ------------------------------------------------------------------
// The attempt limit
// ------------------------------------------------------------------
//
// Here rather than in pin-server so the wording and the numbers can be
// tested without a database, and so the screen and the server cannot
// drift apart on what they promise. None of it is secret: an attacker
// discovers the limit by hitting it.

/** Wrong PINs allowed before the door closes. The fifth locks it. */
export const MAX_FAILED_ATTEMPTS = 5;

/** How long it stays closed. */
export const COOLDOWN_MINUTES = 15;

/** How far back failures are counted when deciding. */
export const ATTEMPT_WINDOW_MINUTES = 15;

/**
 * Identical for every failure: a PIN belonging to nobody, one belonging
 * to a deactivated account, and one that is simply wrong all say this,
 * so the screen cannot be used to find out which PINs exist.
 */
export const INCORRECT_PIN = "Incorrect PIN. Please try again.";

/**
 * Says that a PIN is taken, never by whom. Sign-in is by PIN alone, so
 * naming the holder would be handing over their credential.
 */
export const PIN_TAKEN = "That PIN is already in use. Please choose another PIN.";

/** How long is left, in words, naming nothing technical. */
export function lockoutMessage(secondsLeft: number): string {
  const minutes = Math.max(1, Math.ceil(secondsLeft / 60));
  return `Too many attempts. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

/** "3 attempts remaining", and "1 attempt remaining" when it is one. */
export function attemptsRemainingLabel(remaining: number): string {
  return remaining === 1 ? "1 attempt remaining" : `${remaining} attempts remaining`;
}
