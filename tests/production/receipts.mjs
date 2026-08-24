/**
 * Receipts, as a customer receives them, against production.
 *
 * A real sale and a real credit payment, real links issued the way the
 * application issues them, opened with no session at all, and the PDF
 * fetched and checked for the figures it should carry and the ones it
 * must not. Everything is removed afterwards.
 */
import { createRequire } from "node:module";
const require = createRequire(new URL("../visual/", import.meta.url));
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";

const R = new URL("../../", import.meta.url).pathname;
const env = Object.fromEntries(
  readFileSync(R + ".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

const BASE = process.env.PRODUCTION_URL
  ?? "https://wholesale-distribution-management-s-six.vercel.app";
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };
const head = (t) => console.log(`\n=== ${t} ===`);

const stamp = Date.now().toString(36).slice(-5);
const digest = (t) => createHash("sha256").update(t).digest("hex");
const made = { customers: [], sales: [], products: [], categories: [], warehouses: [], vans: [], loads: [], txns: [] };

const { data: org } = await db.from("organizations").select("id, name").eq("slug", "default").single();
const { data: staff } = await db.from("profiles").select("id, full_name").limit(1).single();

/** Mint a link the way issueReceipt does. */
async function issue(kind, subjectId, phone) {
  const token = randomBytes(32).toString("base64url");
  const { error } = await db.rpc("issue_receipt_token", {
    p_subject_type: kind, p_subject_id: subjectId,
    p_token_hash: digest(token), p_token_hint: token.slice(0, 6),
    p_phone: phone, p_days: 180,
  });
  if (error) throw new Error(`issue_receipt_token: ${error.message}`);
  return token;
}

const browser = await chromium.launch();
const consoleErrors = [], networkErrors = [];
const newPage = async (viewport = { width: 390, height: 844 }) => {
  const ctx = await browser.newContext({ viewport });
  const p = await ctx.newPage();
  p.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 140)); });
  p.on("response", (r) => { if (r.status() >= 400) networkErrors.push(`${r.status()} ${r.url().replace(BASE, "").slice(0, 70)}`); });
  return p;
};

try {
  head("a sale to make a receipt for");
  const { data: customer } = await db.from("customers").insert({
    org_id: org.id, code: `ZZC${stamp}`.slice(0, 12), name: `ZZ Receipt Customer ${stamp}`,
    phone: "+233241110009", is_active: true,
  }).select("id, name, phone").single();
  made.customers.push(customer.id);

  const { data: cat } = await db.from("categories")
    .insert({ org_id: org.id, name: `ZZ Cat ${stamp}`, is_active: true }).select("id").single();
  made.categories.push(cat.id);

  const { data: product } = await db.from("products").insert({
    org_id: org.id, sku: `ZZP-${stamp}`, name: `ZZ Malta ${stamp}`,
    unit_of_measure: "piece", list_price: 12.5, cost_price: 7.25,
    category_id: cat.id, is_active: true,
  }).select("id").single();
  made.products.push(product.id);

  const { data: wh } = await db.from("warehouses")
    .insert({ org_id: org.id, code: `ZZW${stamp}`.slice(0, 10), name: `ZZ Depot ${stamp}`, is_active: true })
    .select("id").single();
  made.warehouses.push(wh.id);

  const { data: van } = await db.from("vans").insert({
    org_id: org.id, code: `ZZV${stamp}`.slice(0, 10), registration_no: `GR-${stamp}`, is_active: true,
  }).select("id").single();
  made.vans.push(van.id);

  const { data: load } = await db.from("van_loads").insert({
    org_id: org.id, van_id: van.id, driver_id: staff.id, warehouse_id: wh.id, status: "loaded",
  }).select("id").single();
  made.loads.push(load.id);

  // A credit sale: partly paid, so the receipt has to show both figures.
  const { data: sale, error: saleErr } = await db.from("van_sales").insert({
    org_id: org.id, load_id: load.id, van_id: van.id, driver_id: staff.id,
    salesperson_id: staff.id, customer_id: customer.id,
    sale_type: "credit", status: "completed",
    subtotal: 25.0, tax_total: 0, total: 25.0, amount_paid: 10.0,
  }).select("id, sale_number").single();
  if (saleErr) throw new Error(`sale: ${saleErr.message}`);
  made.sales.push(sale.id);

  await db.from("van_sale_items").insert({
    org_id: org.id, sale_id: sale.id, product_id: product.id, quantity: 2, unit_price: 12.5,
  });
  await db.from("van_sale_payments").insert({
    org_id: org.id, sale_id: sale.id, method: "cash", amount: 10.0,
  });
  ok("a credit sale exists to receipt", Boolean(sale.id));

  head("the customer opens their receipt, with no account");
  const token = await issue("sale", sale.id, customer.phone);
  const url = `${BASE}/receipt/${token}`;
  const page = await newPage();
  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  const body = await page.locator("body").innerText().catch(() => "");

  ok("the receipt loads for a visitor with no session", res?.status() === 200, `status=${res?.status()}`);
  ok("it is not the sign-in page", !/Enter your 4-digit PIN/i.test(body));
  ok("it names the business", body.includes(org.name) || /GAB Premium Ent/i.test(body));
  ok("it names the customer", body.includes(customer.name));
  ok("it shows the total", body.includes("25.00"));
  ok("it shows what is still owed", /Outstanding/i.test(body) && body.includes("15.00"));
  ok("it lists what was bought", body.includes(`ZZ Malta ${stamp}`));
  ok("search engines are told to stay away",
     (await page.locator('meta[name="robots"]').getAttribute("content").catch(() => "") ?? "")
       .includes("noindex"));

  head("nothing on the receipt belongs to the business alone");
  ok("no cost price", !body.includes("7.25"));
  ok("no margin or profit wording", !/margin|profit|cost price/i.test(body));
  ok("no supplier", !/supplier/i.test(body));
  ok("no internal identifiers",
     !body.includes(sale.id) && !body.includes(customer.id) && !body.includes(org.id));

  head("the receipt as a file");
  const pdfRes = await page.request.get(`${url}/pdf`);
  const pdf = Buffer.from(await pdfRes.body());
  ok("the PDF is served", pdfRes.status() === 200, `status=${pdfRes.status()}`);
  ok("it is really a PDF", pdf.subarray(0, 5).toString() === "%PDF-", pdf.subarray(0, 8).toString());
  ok("it is not blank", pdf.length > 900, `${pdf.length} bytes`);
  ok("it is served for the phone to open", /application\/pdf/.test(pdfRes.headers()["content-type"] ?? ""));
  ok("it is never cached by anything in between",
     /no-store/.test(pdfRes.headers()["cache-control"] ?? ""),
     pdfRes.headers()["cache-control"] ?? "(none)");

  // The text is compressed inside the PDF, so the figures are checked
  // where they are readable: the page that produced it, plus the file's
  // own size and header above.
  ok("the file is named after the receipt",
     /filename="receipt-RCP-/.test(pdfRes.headers()["content-disposition"] ?? ""),
     pdfRes.headers()["content-disposition"] ?? "");
  await page.context().close();

  head("a credit payment gets its own receipt");
  await db.from("credit_transactions").insert({
    org_id: org.id, customer_id: customer.id, type: "charge", amount: 500,
    reference_type: "invoice", created_by: staff.id,
  });
  const { data: payment } = await db.from("credit_transactions").insert({
    org_id: org.id, customer_id: customer.id, type: "payment", amount: -200,
    reference_type: "momo", created_by: staff.id, notes: "Part payment",
  }).select("id").single();
  made.txns.push(payment.id);

  const payToken = await issue("credit_payment", payment.id, customer.phone);
  const payPage = await newPage();
  await payPage.goto(`${BASE}/receipt/${payToken}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await payPage.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  const payBody = await payPage.locator("body").innerText().catch(() => "");

  ok("the payment receipt loads", payBody.includes(customer.name));
  ok("it says what was received", /Payment received/i.test(payBody) && payBody.includes("200.00"));
  ok("it says what was owed before", /Previous balance/i.test(payBody) && payBody.includes("500.00"));
  ok("it says what is still owed", /Remaining balance/i.test(payBody) && payBody.includes("300.00"));
  // The distinction the specification is emphatic about.
  ok("it does not call the remainder paid",
     !/remaining.{0,12}paid|paid.{0,12}300/i.test(payBody.replace(/\s+/g, " ")));

  const payPdf = await payPage.request.get(`${BASE}/receipt/${payToken}/pdf`);
  ok("the payment PDF is served", payPdf.status() === 200);
  ok("it is named as a payment",
     /filename="payment-RCP-/.test(payPdf.headers()["content-disposition"] ?? ""),
     payPdf.headers()["content-disposition"] ?? "");
  await payPage.context().close();

  head("a link reaches one receipt and no other");
  const bad = await newPage();
  for (const [label, candidate] of [
    ["a made-up link", randomBytes(32).toString("base64url")],
    ["a truncated link", token.slice(0, 24)],
    ["a link with one character changed",
     token.slice(0, -1) + (token.endsWith("a") ? "b" : "a")],
  ]) {
    const r = await bad.goto(`${BASE}/receipt/${candidate}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    const t = await bad.locator("body").innerText().catch(() => "");
    ok(`${label} is refused`, /not available/i.test(t), t.replace(/\s+/g, " ").slice(0, 60));
    ok(`${label} shows no receipt`, !t.includes(customer.name));
    void r;
  }

  // The other customer's link must not reach this one's receipt.
  ok("a sale link does not open the payment receipt",
     !(await (await bad.goto(`${BASE}/receipt/${token}`, { waitUntil: "domcontentloaded" }),
        bad.locator("body").innerText())).includes("Previous balance"));

  // Revoking has to work, because a receipt sent to a wrong number is
  // the reason it exists.
  await db.from("receipt_tokens").update({ revoked_at: new Date().toISOString() })
    .eq("token_hash", digest(token));
  await bad.goto(`${BASE}/receipt/${token}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  ok("a revoked link stops working at once",
     /not available/i.test(await bad.locator("body").innerText().catch(() => "")));
  const revokedPdf = await bad.request.get(`${url}/pdf`);
  ok("and its PDF stops with it", revokedPdf.status() === 404, `status=${revokedPdf.status()}`);
  await bad.context().close();

  head("the receipt on a phone");
  await db.from("receipt_tokens").update({ revoked_at: null }).eq("token_hash", digest(token));
  for (const [w, h, label] of [[360, 740, "360"], [390, 844, "390"], [430, 932, "430"]]) {
    const m = await newPage({ width: w, height: h });
    await m.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await m.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
    const overflow = await m.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    const downloadVisible = await m.getByRole("link", { name: /download pdf/i })
      .first().isVisible().catch(() => false);
    ok(`the receipt fits and offers the PDF at ${label}px`, !overflow && downloadVisible,
       overflow ? "horizontal overflow" : downloadVisible ? "" : "no download control");
    await m.context().close();
  }
} catch (e) {
  fail++;
  console.log(`\n  FAIL  the run threw: ${e.message}`);
} finally {
  await browser.close();

  // Only what this run created, by id.
  for (const id of made.sales) {
    await db.from("receipt_tokens").delete().eq("subject_id", id);
    await db.from("van_sale_payments").delete().eq("sale_id", id);
    await db.from("van_sale_items").delete().eq("sale_id", id);
    await db.from("van_sales").delete().eq("id", id);
  }
  for (const id of made.txns) await db.from("receipt_tokens").delete().eq("subject_id", id);
  for (const id of made.customers) {
    await db.from("credit_transactions").delete().eq("customer_id", id);
    await db.from("customers").delete().eq("id", id);
  }
  for (const id of made.loads) {
    await db.from("van_load_items").delete().eq("load_id", id);
    await db.from("van_loads").delete().eq("id", id);
  }
  for (const id of made.vans) {
    await db.from("van_inventory").delete().eq("van_id", id);
    await db.from("stock_movements").delete().eq("van_id", id);
    await db.from("vans").delete().eq("id", id);
  }
  for (const id of made.products) {
    await db.from("stock_movements").delete().eq("product_id", id);
    await db.from("inventory").delete().eq("product_id", id);
    await db.from("products").delete().eq("id", id);
  }
  for (const id of made.categories) await db.from("categories").delete().eq("id", id);
  for (const id of made.warehouses) {
    await db.from("inventory").delete().eq("warehouse_id", id);
    await db.from("warehouses").delete().eq("id", id);
  }

  const counts = {};
  for (const t of ["van_sales", "customers", "products", "receipt_tokens", "vans", "warehouses"]) {
    const { count } = await db.from(t).select("id", { count: "exact", head: true });
    counts[t] = count ?? 0;
  }
  console.log(`\ntest data removed; ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" ")}`);
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
for (const e of [...new Set(consoleErrors)].slice(0, 5)) console.log(`  ${e}`);
console.log(`network errors: ${networkErrors.length}`);
for (const e of [...new Set(networkErrors)].slice(0, 6)) console.log(`  ${e}`);
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
