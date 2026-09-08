/**
 * Opening a session against the deployed site.
 *
 * WHY THIS EXISTS
 *
 * Staff sign in with a four-digit PIN and nothing else. The digest is
 * peppered with PIN_PEPPER, which is marked Sensitive on Vercel and
 * cannot be read back - so a test running here writes a digest with the
 * local pepper, production hashes with a different one, and the site
 * correctly refuses. There is no way round that, and there should not
 * be: the whole point of a sensitive secret is that it does not leave.
 *
 * Setting a real person's PIN from local tooling would "fix" it and
 * lock that person out of their own account, because the digest written
 * here is one production cannot verify. Never do that.
 *
 * The consequence was that three production suites failed at their
 * first step and never checked anything behind sign-in - sixteen
 * screens, the stock count, the whole staff flow - on every run. A test
 * that always fails is worse than no test: the real finding is the one
 * that gets scrolled past.
 *
 * So the PIN form is still driven, because whether it submits and
 * reaches the server is worth knowing and is checkable without the
 * pepper. When the server refuses the digest, the session is opened
 * instead with a password on the same temporary account and encoded the
 * way @supabase/ssr stores it - which is exactly what the browser holds
 * after a real sign-in. What is being tested behind that point is
 * whether the deployed site renders the real database, and that does
 * not depend on how the session was opened.
 *
 * Only ever on accounts this test made. Nothing here touches a real
 * person's credentials.
 */
import { createRequire } from "node:module";
const require = createRequire(new URL("../visual/", import.meta.url));
const { createClient } = require("@supabase/supabase-js");
const { createChunks } = require("@supabase/ssr/dist/main/utils/chunker.js");

/** A password strong enough for the project's policy, unique per run. */
export function testPassword(stamp) {
  return `Prod-${stamp}-Aa1!`;
}

/**
 * Sign in by password and put the session in the browser context as the
 * cookie the application reads. Returns true if the page is then inside
 * the application rather than back at sign-in.
 */
export async function openSessionByPassword({ env, base, ctx, page, email, password }) {
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: error.message };

  const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const encoded = "base64-"
    + Buffer.from(JSON.stringify(data.session), "utf8").toString("base64url");
  await ctx.addCookies(createChunks(`sb-${ref}-auth-token`, encoded).map((c) => ({
    name: c.name, value: c.value, domain: new URL(base).hostname, path: "/",
  })));

  await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  return { ok: !page.url().includes("sign-in"), url: page.url() };
}

/**
 * Whether the server saw a sign-in attempt since a given moment.
 *
 * A recorded attempt is the server saying "I read this PIN and
 * disagreed with the digest" - the pepper. Nothing recorded means the
 * form never submitted, which is a real fault and the one worth
 * catching.
 */
export async function serverSawAttempt(db, since) {
  const { data } = await db
    .from("auth_pin_attempts").select("attempted_at").gte("attempted_at", since).limit(1);
  return (data ?? []).length > 0;
}
