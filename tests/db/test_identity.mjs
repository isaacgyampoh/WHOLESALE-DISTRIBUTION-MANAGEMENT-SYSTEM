import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Client, CONN } = require("./lib.js");

/**
 * Migration 0017: who may come into existence, and how.
 *
 * Covers the two faults proved before the migration was written: a
 * phone-only signup failed on a not-null email, and an uninvited signup
 * became an active sales_rep who could read the catalogue.
 */
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

const c = new Client(CONN);
await c.connect();
const org = (await c.query("select id from organizations where slug='default'")).rows[0].id;

const asUser = async (id, sql) => {
  await c.query("begin");
  await c.query(`select set_config('request.jwt.claims',$1,true)`,
    [JSON.stringify({ sub: id, role: "authenticated" })]);
  await c.query("set local role authenticated");
  try { return { ok: true, rows: (await c.query(sql)).rows }; }
  catch (e) { return { ok: false, error: e.message }; }
  finally { await c.query("rollback"); }
};

console.log("=== phone-only signup (previously failed outright) ===");
let phoneId = null;
try {
  phoneId = (await c.query(
    `insert into auth.users (phone, raw_user_meta_data)
     values ('+233241110077', $1::jsonb) returning id`,
    [JSON.stringify({ full_name: "Kojo Driver", role: "driver", org_id: org })],
  )).rows[0].id;
  ok("phone-only signup succeeds", true);
} catch (e) { ok("phone-only signup succeeds", false, `-> ${e.message}`); }

if (phoneId) {
  const p = (await c.query("select email, phone, role, is_active from profiles where id=$1", [phoneId])).rows[0];
  ok("profile created with no email", p.email === null, `(phone=${p.phone})`);
  ok("invited account is active", p.is_active === true);
  ok("invited role honoured", p.role === "driver", `(${p.role})`);
}

console.log("\n=== a profile must carry some identity ===");
try {
  await c.query(`insert into profiles (id, org_id) values (gen_random_uuid(), $1)`, [org]);
  ok("row with neither email nor phone rejected", false, "(INSERT SUCCEEDED)");
} catch (e) {
  ok("row with neither email nor phone rejected", /profiles_needs_an_identity/.test(e.message));
}

console.log("\n=== phone is unique within an organization ===");
try {
  await c.query(
    `insert into auth.users (phone, raw_user_meta_data) values ('+233241110088', $1::jsonb)`,
    [JSON.stringify({ org_id: org, role: "driver" })]);
  await c.query(
    `update profiles set phone='+233241110077' where phone='+233241110088'`);
  ok("duplicate phone in the same org rejected", false, "(UPDATE SUCCEEDED)");
} catch (e) {
  ok("duplicate phone in the same org rejected", /profiles_org_phone_key/.test(e.message));
}

console.log("\n=== uninvited signup, as Google OAuth would create it ===");
const uninvited = (await c.query(
  `insert into auth.users (email, raw_app_meta_data, raw_user_meta_data)
   values ('stranger@gmail.com', '{"provider":"google"}'::jsonb, '{"name":"A Stranger"}'::jsonb)
   returning id`)).rows[0].id;
const up = (await c.query("select role, is_active, full_name from profiles where id=$1", [uninvited])).rows[0];
ok("profile is created", Boolean(up));
ok("but it is INACTIVE", up.is_active === false);
ok("name taken from the Google 'name' field", up.full_name === "A Stranger", `(${up.full_name})`);

for (const t of ["products", "customers", "organizations", "stock_summary", "van_sales"]) {
  const r = await asUser(uninvited, `select count(*)::int n from ${t}`);
  ok(`uninvited account reads nothing from ${t}`, r.ok && r.rows[0].n === 0,
     r.ok ? `(${r.rows[0].n} rows)` : `-> ${r.error.slice(0, 40)}`);
}
const role = await asUser(uninvited, "select public.auth_role()::text v");
ok("auth_role() is null for an inactive account", role.ok && role.rows[0].v === null);

console.log("\n=== a self-registered account cannot claim a role ===");
const claimed = (await c.query(
  `insert into auth.users (email, raw_user_meta_data)
   values ('claimer@gmail.com', '{"role":"admin","full_name":"Claimer"}'::jsonb) returning id`)).rows[0].id;
const cp = (await c.query("select role, is_active from profiles where id=$1", [claimed])).rows[0];
ok("requested role ignored without an invitation", cp.role === "sales_rep", `(${cp.role})`);
ok("and the account is inactive", cp.is_active === false);

console.log("\n=== activation by an administrator restores access ===");
await c.query("update profiles set is_active=true where id=$1", [uninvited]);
const after = await asUser(uninvited, "select count(*)::int n from products");
ok("activated account can read the catalogue", after.ok && after.rows[0].n > 0,
   after.ok ? `(${after.rows[0].n} products)` : `-> ${after.error}`);

console.log("\n=== identity changes stay in step ===");
await c.query("update auth.users set phone='+233209990001' where id=$1", [uninvited]);
const synced = (await c.query("select phone from profiles where id=$1", [uninvited])).rows[0];
ok("phone added in Auth reaches the profile", synced.phone === "+233209990001", `(${synced.phone})`);

console.log(`\n  ${pass} passed, ${fail} failed`);
await c.end();
process.exit(fail ? 1 : 0);
