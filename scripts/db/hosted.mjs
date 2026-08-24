/**
 * Connecting to the hosted database.
 *
 * Reads SUPABASE_DB_URL from the environment or .env.local. The value is
 * never logged, and neither is any part of it.
 *
 * Two things about Supabase connections make this less trivial than
 * `new Client(url)`:
 *
 *   The direct host, `db.<ref>.supabase.co`, resolves to IPv6 only
 *   unless the project has the IPv4 add-on. Plenty of networks - this
 *   one included - have no route to it, and Node reports either
 *   ENOTFOUND or EHOSTUNREACH depending on how the resolver is
 *   configured. The Session Pooler is IPv4 and is what actually works.
 *
 *   The pooler needs the username in the form `postgres.<ref>`, and the
 *   ref is only in the hostname on the *direct* URL. Deriving it from
 *   the hostname breaks the moment somebody pastes a pooler URL, which
 *   is exactly what they are told to do.
 *
 * So the ref is taken from whichever part of the URL actually carries
 * it, and the direct host is retried over the pooler if it cannot be
 * reached.
 */
import { readFileSync } from "node:fs";
import { Resolver } from "node:dns/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const require = createRequire(import.meta.url);
const { Client } = require(path.join(root, "tests", "db", "node_modules", "pg"));

/** Pooler regions to try when the URL does not name one. */
const FALLBACK_POOLERS = ["aws-1-eu-west-1", "aws-0-eu-west-1"];

export function readEnv() {
  const fromShell = { ...process.env };
  try {
    const file = readFileSync(path.join(root, ".env.local"), "utf8");
    for (const line of file.split("\n")) {
      if (!line.includes("=") || line.trimStart().startsWith("#")) continue;
      const i = line.indexOf("=");
      const key = line.slice(0, i).trim();
      // The shell wins, so a one-off override does not need the file edited.
      if (fromShell[key] === undefined) {
        fromShell[key] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch { /* no .env.local; the shell is all there is */ }
  return fromShell;
}

/** The project ref, from wherever this URL happens to carry it. */
function projectRef(u) {
  const fromUser = u.username.includes(".") ? u.username.split(".").slice(1).join(".") : null;
  if (fromUser) return fromUser;
  if (/^db\./.test(u.hostname)) {
    return u.hostname.replace(/^db\./, "").replace(/\.supabase\.co$/, "");
  }
  return null;
}

/**
 * Connect, trying the URL as given and then the pooler.
 *
 * Returns { client, via } on success, or { client: null, failures } with
 * one line per attempt. Failure text is passed through unchanged - it
 * carries no credential, and the exact wording is the whole diagnosis:
 * "password authentication failed" and "tenant or user not found" mean
 * very different things.
 */
export async function connectHosted() {
  const env = readEnv();
  const url = env.SUPABASE_DB_URL;
  if (!url) {
    return { client: null, failures: ["SUPABASE_DB_URL is not set"] };
  }

  let u;
  try { u = new URL(url); }
  catch { return { client: null, failures: ["SUPABASE_DB_URL is not a valid URL"] }; }

  const ref = projectRef(u);
  const password = decodeURIComponent(u.password ?? "");
  const database = u.pathname.slice(1) || "postgres";

  if (/^\[.*\]$/.test(password)) {
    return {
      client: null,
      failures: ["the password is still the [YOUR-PASSWORD] placeholder from the template"],
    };
  }

  const attempts = [];

  // As given. If it is the direct host, resolve IPv6 explicitly - some
  // resolvers return nothing for it under the default family.
  let host = u.hostname;
  if (/^db\./.test(u.hostname)) {
    try {
      const [v6] = await new Resolver().resolve6(u.hostname);
      if (v6) host = v6;
    } catch { /* no AAAA record; use the name */ }
  }
  attempts.push({
    label: `as configured (${/pooler/.test(u.hostname) ? "pooler" : "direct"})`,
    host, port: Number(u.port || 5432), user: u.username, servername: u.hostname,
  });

  // The pooler, when the URL names the direct host.
  if (ref && !/pooler/.test(u.hostname)) {
    for (const region of FALLBACK_POOLERS) {
      attempts.push({
        label: `pooler ${region}`,
        host: `${region}.pooler.supabase.com`,
        port: 5432,
        user: `postgres.${ref}`,
        servername: `${region}.pooler.supabase.com`,
      });
    }
  }

  const failures = [];
  for (const a of attempts) {
    const client = new Client({
      host: a.host, port: a.port, user: a.user, password, database,
      ssl: { rejectUnauthorized: false, servername: a.servername },
      connectionTimeoutMillis: 10_000,
      statement_timeout: 300_000,
      query_timeout: 300_000,
    });
    try {
      await client.connect();
      return { client, via: a.label, failures };
    } catch (e) {
      failures.push(`${a.label}: ${e.message}`);
      try { await client.end(); } catch { /* already down */ }
    }
  }

  return { client: null, failures };
}

/** What to tell somebody whose connection did not work. */
export function explainFailure(failures) {
  const all = failures.join(" ").toLowerCase();
  if (all.includes("placeholder")) {
    return "The password has not been filled in. Settings -> Database -> Database password.";
  }
  if (all.includes("password authentication failed")) {
    return "The host and username are right and the project was found, but the password "
      + "was rejected. If it contains @ : / ? # [ ] or %, those need URL-encoding.";
  }
  if (all.includes("tenant or user not found")) {
    return "The pooler did not recognise this project. Check the region in the connection "
      + "string against Settings -> Database -> Connection string.";
  }
  if (all.includes("ehostunreach") || all.includes("enotfound")) {
    return "No route to the database host. The direct db.*.supabase.co host is IPv6-only; "
      + "use the Session Pooler connection string instead.";
  }
  return "See the attempts above.";
}
