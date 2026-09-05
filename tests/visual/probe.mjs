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
const { data: open } = await admin.from("van_loads").select("id").eq("status","dispatched").limit(1).single();
const { data: org } = await admin.from("organizations").select("id").limit(1).single();
const stamp = Date.now().toString(36), password = `Pr-${stamp}-Aa1!`;
const email = `htest-pr-${stamp}@example.com`;
const { data: made } = await admin.auth.admin.createUser({ email, password, email_confirm: true,
  user_metadata: { full_name: "Probe", role: "admin", org_id: org.id } });
const anon = createClient(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: sess } = await anon.auth.signInWithPassword({ email, password });
const encoded = "base64-" + Buffer.from(JSON.stringify(sess.session), "utf8").toString("base64url");
const cookies = createChunks(`sb-${ref}-auth-token`, encoded).map((ch) =>
  ({ name: ch.name, value: ch.value, domain: new URL(BASE).hostname, path: "/", secure: true, sameSite: "Lax" }));
const browser = await chromium.launch();
const ctx = await browser.newContext(); await ctx.addCookies(cookies);
const page = await ctx.newPage();
await page.goto(`${BASE}/loads/${open.id}`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(2500);
const t = await page.locator("body").innerText();
console.log("  'Top up van' on page:      " + /top up van/i.test(t));
console.log("  'Send stock back' on page: " + /send stock back/i.test(t));
console.log("  remaining column present:  " + /remaining/i.test(t));
const buttons = await page.locator("button").evaluateAll((els) => els.map((e) => e.textContent.trim()).filter(Boolean).slice(0, 10));
console.log("  buttons: " + JSON.stringify(buttons));
console.log("  --- page ---");
console.log((await page.locator("body").innerText()).split("\n").filter(Boolean).slice(0, 26).map((l) => "    " + l).join("\n"));
const rows = await page.locator("table tr").evaluateAll(
  (els) => els.slice(0, 4).map((e) => e.innerText.replace(/\s+/g, " ").trim()));
console.log("  table:");
rows.forEach((r) => console.log("    " + r));
await browser.close(); await admin.auth.admin.deleteUser(made.user.id);
