/**
 * Putting the database password into .env.local, without it going
 * anywhere it should not.
 *
 * Editing the line by hand goes wrong in three predictable ways: the
 * square brackets get left in place, a character such as `@` needs
 * URL-encoding and does not get it, or the editor simply does not save
 * and everything afterwards is a mystery.
 *
 * This asks for the password with the terminal echo off, encodes it
 * correctly, and writes only that one part of the line. It is never
 * printed, never logged, and never passed as an argument - so it does
 * not reach shell history either.
 *
 *   npm run db:set-password
 */
import { readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const file = path.join(root, ".env.local");

/** Read a line with the terminal not echoing what is typed. */
function askSecret(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error(
        "This needs an interactive terminal. Run it yourself:  npm run db:set-password"));
      return;
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(prompt);

    // Suppress the echo without losing the newline handling readline does.
    const onData = () => process.stdout.write("");
    const previouslyMuted = rl.output.muted;
    rl.output.muted = true;
    const write = rl.output.write.bind(rl.output);
    rl.output.write = (chunk, ...rest) => (rl.output.muted ? true : write(chunk, ...rest));
    process.stdin.on("data", onData);

    rl.question("", (answer) => {
      rl.output.muted = previouslyMuted;
      rl.output.write = write;
      process.stdin.off("data", onData);
      process.stdout.write("\n");
      rl.close();
      resolve(answer);
    });
  });
}

const raw = readFileSync(file, "utf8");
const lines = raw.split("\n");
const i = lines.findIndex((l) => l.startsWith("SUPABASE_DB_URL="));

if (i < 0) {
  console.error("SUPABASE_DB_URL is not in .env.local. Add the line first, then run this again.");
  process.exit(1);
}

const value = lines[i].slice(lines[i].indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");

let url;
try { url = new URL(value); }
catch { console.error("SUPABASE_DB_URL is not a valid URL. Fix the line, then run this again."); process.exit(1); }

console.log(`Host     ${url.hostname}:${url.port || 5432}`);
console.log(`User     ${url.username}`);
console.log(`Database ${url.pathname.slice(1) || "postgres"}`);
console.log("");
console.log("From Supabase: Settings -> Database -> Database password.");
console.log("Paste it below. It will not appear on screen.");
console.log("");

const password = (await askSecret("Password: ")).trim();

if (!password) {
  console.error("Nothing entered. Nothing changed.");
  process.exit(1);
}

if (/^\[.*\]$/.test(password) || /^%5B.*%5D$/i.test(password)) {
  console.error("That is still the placeholder, brackets and all. Paste the real password.");
  process.exit(1);
}

// encodeURIComponent handles every character that would otherwise break
// the URL - @ : / ? # [ ] % among them.
url.password = encodeURIComponent(password);
lines[i] = `SUPABASE_DB_URL=${url.toString()}`;

writeFileSync(file, lines.join("\n"));

console.log("");
console.log(`Written to .env.local (${statSync(file).mtime.toISOString()}).`);
console.log("Special characters were encoded automatically.");
console.log("");
console.log("Now check it:  npm run db:check");
