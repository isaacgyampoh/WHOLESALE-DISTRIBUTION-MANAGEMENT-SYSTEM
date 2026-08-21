/**
 * Phase 5A end-to-end check of the running application.
 *
 * Signs in against hosted Supabase, builds the session cookie the way
 * @supabase/ssr does, and requests the protected shell over HTTP. This
 * proves the whole path: GoTrue -> cookie -> proxy -> server component ->
 * profile resolution under RLS -> rendered navigation.
 *
 *   npm start   (in another shell, or already running)
 *   node test_shell.mjs [--base http://localhost:3000]
 */
import { createClient } from "@supabase/supabase-js";
import { createChunks } from "@supabase/ssr/dist/main/utils/chunker.js";
import { loadEnv, isPlaceholder } from "./env.mjs";

const env = loadEnv();
const baseArg = process.argv.indexOf("--base");
const BASE = baseArg > -1 ? process.argv[baseArg + 1] : "http://localhost:3000";

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

if (isPlaceholder(env.SUPABASE_SERVICE_ROLE_KEY)) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is required to provision the test user.");
  process.exit(1);
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const projectRef = new URL(url).hostname.split(".")[0];
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Reproduce the cookie @supabase/ssr writes for a session. */
function sessionCookies(session) {
  const key = `sb-${projectRef}-auth-token`;
  const encoded =
    "base64-" + Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  return createChunks(key, encoded)
    .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
    .join("; ");
}

const stamp = Date.now().toString(36);
const password = `Htest-${stamp}-Aa1!`;
const users = [];

async function makeUser(role, label) {
  const email = `htest-shell-${role}-${stamp}@example.com`;
  const { data: org } = await admin.from("organizations").select("id").limit(1).single();
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: label, role, org_id: org.id },
  });
  if (error) throw new Error(`${role}: ${error.message}`);
  users.push(data.user.id);
  return email;
}

async function signedInGet(email, path) {
  const c = createClient(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign in failed: ${error.message}`);
  const res = await fetch(`${BASE}${path}`, {
    headers: { cookie: sessionCookies(data.session) },
    redirect: "manual",
  });
  return { status: res.status, body: await res.text(), location: res.headers.get("location") };
}

try {
  // Confirm the server under test is actually up.
  const probe = await fetch(`${BASE}/sign-in`, { redirect: "manual" });
  ok("application is serving", probe.status === 200, `(${BASE})`);

  console.log("\n=== anonymous ===");
  const anonRes = await fetch(`${BASE}/`, { redirect: "manual" });
  ok("protected shell redirects anonymous users", anonRes.status === 307 || anonRes.status === 302,
     `(HTTP ${anonRes.status} -> ${anonRes.headers.get("location")})`);

  console.log("\n=== signed in as admin ===");
  const adminEmail = await makeUser("admin", "Shell Admin");
  const a = await signedInGet(adminEmail, "/");
  ok("admin reaches the shell", a.status === 200, `(HTTP ${a.status})`);
  ok("page renders the signed-in user", a.body.includes("Shell Admin"));
  ok("role is shown in the header", a.body.includes("Administrator"));
  ok("dashboard heading rendered", /Good day/.test(a.body));
  for (const label of ["Products", "Warehouses", "Customers", "Vans", "Reports", "Users"]) {
    ok(`admin navigation includes ${label}`, a.body.includes(`>${label}<`));
  }

  console.log("\n=== signed in as driver ===");
  const driverEmail = await makeUser("driver", "Shell Driver");
  const d = await signedInGet(driverEmail, "/");
  ok("driver reaches the shell", d.status === 200, `(HTTP ${d.status})`);
  ok("page renders the driver", d.body.includes("Shell Driver"));
  ok("role is shown as Driver", d.body.includes(">Driver<"));
  ok("driver sees their own round, not admin tiles",
     d.body.includes("No van assigned") || d.body.includes("Stock on board"));
  ok("driver navigation excludes Users", !d.body.includes(">Users<"));
  ok("driver navigation excludes Warehouses", !d.body.includes(">Warehouses<"));
  ok("driver navigation excludes Purchasing", !d.body.includes(">Purchasing<"));
  ok("driver navigation includes Customers", d.body.includes(">Customers<"));

  console.log("\n=== signed in as accountant ===");
  const acctEmail = await makeUser("accountant", "Shell Accountant");
  const ac = await signedInGet(acctEmail, "/");
  ok("accountant reaches the shell", ac.status === 200, `(HTTP ${ac.status})`);
  ok("accountant navigation excludes Users", !ac.body.includes(">Users<"));
  ok("accountant navigation includes Payments", ac.body.includes(">Payments<"));

  console.log("\n=== session integrity ===");
  const tampered = await fetch(`${BASE}/`, {
    headers: { cookie: `sb-${projectRef}-auth-token=base64-bm90LWEtc2Vzc2lvbg` },
    redirect: "manual",
  });
  ok("a forged session cookie does not grant access",
     tampered.status === 307 || tampered.status === 302,
     `(HTTP ${tampered.status})`);
} catch (error) {
  console.error(`\nAborted: ${error.message}`);
  fail++;
} finally {
  for (const id of users) await admin.auth.admin.deleteUser(id);
  console.log(`\n  removed ${users.length} test user(s)`);
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
