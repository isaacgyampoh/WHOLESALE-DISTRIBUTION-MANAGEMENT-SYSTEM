/**
 * The supplier invoice portal, end to end, against production.
 *
 * A real supplier, a real token issued the way the application issues
 * one, the link opened with no session at all, a real PDF uploaded
 * through the form, and then checked in private storage and in the
 * admin's own view. Everything is removed afterwards.
 */
import { createRequire } from "node:module";
const require = createRequire(new URL("../visual/", import.meta.url));
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";

const R = new URL("../../", import.meta.url).pathname;
// A real PDF, written beside this file for the upload step.
const SP = new URL("./", import.meta.url).pathname;
const env = Object.fromEntries(readFileSync(R+".env.local","utf8").split("\n")
  .filter(l=>l.includes("=")&&!l.trimStart().startsWith("#"))
  .map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  {auth:{autoRefreshToken:false,persistSession:false}});
const BASE = process.env.PRODUCTION_URL ?? "https://wholesale-distribution-management-s-six.vercel.app";

let pass=0, fail=0;
const ok=(n,c,x="")=>{c?(pass++,console.log(`  PASS  ${n} ${x}`)):(fail++,console.log(`  FAIL  ${n} ${x}`))};
const head=(t)=>console.log(`\n=== ${t} ===`);

const stamp = Date.now().toString(36).slice(-5);
const { data: org } = await db.from("organizations").select("id, name").eq("slug","default").single();
const made = { suppliers: [], docs: [], tokens: [], paths: [] };

/** Issue a link exactly as issuePortalLinkAction does. */
async function issueToken(supplierId, days = 30) {
  const link = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(link).digest("hex");
  const { error } = await db.rpc("issue_supplier_token", {
    p_supplier_id: supplierId, p_token_hash: hash,
    p_token_hint: link.slice(0,6), p_days: days, p_label: "e2e test",
  });
  if (error) throw new Error("issue_supplier_token: " + error.message);
  return link;
}

const browser = await chromium.launch();
const consoleErrors = [], networkErrors = [];
const newPage = async (viewport = { width: 1280, height: 900 }) => {
  const ctx = await browser.newContext({ viewport });
  const p = await ctx.newPage();
  p.on("console", m => { if (m.type()==="error") consoleErrors.push(m.text().slice(0,140)); });
  p.on("response", r => { if (r.status()>=400) networkErrors.push(`${r.status()} ${r.url().replace(BASE,"").slice(0,80)}`); });
  return p;
};

try {
  head("a supplier and a link");
  const { data: supplier, error: sErr } = await db.from("suppliers").insert({
    org_id: org.id, code: `ZZS${stamp}`.slice(0,12), name: `ZZ Test Supplier ${stamp}`,
    contact_name: "Kwame Test", is_active: true,
  }).select("id, name, code").single();
  if (sErr) throw new Error("supplier: " + sErr.message);
  made.suppliers.push(supplier.id);
  ok("a supplier can be created", !!supplier);

  const token = await issueToken(supplier.id);
  ok("a portal link is issued", token.length > 30);

  const { data: stored } = await db.from("supplier_portal_tokens")
    .select("id, token_hash, token_hint, supplier_id, expires_at, revoked_at")
    .eq("supplier_id", supplier.id).single();
  made.tokens.push(stored.id);
  ok("only a digest of the link is stored",
     stored.token_hash === createHash("sha256").update(token).digest("hex")
     && !stored.token_hash.includes(token));
  ok("the stored row cannot reproduce the link", !JSON.stringify(stored).includes(token));
  ok("the link expires", Boolean(stored.expires_at));

  head("the supplier opens the link, with no account");
  const portalUrl = `${BASE}/portal/${token}`;
  const page = await newPage();
  // No cookies, no session: exactly what an external supplier has.
  const res = await page.goto(portalUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(()=>{});
  const body = await page.locator("body").innerText().catch(()=> "");
  ok("the portal loads for an unauthenticated visitor", res?.status() === 200, `status=${res?.status()}`);
  ok("it is not the sign-in page", !/Enter your 4-digit PIN/i.test(body));
  ok("it names the supplier", body.includes(supplier.name), body.slice(0,70));
  ok("it names the business", /GAB Premium Ent|Default Organization/i.test(body));
  ok("it offers to take an invoice", /invoice/i.test(body));
  ok("it shows an empty state rather than a blank page",
     /Nothing yet|No orders yet/i.test(body), body.replace(/\s+/g," ").slice(0,80));
  ok("search engines are told to stay away",
     (await page.locator('meta[name="robots"]').getAttribute("content").catch(()=>"") ?? "").includes("noindex"));

  head("the supplier uploads an invoice");
  const reference = `INV-${stamp}`;
  // By field name, not by a loose label match: "company", "contact" and
  // "date" all appear in more than one label on this page, and filling
  // the wrong one leaves a required field empty and the form refusing.
  await page.locator('input[name="company"]').fill(supplier.name);
  await page.locator('input[name="contact"]').fill("Kwame Test");
  await page.locator('input[name="reference"]').fill(reference);
  await page.locator('input[name="documentDate"]').fill("2026-08-20");
  await page.locator('input[name="amount"]').fill("1250.00");
  await page.locator('input[name="file"]').setInputFiles(SP + "invoice.pdf");

  const filled = {
    company: await page.locator('input[name="company"]').inputValue(),
    reference: await page.locator('input[name="reference"]').inputValue(),
    date: await page.locator('input[name="documentDate"]').inputValue(),
    amount: await page.locator('input[name="amount"]').inputValue(),
  };
  ok("the form accepts what the supplier types",
     Boolean(filled.company && filled.reference && filled.date && filled.amount),
     JSON.stringify(filled));

  let submitPosts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/portal/")) submitPosts++;
  });
  await page.getByRole("button", { name: /send|submit|upload/i }).first().click();

  // Polled, not guessed at: the upload is a file to storage and then a
  // row, and a fixed wait reports "no record" for a submission that was
  // merely still in flight.
  let doc = null;
  for (let i = 0; i < 20 && !doc; i++) {
    await page.waitForTimeout(1500);
    const { data } = await db.from("supplier_documents")
      .select("id, supplier_id, org_id, storage_path, file_name, status, kind, reference, amount")
      .eq("supplier_id", supplier.id).maybeSingle();
    doc = data ?? null;
  }

  ok("the form is actually submitted", submitPosts > 0, `${submitPosts} POST(s)`);

  // The portal lists what it has received, so the reference appearing on
  // the page is the supplier's own confirmation that it landed.
  const notice = await page.locator("body").innerText().catch(() => "");
  // Requires the words the action says on success. Testing for the
  // absence of known failures kept passing on failures I had not listed.
  ok("the invoice appears on the supplier's own page", notice.includes(reference),
     notice.replace(/\s+/g, " ").slice(0, 120) || "(nothing rendered)");
  ok("and nothing asked them to fix a field",
     !/check the fields|could not be sent|no longer valid/i.test(notice));
  if (doc) { made.docs.push(doc.id); made.paths.push(doc.storage_path); }
  ok("a document record is created", !!doc, doc ? "" : "no row in supplier_documents");
  ok("it belongs to this supplier and organisation",
     doc?.supplier_id === supplier.id && doc?.org_id === org.id);
  ok("it carries the reference the supplier gave", doc?.reference === reference, doc?.reference ?? "");
  ok("it starts awaiting review", ["received","pending","submitted"].includes(doc?.status ?? ""), doc?.status ?? "");

  head("the file is in private storage");
  const { data: listed } = await db.storage.from("supplier-documents")
    .list(doc?.storage_path?.split("/").slice(0,-1).join("/") ?? "", { limit: 20 });
  ok("the PDF is in the bucket",
     (listed ?? []).some(f => doc?.storage_path?.endsWith(f.name)), doc?.storage_path ?? "");

  const { data: bucket } = await db.storage.getBucket("supplier-documents");
  ok("the bucket is private", bucket?.public === false);

  // The decisive check: the public URL must not serve the file.
  const publicUrl = db.storage.from("supplier-documents").getPublicUrl(doc.storage_path).data.publicUrl;
  const anon = await fetch(publicUrl);
  ok("the file is not readable without authorisation", anon.status >= 400, `status=${anon.status}`);

  head("another supplier cannot reach it");
  const { data: other } = await db.from("suppliers").insert({
    org_id: org.id, code: `ZZO${stamp}`.slice(0,12), name: `ZZ Other Supplier ${stamp}`, is_active: true,
  }).select("id, name").single();
  made.suppliers.push(other.id);
  const otherToken = await issueToken(other.id);
  const { data: otherTok } = await db.from("supplier_portal_tokens")
    .select("id").eq("supplier_id", other.id).single();
  made.tokens.push(otherTok.id);

  const otherPage = await newPage();
  await otherPage.goto(`${BASE}/portal/${otherToken}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await otherPage.waitForLoadState("networkidle", { timeout: 15000 }).catch(()=>{});
  const otherBody = await otherPage.locator("body").innerText().catch(()=> "");
  ok("the other supplier sees their own portal", otherBody.includes(other.name));
  ok("and not the first supplier's name", !otherBody.includes(supplier.name));
  ok("and not the first supplier's invoice", !otherBody.includes(reference));
  await otherPage.context().close();

  head("a bad link gets nothing");
  const badPage = await newPage();
  const refusals = [];
  for (const [label, bad] of [
    ["a made-up link", randomBytes(32).toString("base64url")],
    ["a truncated link", token.slice(0, 20)],
  ]) {
    await badPage.goto(`${BASE}/portal/${bad}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    const t = await badPage.locator("body").innerText().catch(()=> "");
    ok(`${label} is refused`, /does not work/i.test(t), t.replace(/\s+/g," ").slice(0,60));
    refusals.push(t.replace(/\s+/g, " ").trim());
  }

  // Revoked must stop working immediately.
  await db.from("supplier_portal_tokens").update({ revoked_at: new Date().toISOString() })
    .eq("id", otherTok.id);
  await badPage.goto(`${BASE}/portal/${otherToken}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const revokedText = await badPage.locator("body").innerText().catch(()=> "");
  ok("a revoked link stops working at once", /does not work/i.test(revokedText),
     revokedText.replace(/\s+/g," ").slice(0,60));
  refusals.push(revokedText.replace(/\s+/g, " ").trim());

  // The point is not that the page avoids the word "expired" - it says
  // "may have expired or been replaced" deliberately, naming both so it
  // commits to neither. What matters is that a link that never existed,
  // one that was cut short, and one that was revoked are answered with
  // the same sentence, so the reply tells a guesser nothing about which
  // of those they are holding.
  ok("every kind of bad link is answered identically",
     new Set(refusals).size === 1,
     new Set(refusals).size === 1 ? "" : `${new Set(refusals).size} different messages`);
  await badPage.context().close();

  head("the portal on a phone");
  for (const [w,h,label] of [[360,740,"360"],[390,844,"390"],[430,932,"430"]]) {
    const m = await newPage({ width: w, height: h });
    await m.goto(portalUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await m.waitForLoadState("networkidle", { timeout: 15000 }).catch(()=>{});
    const overflow = await m.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    const fileVisible = await m.locator('input[type="file"]').count() > 0;
    ok(`the portal fits and can take a file at ${label}px`, !overflow && fileVisible,
       overflow ? "horizontal overflow" : fileVisible ? "" : "no file control");
    await m.context().close();
  }
  await page.context().close();
} catch (e) {
  fail++;
  console.log(`\n  FAIL  the run threw: ${e.message}`);
} finally {
  await browser.close();
  /*
   * Only what this run made, identified by id, and then only if it still
   * looks like this run's own fixture.
   *
   * An earlier version of this cleanup swept by code prefix. That is one
   * small step from sweeping everything, and while writing it I ran an
   * unguarded delete by hand against production and removed four real
   * suppliers. They were recoverable from audit_log, which was luck. A
   * test may delete what it created and nothing else, and it should be
   * unable to express anything wider.
   */
  for (const id of made.suppliers) {
    const { data: row } = await db.from("suppliers")
      .select("id, name, code").eq("id", id).maybeSingle();

    // Refuses rather than guesses. If this is not the row this run
    // inserted, something is wrong and leaving it is the safe error.
    if (!row) continue;
    if (!row.name.startsWith("ZZ ") || !row.code.startsWith("ZZ")) {
      console.log(`  REFUSED to remove ${row.code} ${row.name}: not this run's fixture`);
      continue;
    }

    const { data: docs } = await db.from("supplier_documents")
      .select("id, storage_path").eq("supplier_id", id);
    for (const d of docs ?? []) {
      await db.storage.from("supplier-documents").remove([d.storage_path]).catch(() => {});
      await db.from("supplier_documents").delete().eq("id", d.id);
    }
    await db.from("supplier_portal_tokens").delete().eq("supplier_id", id);
    const { error } = await db.from("suppliers").delete().eq("id", id);
    if (error) console.log(`  could not remove supplier ${row.code}: ${error.message}`);
  }

  const { count: sc } = await db.from("suppliers").select("id",{count:"exact",head:true});
  const { count: dc } = await db.from("supplier_documents").select("id",{count:"exact",head:true});
  const { count: tc } = await db.from("supplier_portal_tokens").select("id",{count:"exact",head:true});
  console.log(`\ntest data removed; suppliers=${sc??0} documents=${dc??0} tokens=${tc??0}`);
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
for (const e of [...new Set(consoleErrors)].slice(0,5)) console.log("  "+e);
console.log(`network errors: ${networkErrors.length}`);
for (const e of [...new Set(networkErrors)].slice(0,6)) console.log("  "+e);
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
