/**
 * Full visual audit: every reachable state at six viewports.
 *
 * Signs in against the hosted project and injects the session cookie the
 * way @supabase/ssr encodes it, so authenticated pages render exactly as
 * a user sees them. Test users are removed afterwards.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { createChunks } from "@supabase/ssr/dist/main/utils/chunker.js";
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "shots"); fs.mkdirSync(OUT, { recursive: true });
const env = {};
for (const l of fs.readFileSync(path.join(here, "..", "..", ".env.local"), "utf8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
const BASE = process.env.BASE || "http://localhost:3000";
const TAG = process.env.TAG || "";
const url = env.NEXT_PUBLIC_SUPABASE_URL, ref = new URL(url).hostname.split(".")[0];
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900, touch: false },
  { name: "1280x800", width: 1280, height: 800, touch: false },
  { name: "1024x768", width: 1024, height: 768, touch: true },
  { name: "768x1024", width: 768, height: 1024, touch: true },
  { name: "390x844", width: 390, height: 844, touch: true },
  { name: "375x812", width: 375, height: 812, touch: true },
];

const stamp = Date.now().toString(36), password = `Aud-${stamp}-Aa1!`;
const created = [];
const { data: org } = await admin.from("organizations").select("id").limit(1).single();

async function makeUser(role, name, active = true) {
  const email = `htest-aud-${role}-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: name, role, org_id: org.id },
  });
  if (error) throw new Error(`${role}: ${error.message}`);
  created.push(data.user.id);
  if (!active) await admin.from("profiles").update({ is_active: false }).eq("id", data.user.id);
  return email;
}
async function cookiesFor(email) {
  const c = createClient(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  const enc = "base64-" + Buffer.from(JSON.stringify(data.session), "utf8").toString("base64url");
  return createChunks(`sb-${ref}-auth-token`, enc)
    .map((x) => ({ name: x.name, value: x.value, domain: "localhost", path: "/" }));
}

/** Everything the eye would have to hunt for, measured instead. */
async function diagnose(page, label, vp) {
  const problems = await page.evaluate((vp) => {
    const out = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) {
      const bad = [...document.querySelectorAll("*")]
        .filter((el) => { const r = el.getBoundingClientRect(); return r.right > doc.clientWidth + 1 && r.width > 0; })
        .slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`);
      out.push(`horizontal overflow ${doc.scrollWidth}/${doc.clientWidth} [${bad.join(", ")}]`);
    }
    if (vp.touch) {
      const small = [...document.querySelectorAll("a,button,input,select,[role=tab]")]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.height > 0 && r.height < 44)
        .slice(0, 5)
        .map(({ el, r }) => `${el.tagName.toLowerCase()}"${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 14)}" ${Math.round(r.height)}px`);
      if (small.length) out.push(`touch<44px: ${small.join("; ")}`);
    }
    const clipped = [...document.querySelectorAll("h1,h2,h3,p,span,a,button,td,th,li")]
      .filter((el) => el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0)
      .slice(0, 4).map((el) => `${el.tagName.toLowerCase()}"${(el.textContent || "").trim().slice(0, 18)}"`);
    if (clipped.length) out.push(`clipped: ${clipped.join("; ")}`);
    // Content hidden behind the fixed bottom bar.
    const bar = document.querySelector('nav[aria-label="Primary"]');
    // getBoundingClientRect returns zeros for a display:none element, so
    // check the bar is actually laid out before comparing against it.
    if (bar && bar.getBoundingClientRect().height > 0) {
      const barTop = bar.getBoundingClientRect().top;
      const main = document.querySelector("main");
      if (main && main.scrollHeight - main.clientHeight <= 2) {
        const last = [...main.querySelectorAll("*")].pop();
        if (last) {
          const r = last.getBoundingClientRect();
          if (r.bottom > barTop && r.height > 0) out.push("content sits under the bottom bar with nothing to scroll");
        }
      }
    }
    // Headings should not skip levels.
    const levels = [...document.querySelectorAll("h1,h2,h3,h4")].map((h) => Number(h.tagName[1]));
    for (let i = 1; i < levels.length; i++) if (levels[i] - levels[i - 1] > 1) { out.push(`heading jumps h${levels[i-1]}->h${levels[i]}`); break; }
    return out;
  }, vp);
  return { label: `${label} @ ${vp.name}`, problems };
}

const findings = [];
const browser = await chromium.launch();

async function shot(page, name, vp) {
  await page.waitForLoadState("load");
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(OUT, `${TAG}${name}-${vp.name}.png`) });
}

try {
  const adminEmail = await makeUser("admin", "Ama Boateng");
  const driverEmail = await makeUser("driver", "Kojo Mensah");
  const pendingEmail = await makeUser("sales_rep", "Yaw Pending", false);
  const ck = { admin: await cookiesFor(adminEmail), driver: await cookiesFor(driverEmail), pending: await cookiesFor(pendingEmail) };

  for (const vp of VIEWPORTS) {
    const opts = { viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: vp.touch, isMobile: vp.touch };

    const anon = await browser.newContext(opts);
    const p = await anon.newPage();
    await p.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
    await shot(p, "signin", vp); findings.push(await diagnose(p, "sign-in", vp));
    await p.goto(`${BASE}/nope`, { waitUntil: "domcontentloaded" });
    await shot(p, "notfound", vp); findings.push(await diagnose(p, "not-found", vp));
    await anon.close();

    for (const [who, label] of [["admin", "dashboard-admin"], ["driver", "dashboard-driver"], ["pending", "pending"]]) {
      const c = await browser.newContext(opts);
      await c.addCookies(ck[who]);
      const pg = await c.newPage();
      await pg.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await shot(pg, label, vp); findings.push(await diagnose(pg, label, vp));
      if (vp.touch && who === "admin") {
        // The bottom bar is hidden from 1024px up, where the sidebar takes
        // over, so the control exists in the DOM but is not shown.
        const more = pg.locator('button[aria-label="More navigation"]');
        if (await more.count() && await more.isVisible()) {
          await more.click(); await pg.waitForTimeout(250);
          await shot(pg, "more-sheet", vp); findings.push(await diagnose(pg, "more-sheet", vp));
        }
      }
      await c.close();
    }
  }
} finally {
  await browser.close();
  for (const id of created) await admin.auth.admin.deleteUser(id);
  console.log(`removed ${created.length} test users\n`);
}

let any = false;
for (const f of findings) if (f.problems.length) { any = true; console.log(`  ${f.label}`); for (const x of f.problems) console.log(`     - ${x}`); }
if (!any) console.log("  no layout problems detected across " + findings.length + " renders");
else console.log(`\n  ${findings.filter(f=>f.problems.length).length} of ${findings.length} renders have findings`);
