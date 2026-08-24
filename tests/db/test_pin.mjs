import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Client, CONN } = require("./lib.js");
const { createHmac } = require("node:crypto");

/**
 * Migration 0018: PIN credentials and the attempt log.
 *
 * The digest is computed here the way the application computes it, so
 * these tests exercise the real storage format rather than a stand-in.
 */
const PEPPER = "test-pepper-0123456789abcdef0123456789abcdef";
const digest = (pin) => createHmac("sha256", PEPPER).update(pin).digest("hex");

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

const c = new Client(CONN); await c.connect();
const org = (await c.query("select id from organizations where slug='default'")).rows[0].id;
const otherOrg = (await c.query(
  `insert into organizations (name, slug) values ('Second Co','second-co') returning id`)).rows[0].id;

const mkUser = async (name, role, orgId = org) => (await c.query(
  `insert into auth.users (email, raw_user_meta_data) values ($1,$2::jsonb) returning id`,
  [`${name.replace(/\W/g, "")}@pin.test`,
   JSON.stringify({ full_name: name, role, org_id: orgId })])).rows[0].id;

const asUser = async (id, sql, params) => {
  await c.query("begin");
  await c.query(`select set_config('request.jwt.claims',$1,true)`,
    [JSON.stringify({ sub: id, role: "authenticated" })]);
  await c.query("set local role authenticated");
  try { return { ok: true, rows: (await c.query(sql, params)).rows }; }
  catch (e) { return { ok: false, error: e.message }; }
  finally { await c.query("rollback"); }
};

console.log("=== a PIN is stored only as a digest ===");
const admin = await mkUser("Super Admin", "admin");
await c.query(`update profiles set pin_hash=$1 where id=$2`, [digest("1024"), admin]);
const stored = (await c.query(`select pin_hash, pin_set_at from profiles where id=$1`, [admin])).rows[0];
ok("no column holds the PIN itself",
   (await c.query(`select count(*)::int n from information_schema.columns
     where table_schema='public' and table_name='profiles'
       and column_name in ('pin','pin_plain','pin_code')`)).rows[0].n === 0);
ok("the stored value is not the PIN", stored.pin_hash !== "1024" && stored.pin_hash.length === 64);
ok("setting a PIN stamps when it happened", Boolean(stored.pin_set_at));
ok("the digest resolves to exactly one account",
   (await c.query(`select count(*)::int n from profiles where pin_hash=$1 and is_active`,
     [digest("1024")])).rows[0].n === 1);
ok("a different PIN resolves to nobody",
   (await c.query(`select count(*)::int n from profiles where pin_hash=$1 and is_active`,
     [digest("9999")])).rows[0].n === 0);

console.log("\n=== no two active people may share a PIN ===");
const driver = await mkUser("Kojo Driver", "driver");
let clash = false;
try { await c.query(`update profiles set pin_hash=$1 where id=$2`, [digest("1024"), driver]); }
catch (e) { clash = /profiles_active_pin_key/.test(e.message); }
ok("a duplicate PIN is refused within an organization", clash);

const stranger = await mkUser("Other Co Admin", "admin", otherOrg);
let crossOrg = false;
try { await c.query(`update profiles set pin_hash=$1 where id=$2`, [digest("1024"), stranger]); }
catch { crossOrg = true; }
ok("and across organizations too, because sign-in has no organization", crossOrg);

console.log("\n=== a PIN frees up when an account is deactivated ===");
await c.query(`update profiles set is_active=false where id=$1`, [admin]);
let reused = true;
try { await c.query(`update profiles set pin_hash=$1 where id=$2`, [digest("1024"), driver]); }
catch { reused = false; }
ok("an inactive account no longer holds its PIN", reused);
ok("and an inactive account cannot be found by PIN",
   (await c.query(`select count(*)::int n from profiles where pin_hash=$1 and is_active`,
     [digest("1024")])).rows[0].n === 1);
// Restore for the remaining checks.
await c.query(`update profiles set pin_hash=null where id=$1`, [driver]);
await c.query(`update profiles set is_active=true, pin_hash=$1 where id=$2`, [digest("1024"), admin]);

console.log("\n=== changing another person's PIN needs authority ===");
let r = await asUser(driver, `update profiles set pin_hash=$1 where id=$2 returning id`,
  [digest("5555"), admin]);
ok("a driver cannot change an administrator's PIN",
   !r.ok || r.rows.length === 0, r.ok ? `(${r.rows.length} rows)` : `-> ${r.error.slice(0, 42)}`);

r = await asUser(admin, `update profiles set pin_hash=$1 where id=$2 returning id`,
  [digest("7777"), driver]);
ok("an administrator can", r.ok && r.rows.length === 1, r.ok ? "" : `-> ${r.error.slice(0, 42)}`);

console.log("\n=== the old PIN stops working once changed ===");
await c.query(`update profiles set pin_hash=$1 where id=$2`, [digest("4321"), admin]);
ok("the previous PIN matches nobody",
   (await c.query(`select count(*)::int n from profiles where pin_hash=$1 and is_active`,
     [digest("1024")])).rows[0].n === 0);
ok("the new PIN matches the same person",
   (await c.query(`select id from profiles where pin_hash=$1 and is_active`,
     [digest("4321")])).rows[0].id === admin);

console.log("\n=== the attempt log is server-side only ===");
await c.query(`insert into auth_pin_attempts (request_ip, succeeded) values ('203.0.113.10', false)`);
for (const [who, id] of [["a driver", driver], ["an administrator", admin]]) {
  const read = await asUser(id, `select count(*)::int n from auth_pin_attempts`);
  ok(`${who} cannot read sign-in attempts`, !read.ok || read.rows[0].n === 0,
     read.ok ? `(${read.rows[0].n} rows)` : `-> ${read.error.slice(0, 38)}`);
  const write = await asUser(id, `insert into auth_pin_attempts (succeeded) values (true)`);
  ok(`${who} cannot forge an attempt`, !write.ok, write.ok ? "(INSERT SUCCEEDED)" : "(blocked)");
}
ok("the attempt log holds no PIN and no digest",
   (await c.query(`select count(*)::int n from information_schema.columns
     where table_schema='public' and table_name='auth_pin_attempts'
       and (column_name like '%pin%' and column_name <> 'profile_id')`)).rows[0].n === 0);

console.log("\n=== a PIN does not widen what its owner can see ===");
const driverSees = await asUser(driver, `select count(*)::int n from organizations`);
ok("a driver still sees only their own organization",
   driverSees.ok && driverSees.rows[0].n === 1, driverSees.ok ? `(${driverSees.rows[0].n})` : "");
const strangerSees = await asUser(stranger, `select count(*)::int n from products where org_id=$1`, [org]);
ok("another organization's staff still see nothing here",
   strangerSees.ok && strangerSees.rows[0].n === 0);

// ==================================================================
// A username says who you are; the PIN proves it (migration 0039)
// ==================================================================

console.log("\n=== every account is given a username ===");

const named = await mkUser("Ama Mensah", "driver");
const amaRow = (await c.query(
  "select username, must_change_pin from profiles where id=$1", [named])).rows[0];
ok("a username is derived from the name", amaRow.username === "ama.mensah",
   `(${amaRow.username})`);
ok("and an account is not provisional unless something says so",
   amaRow.must_change_pin === false);

// The trigger cannot retry a failed insert, so it has to settle the
// collision itself rather than raise. A distinct address, because
// mkUser derives one from the name and auth.users requires it unique -
// it is the same *person's name*, not the same account.
const twin = (await c.query(
  `insert into auth.users (email, raw_user_meta_data) values ($1,$2::jsonb) returning id`,
  ["ama.second@pin.test",
   JSON.stringify({ full_name: "Ama Mensah", role: "driver", org_id: org })]
)).rows[0].id;
const twinName = (await c.query("select username from profiles where id=$1", [twin])).rows[0].username;
ok("a second person of the same name gets a distinct one",
   twinName !== "ama.mensah" && twinName.startsWith("ama.mensah"), `(${twinName})`);

console.log("\n=== a username an administrator chose is honoured ===");
const chosen = (await c.query(
  `insert into auth.users (email, raw_user_meta_data) values ($1,$2::jsonb) returning id`,
  ["chosen@pin.test", JSON.stringify(
    { full_name: "Kofi Boateng", role: "driver", org_id: org, username: "kofi.b" })]
)).rows[0].id;
ok("the name supplied is the name used",
   (await c.query("select username from profiles where id=$1", [chosen])).rows[0].username === "kofi.b");

console.log("\n=== no two people may hold one username ===");
let duplicate = false;
try {
  await c.query("update profiles set username='ama.mensah' where id=$1", [chosen]);
} catch (e) { duplicate = /profiles_username_key/.test(e.message); }
ok("a duplicate username is refused", duplicate);

// citext: the same name in different case is the same name, so nobody
// can register a lookalike account.
let differentCase = false;
try {
  await c.query("update profiles set username='AMA.MENSAH' where id=$1", [chosen]);
} catch (e) { differentCase = /profiles_username_key/.test(e.message); }
ok("and so is the same name in another case", differentCase);

ok("a username matches regardless of how it is typed",
   (await c.query("select id from profiles where username='AmA.MeNsAh'")).rows[0]?.id === named);

console.log("\n=== nobody may be left without one ===");
let nullName = false;
try {
  await c.query("update profiles set username=null where id=$1", [chosen]);
} catch (e) { nullName = /null value in column "username"/.test(e.message); }
ok("a username cannot be removed", nullName);
ok("and no existing account is missing one",
   (await c.query("select count(*)::int n from profiles where username is null")).rows[0].n === 0);

console.log("\n=== the PIN is no longer what identifies somebody ===");
//
// This is the whole point of 0039. Before it, four digits selected the
// account; now the username does, and the digest is only compared
// against that one row.
await c.query("update profiles set pin_hash=$1, must_change_pin=true where id=$2",
  [digest("5150"), chosen]);

const byName = (await c.query(
  "select id, pin_hash, must_change_pin from profiles where username='kofi.b'")).rows[0];
ok("an account is found by its username", byName.id === chosen);
ok("and its PIN is then compared, not searched for", byName.pin_hash === digest("5150"));
ok("a PIN belonging to somebody else does not match it",
   byName.pin_hash !== digest("1024"));

console.log("\n=== an issued PIN is marked provisional ===");
ok("the flag is readable on the account", byName.must_change_pin === true);
ok("and defaults to false, so no ordinary account is trapped",
   (await c.query("select count(*)::int n from profiles where must_change_pin is null")).rows[0].n === 0);

console.log(`\n  ${pass} passed, ${fail} failed`);
await c.end();
process.exit(fail ? 1 : 0);
