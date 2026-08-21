import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Client, CONN } = require("./lib.js");

/**
 * Phase 5B security boundaries, at the database.
 *
 * These are the guarantees the user-management screens rest on. They are
 * asserted here rather than through the interface, because the interface
 * is not what enforces them.
 */
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

const c = new Client(CONN); await c.connect();
const orgA = (await c.query("select id from organizations where slug='default'")).rows[0].id;
const orgB = (await c.query(
  `insert into organizations (name, slug) values ('Rival Co','rival-co') returning id`)).rows[0].id;

const mk = async (name, role, org = orgA) => (await c.query(
  `insert into auth.users (email, raw_user_meta_data) values ($1,$2::jsonb) returning id`,
  [`${name}@sec.test`, JSON.stringify({ full_name: name, role, org_id: org })])).rows[0].id;

const as = async (id, sql, params) => {
  await c.query("begin");
  await c.query(`select set_config('request.jwt.claims',$1,true)`,
    [JSON.stringify({ sub: id, role: "authenticated" })]);
  await c.query("set local role authenticated");
  try { return { ok: true, rows: (await c.query(sql, params)).rows }; }
  catch (e) { return { ok: false, error: e.message }; }
  finally { await c.query("rollback"); }
};

const admin = await mk("admin", "admin");
const manager = await mk("manager", "manager");
const driver = await mk("driver", "driver");
const rival = await mk("rival", "admin", orgB);

console.log("=== listing staff ===");
let r = await as(driver, `select count(*)::int n from profiles`);
ok("a driver sees only themselves", r.ok && r.rows[0].n === 1, r.ok ? `(${r.rows[0].n})` : "");
r = await as(admin, `select count(*)::int n from profiles where org_id=$1`, [orgA]);
ok("an administrator sees their organization", r.ok && r.rows[0].n >= 3, r.ok ? `(${r.rows[0].n})` : "");
r = await as(admin, `select count(*)::int n from profiles where org_id=$1`, [orgB]);
ok("and nobody from another organization", r.ok && r.rows[0].n === 0);

console.log("\n=== role escalation ===");
r = await as(manager, `update profiles set role='admin' where id=$1 returning role`, [manager]);
ok("a manager cannot promote themselves", !r.ok || r.rows.length === 0,
   r.ok ? `(${r.rows.length} rows)` : `-> ${r.error.slice(0, 42)}`);
r = await as(driver, `update profiles set role='admin' where id=$1 returning role`, [driver]);
ok("a driver cannot promote themselves", !r.ok || r.rows.length === 0);
r = await as(manager, `update profiles set role='driver' where id=$1 returning role`, [admin]);
ok("a manager cannot demote an administrator", !r.ok || r.rows.length === 0);

console.log("\n=== category access ===");
const category = (await c.query(
  `select id from categories where org_id=$1 limit 1`, [orgA])).rows[0].id;
await c.query(`delete from manager_category_scopes where profile_id=$1`, [manager]);
r = await as(manager, `insert into manager_category_scopes (org_id, profile_id, category_id)
                       values ($1,$2,$3) returning id`, [orgA, manager, category]);
ok("a manager cannot grant themselves a category", !r.ok, r.ok ? "(GRANTED)" : "(blocked)");
r = await as(admin, `insert into manager_category_scopes (org_id, profile_id, category_id)
                     values ($1,$2,$3) returning id`, [orgA, manager, category]);
ok("an administrator can", r.ok, r.ok ? "" : `-> ${r.error.slice(0, 42)}`);

console.log("\n=== organization boundaries ===");
r = await as(rival, `select count(*)::int n from profiles where org_id=$1`, [orgA]);
ok("another organization's admin sees nobody here", r.ok && r.rows[0].n === 0);
r = await as(rival, `update profiles set role='driver' where id=$1 returning id`, [admin]);
ok("and cannot change anyone here", !r.ok || r.rows.length === 0);
r = await as(admin, `update profiles set org_id=$1 where id=$2 returning id`, [orgB, driver]);
ok("an administrator cannot move someone to another organization",
   !r.ok || r.rows.length === 0, r.ok ? `(${r.rows.length} rows)` : `-> ${r.error.slice(0, 40)}`);

console.log("\n=== PIN handling ===");
r = await as(driver, `select pin_hash from profiles where id=$1`, [admin]);
ok("a driver cannot read another person's PIN digest",
   r.ok && r.rows.length === 0, r.ok ? `(${r.rows.length} rows)` : "");
r = await as(manager, `update profiles set pin_hash='forged' where id=$1 returning id`, [admin]);
ok("a manager cannot set an administrator's PIN", !r.ok || r.rows.length === 0);

console.log("\n=== the audit trail ===");
await c.query(
  `insert into audit_log (org_id, actor_id, actor_name, action, target_type, target_id, after)
   values ($1,$2,'Admin','user.created','profile',$3,'{"role":"driver"}'::jsonb)`,
  [orgA, admin, driver]);

r = await as(admin, `select count(*)::int n from audit_log`);
ok("an administrator can read history", r.ok && r.rows[0].n >= 1, r.ok ? `(${r.rows[0].n})` : "");
r = await as(driver, `select count(*)::int n from audit_log`);
ok("a driver cannot", r.ok && r.rows[0].n === 0, r.ok ? `(${r.rows[0].n})` : `-> ${r.error?.slice(0, 30)}`);
r = await as(rival, `select count(*)::int n from audit_log`);
ok("another organization cannot", r.ok && r.rows[0].n === 0);

r = await as(admin, `update audit_log set action='tampered' returning id`);
ok("an administrator cannot alter history", !r.ok, r.ok ? "(ALTERED)" : `-> ${r.error.slice(0, 44)}`);
r = await as(admin, `delete from audit_log returning id`);
ok("nor delete it", !r.ok, r.ok ? "(DELETED)" : "(blocked)");
r = await as(admin, `insert into audit_log (org_id, actor_name, action, target_type)
                     values ($1,'Forged','user.created','profile') returning id`, [orgA]);
ok("nor forge an entry", !r.ok, r.ok ? "(FORGED)" : "(blocked)");

console.log("\n=== secrets never reach the log ===");
await c.query(
  `insert into audit_log (org_id, actor_name, action, target_type, before, after)
   values ($1,'Careless','user.pin_reset','profile',
           '{"pin":"1024","role":"driver"}'::jsonb,
           '{"pin_hash":"deadbeef","role":"admin"}'::jsonb)`, [orgA]);
const stored = (await c.query(
  `select before, after from audit_log where actor_name='Careless'`)).rows[0];
ok("a PIN passed by mistake is stripped", !("pin" in (stored.before ?? {})),
   JSON.stringify(stored.before));
ok("a PIN digest is stripped too", !("pin_hash" in (stored.after ?? {})),
   JSON.stringify(stored.after));
ok("the rest of the change is kept", stored.after?.role === "admin");

console.log("\n=== an inactive account reaches nothing ===");
await c.query(`update profiles set is_active=false where id=$1`, [manager]);
for (const table of ["products", "customers", "profiles", "audit_log"]) {
  const rr = await as(manager, `select count(*)::int n from ${table}`);
  const visible = rr.ok ? rr.rows[0].n : 0;
  // profiles allows a person to see their own row, which is by design.
  ok(`deactivated: ${table}`, table === "profiles" ? visible <= 1 : visible === 0, `(${visible})`);
}

console.log(`\n  ${pass} passed, ${fail} failed`);
await c.end();
process.exit(fail ? 1 : 0);
