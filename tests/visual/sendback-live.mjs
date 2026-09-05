/**
 * The send-back button and dialog, on a round that is genuinely out.
 *
 * Read-only: it opens the page and the dialog and reads what is there.
 * Nothing is submitted, so no production quantity moves.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { createChunks } from "@supabase/ssr/dist/main/utils/chunker.js";
import fs from "node:fs"; import path from "node:path";

const ROOT = "/Users/isaacgyampoh/WHOLESALE-DISTRIBUTION-MANAGEMENT-SYSTEM";
const env = {};
for (const l of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
const BASE = "https://wholesale-distribution-management-s-six.vercel.app";
const url = env.NEXT_PUBLIC_SUPABASE_URL, ref = new URL(url).hostname.split(".")[0];
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: open } = await admin.from("van_loads")
  .select("id, load_number").eq("status", "dispatched").limit(1).single();
const { data: org } = await admin.from("organizations").select("id").limit(1).single();
const stamp = Date.now().toString(36), password = `Sb-${stamp}-Aa1!`;

async function look(role) {
  const email = `htest-sb-${role}-${stamp}@example.com`;
  const { data: made } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: `SB ${role}`, role, org_id: org.id } });
  const anon = createClient(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: sess } = await anon.auth.signInWithPassword({ email, password });
  const encoded = "base64-" + Buffer.from(JSON.stringify(sess.session), "utf8").toString("base64url");
  const cookies = createChunks(`sb-${ref}-auth-token`, encoded).map((ch) =>
    ({ name: ch.name, value: ch.value, domain: new URL(BASE).hostname, path: "/", secure: true, sameSite: "Lax" }));

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/loads/${open.id}`, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(2000);

  const button = page.getByRole("button", { name: /send stock back/i });
  const seen = await button.count() > 0;
  console.log(`  ${role.padEnd(12)} ${open.load_number}: send-back button ${seen ? "shown" : "hidden"}`);

  if (seen && role === "admin") {
    await button.first().click();
    await page.waitForTimeout(1200);
    const text = await page.locator("body").innerText();
    for (const [what, re] of [
      ["says it does not close the round", /does not close the round/i],
      ["names the round that stays out", new RegExp(open.load_number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")],
      ["offers a destination warehouse", /send it to/i],
      ["lists what is on the van", /on the van/i],
      ["asks why", /kept against every movement/i],
    ]) console.log(`  ${re.test(text) ? "present" : "MISSING"}  ${what}`);

    const fields = await page.locator('input[inputmode="numeric"]').evaluateAll(
      (els) => els.slice(0, 3).map((e) => e.getAttribute("aria-label")));
    console.log("  quantity fields: " + JSON.stringify(fields));
    await page.keyboard.press("Escape");
  }
  await browser.close();
  await admin.auth.admin.deleteUser(made.user.id);
}

await look("admin");
await look("salesperson");
console.log("  cleaned up");
