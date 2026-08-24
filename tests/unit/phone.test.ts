import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalisePhone, maskPhone, phoneHint } from "../../src/lib/auth/phone.ts";
import {
  isValidPinFormat, isWeakPin, BOOTSTRAP_PIN,
  usernameProblem, normaliseUsername, suggestUsername,
} from "../../src/lib/auth/pin.ts";
import {
  MAX_FAILED_ATTEMPTS, COOLDOWN_MINUTES, lockoutMessage, INCORRECT_PIN, PIN_TAKEN,
} from "../../src/lib/auth/pin.ts";

test("local Ghana numbers become international", () => {
  assert.equal(normalisePhone("0241110000"), "+233241110000");
  assert.equal(normalisePhone("024 111 0000"), "+233241110000");
  assert.equal(normalisePhone("024-111-0000"), "+233241110000");
});

test("numbers already in international form are kept", () => {
  assert.equal(normalisePhone("+233241110000"), "+233241110000");
  assert.equal(normalisePhone("+233 24 111 0000"), "+233241110000");
  assert.equal(normalisePhone("+44 7700 900123"), "+447700900123");
});

test("the same number in different spellings normalises to one value", () => {
  const forms = ["0241110000", "+233241110000", "233241110000", "024 111 0000"];
  const normalised = new Set(forms.map(normalisePhone));
  assert.equal(normalised.size, 1, `got ${[...normalised].join(", ")}`);
});

test("nonsense is rejected rather than mangled", () => {
  assert.equal(normalisePhone(""), null);
  assert.equal(normalisePhone("   "), null);
  assert.equal(normalisePhone("12"), null);
  assert.equal(normalisePhone("abc"), null);
});

test("only the last four digits are ever shown", () => {
  const masked = maskPhone("+233241110000");
  assert.match(masked, /0000$/);
  assert.ok(!masked.includes("233"), `masked value leaked the prefix: ${masked}`);
  assert.ok(!masked.includes("24111"), `masked value leaked the body: ${masked}`);
  assert.equal(phoneHint("+233241110000"), "0000");
});

test("a PIN must be exactly four digits", () => {
  for (const good of ["1024", "4837", "0007", "9999"]) {  // format only, not strength
    assert.ok(isValidPinFormat(good), `${good} should be accepted`);
  }
  for (const bad of ["12345", "123456", "abc1", "12", "", "1 24", "12.4", "١٢٣٤"]) {
    assert.ok(!isValidPinFormat(bad), `${bad} should be rejected`);
  }
});

test("the most guessable PINs are refused when one is chosen", () => {
  for (const weak of ["0000", "1111", "1234", "4321", "2024"]) {
    assert.ok(isWeakPin(weak), `${weak} should count as weak`);
  }
  for (const fine of ["4837", "7291", "5610"]) {
    assert.ok(!isWeakPin(fine), `${fine} should be allowed`);
  }
});

/**
 * The bootstrap PIN is a documented value - it is printed in the setup
 * notes and written in the source - so it lets the first administrator
 * in and must not survive that. It is a well-formed PIN, and it is
 * refused as a *choice*: bootstrap writes its digest directly, while
 * every path a person chooses a PIN through goes past isWeakPin.
 *
 * This test previously asserted the opposite, from when 1024 was just an
 * example of an unremarkable PIN and nothing depended on it.
 */
test("the bootstrap PIN cannot be kept as a permanent one", () => {
  assert.ok(isValidPinFormat(BOOTSTRAP_PIN), "it has to be typeable at sign-in");
  assert.ok(isWeakPin(BOOTSTRAP_PIN), "nobody may choose the documented way in");
});

test("the bootstrap PIN in the setup script matches the application", () => {
  // scripts/production/bootstrap.mjs cannot import TypeScript, so it
  // carries its own copy. If the two drift, bootstrap writes a PIN the
  // sign-in screen will not honour and nobody can get in at all.
  const script = readFileSync(
    new URL("../../scripts/production/bootstrap.mjs", import.meta.url), "utf8");
  const declared = script.match(/const BOOTSTRAP_PIN = "(\d{4})"/)?.[1];
  assert.equal(declared, BOOTSTRAP_PIN);
});

// ------------------------------------------------------------------
// Usernames
// ------------------------------------------------------------------

test("a username is lower-cased and trimmed", () => {
  assert.equal(normaliseUsername("  Ama.Mensah  "), "ama.mensah");
  assert.equal(normaliseUsername("KOJO"), "kojo");
});

test("usable usernames are accepted", () => {
  for (const good of ["ama", "ama.mensah", "kojo_b", "van-3", "a1b2", "x".repeat(24)]) {
    assert.equal(usernameProblem(good), null, `${good} should be accepted`);
  }
});

test("usernames that would cause trouble are refused", () => {
  // Too short to be distinctive, too long for the column.
  assert.ok(usernameProblem("ab"));
  assert.ok(usernameProblem("x".repeat(25)));
  // Nothing at all.
  assert.ok(usernameProblem("   "));
  // A leading or trailing separator makes two names that look identical.
  assert.ok(usernameProblem(".ama"));
  assert.ok(usernameProblem("ama."));
  assert.ok(usernameProblem("-ama"));
  // Anything that has to be quoted, or looks like an address.
  for (const bad of ["ama mensah", "ama@ent", "ama/mensah", "ama'--", "amá"]) {
    assert.ok(usernameProblem(bad), `${bad} should be refused`);
  }
});

test("case is not what distinguishes two people", () => {
  // The column is citext, so these are the same account. The rule here
  // only has to agree that both are acceptable spellings of one name.
  assert.equal(normaliseUsername("Ama"), normaliseUsername("AMA"));
});

test("a username is suggested from a name, or nothing is", () => {
  assert.equal(suggestUsername("Ama Mensah"), "ama.mensah");
  assert.equal(suggestUsername("Kofi  A.  Boateng"), "kofi.a.boateng");
  // Too short to suggest; the form leaves it to the administrator.
  assert.equal(suggestUsername("Jo"), "");
  assert.equal(suggestUsername(""), "");
});

test("a suggested username is always one the rules accept", () => {
  for (const name of ["Ama Mensah", "Kofi A. Boateng", "O'Brien Tetteh", "Mary-Jane Owusu"]) {
    const suggested = suggestUsername(name);
    if (!suggested) continue;
    assert.equal(usernameProblem(suggested), null,
      `suggested "${suggested}" from "${name}" is not itself valid`);
  }
});

// ------------------------------------------------------------------
// The attempt limit
// ------------------------------------------------------------------

test("the lockout is five attempts and a quarter of an hour", () => {
  // These are the numbers the whole door rests on: sign-in is by PIN
  // alone, so four digits with no limit is ten thousand guesses.
  assert.equal(MAX_FAILED_ATTEMPTS, 5);
  assert.equal(COOLDOWN_MINUTES, 15);
});

test("the countdown reaches the lockout on the fifth failure, not before", () => {
  // What the screen shows after each wrong PIN. The fifth is the one
  // that locks: four earlier failures each leave a try in hand.
  const remainingAfter = (failures: number) => MAX_FAILED_ATTEMPTS - failures;

  assert.equal(remainingAfter(1), 4);
  assert.equal(remainingAfter(2), 3);
  assert.equal(remainingAfter(3), 2);
  assert.equal(remainingAfter(4), 1);
  assert.ok(remainingAfter(5) <= 0, "the fifth failure must lock");

  // Nothing between one and four may lock.
  for (const f of [1, 2, 3, 4]) {
    assert.ok(remainingAfter(f) > 0, `${f} failure(s) must not lock`);
  }
});

test("the lockout message counts down in whole minutes and names nothing technical", () => {
  assert.match(lockoutMessage(15 * 60), /15 minutes/);
  assert.match(lockoutMessage(14 * 60), /14 minutes/);
  // Rounded up, and never "0 minutes" or "1 minutes".
  assert.match(lockoutMessage(30), /1 minute\b/);
  assert.match(lockoutMessage(1), /1 minute\b/);

  for (const seconds of [1, 30, 60, 599, 900]) {
    const message = lockoutMessage(seconds);
    assert.ok(!/(supabase|postgrest|sql|jwt|database|server|token)/i.test(message),
      `leaked something technical: ${message}`);
  }
});

test("a failure says the same thing whoever the PIN belonged to", () => {
  // One sentence for "nobody holds this", "a deactivated account holds
  // this" and "that is not your PIN", so the screen cannot be used to
  // find out which PINs exist.
  assert.match(INCORRECT_PIN, /^Incorrect PIN/);
  assert.ok(!/username|account|user|exist/i.test(INCORRECT_PIN));
});

test("a PIN already in use is refused without naming its owner", () => {
  assert.match(PIN_TAKEN, /already in use/i);
  // Naming the holder would be handing over their credential, since the
  // PIN is the whole of it.
  assert.ok(!/\b(admin|manager|driver|owned by|belongs to)\b/i.test(PIN_TAKEN));
});
