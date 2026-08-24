/**
 * Creating the first administrator, on a database with nobody in it.
 *
 * After the demonstration data is removed there are no accounts at all.
 * The sign-in screen still works, but every PIN is rejected and nothing
 * on it explains why - so without this the business cannot get into its
 * own system.
 *
 * The obvious alternative, a first-run screen in the application, is
 * wrong: whoever reached the URL first would become the administrator.
 * This runs from a terminal and needs the service role key, which only
 * the operator has.
 *
 * It refuses once an administrator exists, so it cannot be used later to
 * quietly add one.
 *
 * The account it creates holds the documented bootstrap PIN and is
 * flagged must_change_pin, so it can do nothing in the application until
 * the person signs in and chooses their own. The bootstrap PIN is
 * therefore a way in that expires on first use rather than a credential.
 *
 *   npm run production:bootstrap
 *
 * Everything can be supplied up front, for an unattended install:
 *
 *   npm run production:bootstrap -- --username ama --name "Ama Mensah" \
 *     --email ama@example.com
 *
 * The PIN is never taken as an argument - that would put it in shell
 * history. Omitted, it is the documented bootstrap PIN; to choose a
 * different one non-interactively, set BOOTSTRAP_PIN in the environment.
 */
import { createHmac } from "node:crypto";
import readline from "node:readline";
import { adminClient, loadEnv } from "../demo/lib.mjs";

/**
 * Kept in step with src/lib/auth/pin.ts, which is TypeScript and cannot
 * be imported here. The suite in tests/unit asserts the two agree.
 */
const BOOTSTRAP_PIN = "1024";
const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
const USERNAME_MIN = 3;
const USERNAME_MAX = 24;

/** Command-line arguments, so an unattended install need not type. */
function flag(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? "").trim() : "";
}

const say = (m = "") => console.log(m);

function ask(prompt, { secret = false, preset = "" } = {}) {
  // Supplied on the command line, so there is nothing to ask.
  if (preset) return Promise.resolve(preset);

  return new Promise((resolve) => {
    // Without a terminal there is nowhere to type, and a stack trace
    // would say nothing useful about that.
    if (!process.stdin.isTTY) {
      console.error("");
      console.error(`Nothing to read "${prompt.trim()}" from: this is not a terminal.`);
      console.error("");
      console.error("Run it in your own shell:");
      console.error("");
      console.error("  npm run production:bootstrap");
      console.error("");
      console.error("or supply the details up front:");
      console.error("");
      console.error("  npm run production:bootstrap -- \\");
      console.error("    --username ama --name \"Ama Mensah\" --email ama@example.com");
      process.exit(1);
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(prompt);
    const write = rl.output.write.bind(rl.output);
    if (secret) rl.output.write = () => true;
    rl.question("", (answer) => {
      rl.output.write = write;
      if (secret) process.stdout.write("\n");
      rl.close();
      resolve(answer.trim());
    });
  });
}

const env = loadEnv();
const pepper = env.PIN_PEPPER;
if (!pepper || pepper.length < 32) {
  console.error("PIN_PEPPER must be set in .env.local, and must be the value the deployed");
  console.error("application runs with. Generate one with: openssl rand -base64 48");
  process.exit(1);
}

const admin = adminClient();

// ------------------------------------------------------------------
// Refuse if there is already a way in
// ------------------------------------------------------------------
const { data: existing, error: readError } = await admin
  .from("profiles")
  .select("id, full_name, role")
  .in("role", ["admin", "senior_manager"])
  .limit(5);

if (readError) {
  console.error(`Could not read the staff list: ${readError.message}`);
  process.exit(1);
}

if (existing?.length) {
  say("An administrator already exists:");
  say("");
  for (const p of existing) say(`  ${p.full_name ?? "unnamed"}  (${p.role})`);
  say("");
  say("Create further staff from inside the application, under Staff.");
  say("This script only creates the very first one.");
  process.exit(1);
}

// ------------------------------------------------------------------
// Which organization
// ------------------------------------------------------------------
const { data: orgs } = await admin.from("organizations").select("id, name, slug").order("name");

say("No administrator exists yet. Creating the first one.");
say("");

let org;
const wantedSlug = flag("org");

if (wantedSlug) {
  org = orgs?.find((o) => o.slug === wantedSlug);
  if (!org) {
    console.error(`No organization has the slug "${wantedSlug}".`);
    console.error(`On this database: ${(orgs ?? []).map((o) => o.slug).join(", ") || "none"}`);
    process.exit(1);
  }
} else if (orgs?.length === 1 && !process.stdin.isTTY) {
  // Exactly one, and nobody to ask. Choosing it is the only sensible
  // reading, and it is the shape every fresh install has.
  [org] = orgs;
  say(`Organization: ${org.name} (${org.slug}) - the only one on this database.`);
} else if (orgs?.length) {
  say("Organizations on this database:");
  orgs.forEach((o, i) => say(`  ${i + 1}. ${o.name}   (${o.slug})`));
  say(`  ${orgs.length + 1}. Create a new one`);
  say("");
  const choice = Number(await ask(`Which one? [1-${orgs.length + 1}] `));
  if (choice >= 1 && choice <= orgs.length) org = orgs[choice - 1];
}

if (!org) {
  const name = await ask("Organization name: ", { preset: flag("org-name") });
  if (!name) { console.error("A name is required."); process.exit(1); }
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

  const { data: created, error } = await admin
    .from("organizations").insert({ name, slug }).select("id, name, slug").single();
  if (error) { console.error(`Could not create the organization: ${error.message}`); process.exit(1); }
  org = created;
  say(`Created ${org.name}.`);
}

// ------------------------------------------------------------------
// The person
// ------------------------------------------------------------------
say("");
const fullName = await ask("Administrator's full name: ", { preset: flag("name") });
if (!fullName) { console.error("A name is required."); process.exit(1); }

// ------------------------------------------------------------------
// The username
// ------------------------------------------------------------------
//
// What they will actually type to sign in. Suggested from their name so
// the common case is a keystroke, but theirs to choose - it goes on a
// slip of paper and gets read out over a phone.
const suggestion = fullName.toLowerCase()
  .replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "")
  .replace(/\.{2,}/g, ".").slice(0, USERNAME_MAX);

say("");
const username = (await ask(
  suggestion.length >= USERNAME_MIN
    ? `Username for signing in [${suggestion}]: `
    : "Username for signing in: ",
  { preset: flag("username") },
)).toLowerCase() || suggestion;

if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
  console.error(`A username must be ${USERNAME_MIN}-${USERNAME_MAX} characters.`);
  process.exit(1);
}
if (!USERNAME_PATTERN.test(username)) {
  console.error("Use letters and numbers, with dots, hyphens or underscores between them.");
  process.exit(1);
}

// The unique index would catch this, but not with a sentence anyone
// wants to read at three in the morning.
const { data: taken } = await admin
  .from("profiles").select("id").eq("username", username).maybeSingle();
if (taken) {
  console.error(`The username "${username}" is already in use. Choose another.`);
  process.exit(1);
}

// The address is an identifier for Supabase Auth, never a sign-in
// credential - nobody types it. Asked for so it is recognisable in the
// Supabase dashboard rather than a random string.
const email = (await ask("Their email (an identifier only, never used to sign in): ",
  { preset: flag("email") })).toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("That does not look like an email address.");
  process.exit(1);
}

// ------------------------------------------------------------------
// The PIN
// ------------------------------------------------------------------
//
// Defaults to the documented bootstrap PIN, which is not a secret and is
// not meant to be one: it lets this person through the door once. The
// account is flagged must_change_pin below, so the application will let
// them do nothing else until they have replaced it.
//
// A different one can be given instead - by typing it, or in
// BOOTSTRAP_PIN for an unattended install - and that one is provisional
// too, for the same reason: somebody other than its owner chose it.
const supplied = (process.env.BOOTSTRAP_PIN ?? "").trim();

let pin;
if (supplied) {
  pin = supplied;
} else if (process.stdin.isTTY) {
  say("");
  say(`Press enter to use the bootstrap PIN ${BOOTSTRAP_PIN}, or type a different`);
  say("four-digit PIN. Either way it must be changed at first sign-in.");
  pin = (await ask(`PIN [${BOOTSTRAP_PIN}]: `, { secret: true })) || BOOTSTRAP_PIN;
  if (pin !== BOOTSTRAP_PIN) {
    const again = await ask("Again: ", { secret: true });
    if (pin !== again) { console.error("Those did not match."); process.exit(1); }
  }
} else {
  pin = BOOTSTRAP_PIN;
}

if (!/^\d{4}$/.test(pin)) { console.error("The PIN has to be four digits."); process.exit(1); }

// Every other obvious PIN is still refused. The bootstrap PIN is the one
// exception, and only because it cannot survive first use.
if (pin !== BOOTSTRAP_PIN
    && (/^(\d)\1{3}$/.test(pin) || ["1234", "4321", "0123", "0000"].includes(pin))) {
  console.error("That PIN is too easy to guess. Choose another.");
  process.exit(1);
}

// It has to be free: pin_hash carries a unique index. On a database with
// no accounts this cannot fail, which is the case bootstrap runs in.
const digest = createHmac("sha256", pepper).update(pin).digest("hex");
const { data: pinTaken } = await admin
  .from("profiles").select("id").eq("pin_hash", digest).maybeSingle();
if (pinTaken) {
  console.error("That PIN is already in use. Choose another.");
  process.exit(1);
}

// ------------------------------------------------------------------
// Create
// ------------------------------------------------------------------
const { data: user, error: userError } = await admin.auth.admin.createUser({
  email,
  email_confirm: true,
  user_metadata: { full_name: fullName, role: "admin", org_id: org.id, username },
});

if (userError) { console.error(`Could not create the account: ${userError.message}`); process.exit(1); }

// The profile is created by a trigger on auth.users. Make certain it
// landed in the right organization with the right role rather than
// assuming the metadata was honoured.
const { error: profileError } = await admin
  .from("profiles")
  .update({
    full_name: fullName,
    username,
    role: "admin",
    org_id: org.id,
    is_active: true,
    pin_hash: digest,
    pin_set_at: new Date().toISOString(),
    // The whole point. Whoever holds this PIN did not choose it, so the
    // application allows them nothing but choosing a real one.
    must_change_pin: true,
  })
  .eq("id", user.user.id);

if (profileError) {
  console.error(`The account was created but its profile could not be set: ${profileError.message}`);
  console.error(`Remove the account in Supabase (Authentication -> Users, id ${user.user.id}) and try again.`);
  process.exit(1);
}

const { data: check } = await admin
  .from("profiles")
  .select("full_name, username, role, is_active, org_id, must_change_pin")
  .eq("id", user.user.id).maybeSingle();

if (!check || check.role !== "admin" || !check.is_active || check.org_id !== org.id) {
  console.error("The profile was written but does not read back as an active administrator.");
  console.error("Check it in the Supabase table editor before relying on it.");
  process.exit(1);
}

// Without the flag the provisional PIN would simply become permanent,
// which is the one outcome this is built to prevent.
if (check.username !== username || !check.must_change_pin) {
  console.error("The account was created but is not flagged to change its PIN at first");
  console.error("sign-in. Set must_change_pin to true on it before handing it over.");
  process.exit(1);
}

await admin.from("audit_log").insert({
  org_id: org.id,
  actor_id: user.user.id,
  actor_name: fullName,
  actor_role: "admin",
  action: "user.created",
  target_type: "profile",
  target_id: user.user.id,
  target_label: fullName,
  after: { bootstrap: true, organization: org.name, username },
});

// The digest depends on PIN_PEPPER, so a deployment running a different
// one will reject this PIN and say only "incorrect username or PIN".
// Printing a fingerprint of the pepper - not the pepper - makes that
// visible here rather than at a locked-out sign-in screen.
const fingerprint = createHmac("sha256", "fingerprint").update(pepper).digest("hex").slice(0, 16);

say("");
say(`${fullName} can now sign in to ${org.name}.`);
say("");
say(`  Username  ${username}`);
say(pin === BOOTSTRAP_PIN
  ? `  PIN       ${BOOTSTRAP_PIN}  (the bootstrap PIN, must be changed at first sign-in)`
  : "  PIN       the one you just chose (must be changed at first sign-in)");
say("");
say("The application will not let this account do anything else until a new");
say("PIN has been set, and the one above stops working the moment it is.");
say("");
say(`PIN_PEPPER fingerprint: ${fingerprint}`);
say("The deployment must be running the same PIN_PEPPER, or this PIN will be");
say("refused with nothing to say why. Check the deployed value matches:");
say("");
say("  vercel env pull .env.production.local --environment=production");
say("");
say("and compare the fingerprint of its PIN_PEPPER with the one above.");
say("");
say("Then:");
say("  - create the rest of the staff under Staff, each with their own username");
say("  - set real credit limits on customers before anybody sells on account");
say("  - crew each van with a driver and at least one salesperson");
