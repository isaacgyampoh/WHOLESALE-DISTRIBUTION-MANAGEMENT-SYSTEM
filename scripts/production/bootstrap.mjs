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
 *   npm run production:bootstrap
 */
import { createHmac } from "node:crypto";
import readline from "node:readline";
import { adminClient, loadEnv } from "../demo/lib.mjs";

const say = (m = "") => console.log(m);

function ask(prompt, { secret = false } = {}) {
  return new Promise((resolve) => {
    // Without a terminal there is nowhere to type a PIN, and a stack
    // trace would say nothing useful about that.
    if (!process.stdin.isTTY) {
      console.error("");
      console.error("This needs an interactive terminal - it asks for a PIN and hides");
      console.error("what you type. Run it directly in your own shell:");
      console.error("");
      console.error("  npm run production:bootstrap");
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
if (orgs?.length) {
  say("Organizations on this database:");
  orgs.forEach((o, i) => say(`  ${i + 1}. ${o.name}   (${o.slug})`));
  say(`  ${orgs.length + 1}. Create a new one`);
  say("");
  const choice = Number(await ask(`Which one? [1-${orgs.length + 1}] `));
  if (choice >= 1 && choice <= orgs.length) org = orgs[choice - 1];
}

if (!org) {
  const name = await ask("Organization name: ");
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
const fullName = await ask("Administrator's full name: ");
if (!fullName) { console.error("A name is required."); process.exit(1); }

// The address is an identifier for Supabase Auth, never a sign-in
// credential - nobody types it. Asked for so it is recognisable in the
// Supabase dashboard rather than a random string.
const email = (await ask("Their email (an identifier only, never used to sign in): ")).toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("That does not look like an email address.");
  process.exit(1);
}

say("");
say("Choose a four-digit PIN. Change it from inside the application afterwards.");
const pin = await ask("PIN: ", { secret: true });
const again = await ask("Again: ", { secret: true });

if (!/^\d{4}$/.test(pin)) { console.error("The PIN has to be four digits."); process.exit(1); }
if (pin !== again) { console.error("Those did not match."); process.exit(1); }
if (["1024", "2048", "3072", "4096"].includes(pin)) {
  console.error("That is one of the demonstration PINs. Choose another.");
  process.exit(1);
}
if (/^(\d)\1{3}$/.test(pin) || ["1234", "4321", "0000"].includes(pin)) {
  console.error("That PIN is too easy to guess. Choose another.");
  process.exit(1);
}

// ------------------------------------------------------------------
// Create
// ------------------------------------------------------------------
const { data: user, error: userError } = await admin.auth.admin.createUser({
  email,
  email_confirm: true,
  user_metadata: { full_name: fullName, role: "admin", org_id: org.id },
});

if (userError) { console.error(`Could not create the account: ${userError.message}`); process.exit(1); }

// The profile is created by a trigger on auth.users. Make certain it
// landed in the right organization with the right role rather than
// assuming the metadata was honoured.
const { error: profileError } = await admin
  .from("profiles")
  .update({
    full_name: fullName,
    role: "admin",
    org_id: org.id,
    is_active: true,
    pin_hash: createHmac("sha256", pepper).update(pin).digest("hex"),
    pin_set_at: new Date().toISOString(),
  })
  .eq("id", user.user.id);

if (profileError) {
  console.error(`The account was created but its profile could not be set: ${profileError.message}`);
  console.error(`Remove the account in Supabase (Authentication -> Users, id ${user.user.id}) and try again.`);
  process.exit(1);
}

const { data: check } = await admin
  .from("profiles").select("full_name, role, is_active, org_id").eq("id", user.user.id).maybeSingle();

if (!check || check.role !== "admin" || !check.is_active || check.org_id !== org.id) {
  console.error("The profile was written but does not read back as an active administrator.");
  console.error("Check it in the Supabase table editor before relying on it.");
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
  after: { bootstrap: true, organization: org.name },
});

say("");
say(`${fullName} can now sign in to ${org.name} as an administrator.`);
say("");
say("Next:");
say("  - sign in and change that PIN from the account screen");
say("  - create the rest of the staff under Staff");
say("  - set real credit limits on customers before anybody sells on account");
say("  - crew each van with a driver and at least one salesperson");
