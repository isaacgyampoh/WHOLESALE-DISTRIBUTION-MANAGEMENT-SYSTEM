/**
 * Renders the application in Chromium at real viewports and saves
 * screenshots for review.
 *
 * Signs in against the hosted project and injects the session cookie the
 * way @supabase/ssr encodes it, so authenticated pages render exactly as
 * a user would see them. Test users are removed afterwards.
 *
 *   npm start   (in another shell)
 *   node capture.mjs
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { createChunks } from "@supabase/ssr/dist/main/utils/chunker.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "shots");
fs.mkdirSync(OUT, { recursive: true });

// Read .env.local from the repository root without printing anything.
const envFile = path.join(here, "..", "..", ".env.local");
const env = {};
for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

const BASE = process.env.BASE || "http://localhost:3000";
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const projectRef = new URL(url).hostname.split(".")[0];
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const stamp = Date.now().toString(36);
const password = `Vis-${stamp}-Aa1!`;
const created = [];

async function makeUser(role, fullName) {
  const email = `htest-vis-${role}-${stamp}@example.com`;
  const { data: org } = await admin.from("organizations").select("id").limit(1).single();
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: fullName, role, org_id: org.id },
  });
  if (error) throw new Error(`${role}: ${error.message}`);
  created.push(data.user.id);
  return email;
}

async function cookiesFor(email) {
  const c = createClient(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  const key = `sb-${projectRef}-auth-token`;
  const encoded = "base64-" + Buffer.from(JSON.stringify(data.session), "utf8").toString("base64url");
  return createChunks(key, encoded).map((ch) => ({
    name: ch.name, value: ch.value, domain: "localhost", path: "/",
  }));
}

/**
 * touch matters, and not only for the screenshots.
 *
 * The interface sizes its controls with the pointer-fine: variant - a
 * 44px tap target on a touch screen, tighter where there is a mouse.
 * Without hasTouch every viewport here reported as a fine pointer, the
 * tighter rule applied, and diagnose() then complained that the touch
 * targets were too small on tablet and mobile. They were not: the
 * browser simply was not a touch device. A check that cries wolf on
 * every run is worse than no check, because the real finding is the one
 * that gets scrolled past.
 */
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900, touch: false },
  { name: "tablet", width: 834, height: 1112, touch: true },
  { name: "mobile", width: 390, height: 844, touch: true },
];

const browser = await chromium.launch();
const shots = [];

/** Waits for the page to be painted rather than for the network to idle:
 *  the Supabase client keeps a connection open, so networkidle never fires. */
async function settle(page) {
  await page.waitForLoadState("load");
  await page.waitForTimeout(400);
  await page.evaluate(() => document.fonts?.ready);
}

async function shoot(label, viewport, page) {
  await settle(page);
  const file = path.join(OUT, `${label}-${viewport.name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  shots.push(path.relative(process.cwd(), file));
}

/** Reports layout problems the eye would have to hunt for. */
async function diagnose(page, label, viewport) {
  return page.evaluate(({ label, viewport }) => {
    const problems = [];
    const doc = document.documentElement;

    if (doc.scrollWidth > doc.clientWidth + 1) {
      const offenders = [...document.querySelectorAll("*")]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.right > doc.clientWidth + 1 && r.width > 0;
        })
        .slice(0, 4)
        .map((el) => `${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]}`);
      problems.push(`horizontal overflow: ${doc.scrollWidth}px in ${doc.clientWidth}px [${offenders.join(", ")}]`);
    }

    // Touch targets below 44px on a touch-sized viewport.
    if (viewport.width <= 834) {
      const small = [...document.querySelectorAll("a, button, [role=button]")]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 32))
        .slice(0, 6)
        .map(({ el, r }) =>
          `${el.tagName.toLowerCase()}"${(el.textContent || "").trim().slice(0, 18)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      if (small.length) problems.push(`small touch targets: ${small.join("; ")}`);
    }

    // Text clipped by its own box.
    const clipped = [...document.querySelectorAll("h1,h2,h3,p,span,a,button,td,th,li")]
      .filter((el) => el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0)
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}"${(el.textContent || "").trim().slice(0, 20)}"`);
    if (clipped.length) problems.push(`clipped text: ${clipped.join("; ")}`);

    return { label: `${label}-${viewport.name}`, problems };
  }, { label, viewport });
}

const findings = [];

try {
  const adminEmail = await makeUser("admin", "Ama Boateng");
  const driverEmail = await makeUser("driver", "Kojo Mensah");
  const adminCookies = await cookiesFor(adminEmail);
  const driverCookies = await cookiesFor(driverEmail);

  for (const viewport of VIEWPORTS) {
    // Public pages, no session.
    const anon = await browser.newContext({ viewport, deviceScaleFactor: 2,
      hasTouch: viewport.touch, isMobile: viewport.touch });
    const p1 = await anon.newPage();
    await p1.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
    await shoot("signin", viewport, p1);
    findings.push(await diagnose(p1, "signin", viewport));

    await p1.goto(`${BASE}/does-not-exist`, { waitUntil: "domcontentloaded" });
    await shoot("notfound", viewport, p1);
    await anon.close();

    // Admin dashboard.
    const adm = await browser.newContext({ viewport, deviceScaleFactor: 2,
      hasTouch: viewport.touch, isMobile: viewport.touch });
    await adm.addCookies(adminCookies);
    const p2 = await adm.newPage();
    await p2.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await shoot("dashboard-admin", viewport, p2);
    findings.push(await diagnose(p2, "dashboard-admin", viewport));

    // The "More" sheet on phones.
    if (viewport.width <= 834) {
      const more = p2.locator('button[aria-label="More navigation"]');
      if (await more.count()) {
        await more.click();
        await p2.waitForTimeout(250);
        await shoot("mobile-more-sheet", viewport, p2);
        findings.push(await diagnose(p2, "more-sheet", viewport));
      }
    }
    await adm.close();

    // Driver dashboard.
    const drv = await browser.newContext({ viewport, deviceScaleFactor: 2,
      hasTouch: viewport.touch, isMobile: viewport.touch });
    await drv.addCookies(driverCookies);
    const p3 = await drv.newPage();
    await p3.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await shoot("dashboard-driver", viewport, p3);
    findings.push(await diagnose(p3, "dashboard-driver", viewport));
    await drv.close();
  }

  // Dark mode, desktop only, to check the token set.
  const dark = await browser.newContext({
    viewport: VIEWPORTS[0], deviceScaleFactor: 2, colorScheme: "dark",
    hasTouch: VIEWPORTS[0].touch, isMobile: VIEWPORTS[0].touch,
  });
  await dark.addCookies(adminCookies);
  const p4 = await dark.newPage();
  await p4.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await shoot("dashboard-admin-dark", { name: "dark" }, p4);
  await p4.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
  await shoot("signin-dark", { name: "dark" }, p4);
  await dark.close();
} finally {
  await browser.close();
  for (const id of created) await admin.auth.admin.deleteUser(id);
  console.log(`removed ${created.length} test user(s)\n`);
}

console.log("screenshots:");
for (const s of shots) console.log("  " + s);
console.log("\nautomated layout findings:");
let any = false;
for (const f of findings) {
  if (f.problems.length) {
    any = true;
    console.log(`  ${f.label}:`);
    for (const p of f.problems) console.log(`     - ${p}`);
  }
}
if (!any) console.log("  none detected by the automated pass");
