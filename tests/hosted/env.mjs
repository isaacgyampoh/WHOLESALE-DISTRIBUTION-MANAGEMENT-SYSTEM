import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

/**
 * Reads .env.local from the repository root.
 *
 * Values are returned for use and never logged. Every diagnostic in this
 * suite reports presence only - "set" or "MISSING" - so a secret cannot
 * reach a terminal, a CI log or a report.
 */
export function loadEnv() {
  const file = path.join(repoRoot, ".env.local");
  if (!fs.existsSync(file)) {
    throw new Error(
      ".env.local not found at the repository root.\n" +
        "Copy .env.example to .env.local and fill in your Supabase values.",
    );
  }

  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const REQUIRED = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];
const PRIVILEGED = ["SUPABASE_SERVICE_ROLE_KEY"];

/**
 * True when a value is still the template placeholder. Checked by
 * substring, not prefix: the URL placeholder is a full https:// address
 * with "your-project-ref" inside it.
 */
export function isPlaceholder(value) {
  if (!value) return true;
  return /your-project-ref|your-anon-key|your-service-role-key|YOUR-PASSWORD|^your-/i.test(value);
}

/** Reports which variables are present. Never prints a value. */
export function reportEnvPresence(env) {
  const missing = [];
  for (const key of [...REQUIRED, ...PRIVILEGED]) {
    const present = Boolean(env[key] && env[key].length > 0 && !isPlaceholder(env[key]));
    console.log(`  ${present ? "set    " : "MISSING"}  ${key}`);
    if (!present && REQUIRED.includes(key)) missing.push(key);
  }
  return missing;
}

/** A project ref is not a secret, but the host is all we ever print. */
export function describeProject(env) {
  try {
    return new URL(env.NEXT_PUBLIC_SUPABASE_URL).host;
  } catch {
    return "(unparseable URL)";
  }
}
