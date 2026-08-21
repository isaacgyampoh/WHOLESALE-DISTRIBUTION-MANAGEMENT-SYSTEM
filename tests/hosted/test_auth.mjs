/**
 * Phase 5A authentication verification, against the hosted project.
 *
 * Exercises GoTrue and PostgREST as the browser does: sign in, session,
 * profile resolution, tenant scoping, sign out. Creates one temporary
 * user and removes it again; no business data is touched.
 *
 *   node test_auth.mjs [--keep]
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnv, isPlaceholder } from "./env.mjs";

const env = loadEnv();
const KEEP = process.argv.includes("--keep");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

if (isPlaceholder(env.SUPABASE_SERVICE_ROLE_KEY)) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is required to create and remove the test user.");
  process.exit(1);
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
/** A fresh client with the public anon key, exactly like the browser. */
const browser = () =>
  createClient(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const stamp = Date.now().toString(36);
const email = `htest-auth-${stamp}@example.com`;
const password = `Htest-${stamp}-Aa1!`;
let userId = null;

try {
  const { data: org } = await admin.from("organizations").select("id, name").limit(1).single();
  ok("an organization exists to attach the user to", Boolean(org?.id), `(${org?.name})`);

  console.log("\n=== account provisioning ===");
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: "Phase 5A Test", role: "admin", org_id: org.id },
  });
  ok("user created via Auth admin API", !createErr && Boolean(created?.user?.id),
     createErr ? `-> ${createErr.message}` : "");
  userId = created?.user?.id ?? null;

  const { data: profile } = await admin
    .from("profiles").select("id, role, org_id, is_active, full_name").eq("id", userId).single();
  ok("signup trigger created the profile", Boolean(profile), profile ? `(role=${profile.role})` : "");
  ok("organization taken from metadata, not the browser", profile?.org_id === org.id);
  ok("profile is active", profile?.is_active === true);

  console.log("\n=== sign in ===");
  const c = browser();
  const { data: signIn, error: signInErr } = await c.auth.signInWithPassword({ email, password });
  ok("valid credentials accepted", !signInErr && Boolean(signIn?.session),
     signInErr ? `-> ${signInErr.message}` : "");
  ok("session carries an access token", Boolean(signIn?.session?.access_token));
  ok("session carries a refresh token", Boolean(signIn?.session?.refresh_token));
  const expiresIn = signIn?.session?.expires_in ?? 0;
  ok("session has an expiry", expiresIn > 0, `(${expiresIn}s)`);

  console.log("\n=== the server resolves the caller ===");
  const { data: who } = await c.auth.getUser();
  ok("getUser returns the signed-in user", who?.user?.id === userId);

  const { data: myProfile, error: profErr } = await c
    .from("profiles").select("id, role, org_id, full_name").eq("id", userId).single();
  ok("caller can read their own profile through RLS", !profErr && Boolean(myProfile),
     profErr ? `-> ${profErr.message.slice(0, 44)}` : `(role=${myProfile?.role})`);
  ok("resolved organization matches", myProfile?.org_id === org.id);

  console.log("\n=== authenticated data access ===");
  const { data: products, error: prodErr } = await c.from("products").select("sku").limit(5);
  ok("signed-in admin can read the catalogue", !prodErr,
     prodErr ? `-> ${prodErr.message.slice(0, 46)}` : `(${(products ?? []).length} rows)`);

  const { data: views, error: viewErr } = await c.from("stock_summary").select("sku").limit(3);
  ok("signed-in admin can read reporting views", !viewErr,
     viewErr ? `-> ${viewErr.message.slice(0, 46)}` : `(${(views ?? []).length} rows)`);

  console.log("\n=== tenant scoping ===");
  const { data: allOrgs } = await c.from("organizations").select("id");
  ok("caller sees only their own organization", (allOrgs ?? []).length === 1,
     `(${(allOrgs ?? []).length} visible)`);

  console.log("\n=== invalid credentials ===");
  const bad = await browser().auth.signInWithPassword({ email, password: "definitely-wrong" });
  ok("wrong password rejected", Boolean(bad.error), bad.error ? `-> ${bad.error.message}` : "");
  const noUser = await browser().auth.signInWithPassword({
    email: `nobody-${stamp}@example.com`, password,
  });
  ok("unknown account rejected", Boolean(noUser.error));
  ok("both failures give the same message (no account enumeration)",
     bad.error?.message === noUser.error?.message,
     `("${bad.error?.message}")`);

  console.log("\n=== sign out ===");
  await c.auth.signOut();
  const { data: after } = await c.auth.getSession();
  ok("local session cleared", !after?.session);
  const { data: post } = await c.from("products").select("sku").limit(1);
  ok("reads return nothing after sign out", (post ?? []).length === 0,
     `(${(post ?? []).length} rows)`);
} catch (error) {
  console.error(`\nAborted: ${error.message}`);
  fail++;
} finally {
  if (userId && !KEEP) {
    await admin.auth.admin.deleteUser(userId);
    const { data: gone } = await admin.from("profiles").select("id").eq("id", userId);
    console.log(`\n  test user removed (${(gone ?? []).length === 0 ? "profile cascaded" : "profile REMAINS"})`);
  }
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
