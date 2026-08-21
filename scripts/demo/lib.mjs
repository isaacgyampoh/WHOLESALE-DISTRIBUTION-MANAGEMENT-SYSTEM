import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

/** Everything the demo creates is prefixed, so cleanup can be exact. */
export const DEMO_PREFIX = "DEMO-";
export const DEMO_ORG_SLUG = "gab-premium-ent-demo";
export const DEMO_ORG_NAME = "GAB Premium Ent — DEMO";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

export function loadEnv() {
  const file = path.join(repoRoot, ".env.local");
  if (!fs.existsSync(file)) {
    throw new Error(".env.local not found. Copy .env.example and fill in your Supabase values.");
  }
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

export function adminClient() {
  const env = loadEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY.startsWith("your-")) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required to seed or clean demo data.");
  }
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * The same digest the application computes. Kept in step with
 * src/lib/auth/pin-server.ts: an HMAC of the PIN under the server-side
 * pepper, so the seed writes a credential the app can verify and neither
 * side ever stores the PIN itself.
 */
export function digestPin(pin) {
  const env = loadEnv();
  const pepper = env.PIN_PEPPER;
  if (!pepper || pepper.length < 32) {
    throw new Error(
      "PIN_PEPPER must be set in .env.local before seeding, and must match " +
        "the value the application runs with. Generate one with: openssl rand -hex 32",
    );
  }
  return createHmac("sha256", pepper).update(pin).digest("hex");
}

/** Refuses to touch anything that is not the demo organization. */
export async function findDemoOrg(admin) {
  const { data } = await admin
    .from("organizations").select("id, name, slug").eq("slug", DEMO_ORG_SLUG).maybeSingle();
  return data ?? null;
}
