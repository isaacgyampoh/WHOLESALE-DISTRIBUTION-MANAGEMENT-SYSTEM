/**
 * A way back in after the PIN pepper changed.
 *
 * WHY THIS IS EVER NEEDED
 *
 * A PIN is never stored. What is stored is an HMAC of it under
 * PIN_PEPPER, so the pepper is part of every stored digest: change the
 * pepper and every existing PIN stops verifying, all at once, for
 * everybody. Nothing is corrupted and no data is lost - the digests
 * simply no longer describe the PINs people know.
 *
 * That is what a move between hosts can do. The old host held the
 * pepper as a write-only secret, which is the correct way to hold it
 * and also means it cannot be read back out to carry across. The new
 * host therefore runs a different one, and the whole staff is locked
 * out of a system that is otherwise working perfectly.
 *
 * WHY ONLY THE ADMINISTRATOR
 *
 * Because it is the smallest thing that fixes it. One account is given
 * a documented temporary PIN and flagged must_change_pin, so it is a
 * way in that expires the moment it is used; the administrator then
 * re-issues the rest through the application, where it belongs - with
 * their name against each change in the audit log, and each person
 * choosing their own PIN on first sign-in.
 *
 * Resetting all eight from a terminal would be faster and worse: eight
 * credentials set by a script, with nobody's name on them.
 *
 *   node scripts/production/reissue-admin-pin.mjs --confirm
 *
 * Refuses to run without --confirm. Prints no PIN that is not already
 * written down in the documentation.
 */
import { createHmac } from "node:crypto";
import { adminClient, loadEnv } from "../demo/lib.mjs";

const BOOTSTRAP_PIN = "1024";          // documented, and expires on use
const confirm = process.argv.includes("--confirm");

const env = loadEnv();
if (!env.PIN_PEPPER) {
  console.error("PIN_PEPPER is not set. It has to be the one the live site runs,");
  console.error("or this writes a digest that site cannot verify.");
  process.exit(1);
}

const admin = adminClient();
const digest = (pin) => createHmac("sha256", env.PIN_PEPPER).update(pin).digest("hex");

const { data: people, error } = await admin
  .from("profiles")
  .select("id, username, full_name, role, pin_hash, must_change_pin")
  .eq("role", "admin")
  .eq("is_active", true)
  .order("created_at");

if (error) { console.error(error.message); process.exit(1); }
if (!people?.length) {
  console.error("No active administrator. Use `npm run production:bootstrap` instead.");
  process.exit(1);
}

const target = people[0];

// A PIN names exactly one account, so this must not collide with one
// somebody else is already holding.
const wanted = digest(BOOTSTRAP_PIN);
const { data: clash } = await admin
  .from("profiles").select("id, username").eq("pin_hash", wanted).neq("id", target.id);
if (clash?.length) {
  console.error(`PIN ${BOOTSTRAP_PIN} is already held by another account. Nothing changed.`);
  process.exit(1);
}

console.log(`Administrator : ${target.full_name} (${target.username})`);
console.log(`Current PIN   : set, and not verifiable under the pepper now in use`);
console.log(`After this    : ${BOOTSTRAP_PIN}, which must be changed on first sign-in`);

if (!confirm) {
  console.log("\nDry run. Nothing was written. Pass --confirm to carry it out.");
  process.exit(0);
}

const { error: wErr } = await admin
  .from("profiles")
  .update({
    pin_hash: wanted,
    must_change_pin: true,
    pin_set_at: new Date().toISOString(),
  })
  .eq("id", target.id);

if (wErr) { console.error(wErr.message); process.exit(1); }

// Said out loud in the record, not just in a terminal nobody keeps.
await admin.from("audit_log").insert({
  org_id: (await admin.from("profiles").select("org_id").eq("id", target.id).single()).data.org_id,
  actor_id: target.id,
  actor_name: target.full_name,
  actor_role: target.role,
  action: "staff.pin_reissued",
  target_type: "profile",
  target_id: target.id,
  target_label: `${target.username} ${target.full_name}`,
  before: { must_change_pin: target.must_change_pin },
  after: {
    must_change_pin: true,
    reason: "PIN pepper changed with the move to Cloudflare; every stored "
      + "digest was written under the old host's pepper and no longer verifies.",
  },
});

// Anybody still locked out, so the administrator knows who to re-issue.
const { data: rest } = await admin
  .from("profiles").select("username, full_name, role")
  .eq("is_active", true).neq("id", target.id).not("pin_hash", "is", null)
  .order("role");

console.log("\nDone. Sign in with that PIN and choose a new one immediately.");
console.log(`\nStill to re-issue, from Staff in the application (${rest?.length ?? 0}):`);
for (const p of rest ?? []) console.log(`  ${p.username.padEnd(16)} ${p.full_name} · ${p.role}`);
