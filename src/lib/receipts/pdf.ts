import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import type { Receipt } from "./receipt";
import { toNumber, formatPhone, receiptQuantity } from "./receipt";

/**
 * The receipt as a real PDF file.
 *
 * A real file, not a print dialog: this is what a customer keeps, opens
 * on a phone with no signal, and forwards to whoever pays their bills.
 *
 * Drawn rather than laid out, because pdf-lib has no layout engine.
 * That is a fair trade for a document this fixed - one page, one table,
 * one total - and it avoids shipping a browser to render HTML.
 *
 * A5, portrait: a receipt, not a contract. It prints two-up on A4 and
 * fills a phone screen without pinching.
 */

const PAGE = { width: 420, height: 595 };   // A5 at 72dpi
const MARGIN = 36;
const INK = rgb(0.09, 0.11, 0.15);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.82, 0.84, 0.87);
const BRAND = rgb(0.11, 0.36, 0.36);

/** Cedis with no symbol: the sign is drawn separately or stated once. */
function amount(n: unknown): string {
  return toNumber(n).toLocaleString("en-GH", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

/** Cut a string to fit a width, with an ellipsis if it had to be cut. */
function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}…`, size) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

export async function receiptPdf(receipt: Receipt): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${receipt.receiptNumber} — ${receipt.organization}`);
  doc.setProducer(receipt.organization);
  doc.setCreator(receipt.organization);

  const page = doc.addPage([PAGE.width, PAGE.height]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const body = await doc.embedFont(StandardFonts.Helvetica);

  const right = PAGE.width - MARGIN;
  const inner = right - MARGIN;
  let y = PAGE.height - MARGIN;

  const text = (s: string, x: number, size: number, font = body, color = INK) =>
    page.drawText(s, { x, y, size, font, color });

  const rightText = (s: string, size: number, font = body, color = INK) =>
    page.drawText(s, { x: right - font.widthOfTextAtSize(s, size), y, size, font, color });

  const rule = (color = RULE, thickness = 0.75) => {
    page.drawLine({
      start: { x: MARGIN, y }, end: { x: right, y },
      thickness, color,
    });
  };

  // ---- the letterhead ------------------------------------------
  text(receipt.organization, MARGIN, 15, bold);
  y -= 14;
  text("Wholesale Distribution", MARGIN, 8, body, MUTED);

  y += 14;
  rightText(receipt.kind === "credit_payment" ? "PAYMENT RECEIPT" : "SALES RECEIPT", 9, bold, BRAND);
  y -= 13;
  rightText(receipt.receiptNumber, 9, body, MUTED);

  y -= 16;
  rule(BRAND, 1.5);

  // ---- who and when --------------------------------------------
  y -= 20;
  const labelled = (label: string, value: string, x: number) => {
    page.drawText(label, { x, y, size: 7, font: body, color: MUTED });
    page.drawText(fit(value, body, 9.5, inner / 2 - 12), {
      x, y: y - 12, size: 9.5, font: body, color: INK,
    });
  };

  labelled("CUSTOMER", receipt.customerName, MARGIN);
  labelled("DATE", when(receipt.issuedAt), MARGIN + inner / 2);
  y -= 30;

  if (receipt.customerPhone) {
    labelled("PHONE", formatPhone(receipt.customerPhone), MARGIN);
  }
  if (receipt.servedBy) {
    labelled(receipt.kind === "credit_payment" ? "RECEIVED BY" : "SERVED BY",
             receipt.servedBy, MARGIN + inner / 2);
  }
  if (receipt.customerPhone || receipt.servedBy) y -= 30;

  if (receipt.reference) {
    labelled("SALE", receipt.reference, MARGIN);
    y -= 30;
  }

  // ================================================================
  // A credit payment: three figures, and which way they go
  // ================================================================
  if (receipt.kind === "credit_payment") {
    y -= 4;
    rule();
    y -= 22;

    const row = (label: string, value: string, strong = false) => {
      page.drawText(label, { x: MARGIN, y, size: strong ? 10 : 9.5,
        font: strong ? bold : body, color: strong ? INK : MUTED });
      const v = `GHS ${value}`;
      page.drawText(v, {
        x: right - (strong ? bold : body).widthOfTextAtSize(v, strong ? 11 : 9.5),
        y, size: strong ? 11 : 9.5, font: strong ? bold : body, color: INK,
      });
      y -= strong ? 20 : 17;
    };

    row("Previous balance", amount(receipt.balanceBefore));
    row("Payment received", amount(receipt.amount), true);

    y -= 2;
    rule();
    y -= 20;
    row("Remaining balance", amount(receipt.balanceAfter), true);

    if (receipt.method) {
      y -= 4;
      page.drawText("PAID BY", { x: MARGIN, y, size: 7, font: body, color: MUTED });
      page.drawText(String(receipt.method).replace(/_/g, " "), {
        x: MARGIN, y: y - 12, size: 9.5, font: body, color: INK,
      });
      y -= 30;
    }
  } else {
    // ==============================================================
    // A sale: what was bought
    // ==============================================================
    y -= 4;
    rule();
    y -= 14;

    const qtyX = MARGIN + inner * 0.52;
    const priceX = MARGIN + inner * 0.68;

    page.drawText("ITEM", { x: MARGIN, y, size: 7, font: bold, color: MUTED });
    page.drawText("QTY", { x: qtyX, y, size: 7, font: bold, color: MUTED });
    page.drawText("PRICE", { x: priceX, y, size: 7, font: bold, color: MUTED });
    const totalLabel = "TOTAL";
    page.drawText(totalLabel, {
      x: right - bold.widthOfTextAtSize(totalLabel, 7), y, size: 7, font: bold, color: MUTED,
    });

    y -= 8;
    rule();
    y -= 14;

    for (const line of receipt.items ?? []) {
      // Runs out of page rather than drawing over the totals. A van
      // sale with forty lines is not what this document is for, and a
      // truncated list that says so beats an unreadable one.
      if (y < MARGIN + 150) {
        page.drawText("… more items on the full receipt online", {
          x: MARGIN, y, size: 8, font: body, color: MUTED,
        });
        y -= 14;
        break;
      }

      page.drawText(fit(line.name, body, 9, qtyX - MARGIN - 8), {
        x: MARGIN, y, size: 9, font: body, color: INK,
      });
      // The same wording as the page. A customer holding the PDF and a
      // customer looking at the link must not see different quantities.
      page.drawText(receiptQuantity(line), { x: qtyX, y, size: 9, font: body, color: INK });
      page.drawText(amount(line.unitPrice), { x: priceX, y, size: 9, font: body, color: INK });
      const lt = amount(line.lineTotal);
      page.drawText(lt, {
        x: right - body.widthOfTextAtSize(lt, 9), y, size: 9, font: body, color: INK,
      });
      y -= 15;
    }

    y -= 4;
    rule();
    y -= 18;

    const total = (label: string, value: string, strong = false) => {
      page.drawText(label, { x: MARGIN + inner * 0.42, y, size: strong ? 10 : 9,
        font: strong ? bold : body, color: strong ? INK : MUTED });
      const v = `GHS ${value}`;
      page.drawText(v, {
        x: right - (strong ? bold : body).widthOfTextAtSize(v, strong ? 12 : 9),
        y, size: strong ? 12 : 9, font: strong ? bold : body, color: INK,
      });
      y -= strong ? 20 : 15;
    };

    total("Subtotal", amount(receipt.subtotal));
    if (toNumber(receipt.taxTotal) > 0) total("Tax", amount(receipt.taxTotal));
    total("Total", amount(receipt.total), true);

    if ((receipt.payments ?? []).length > 0) {
      y -= 2;
      for (const p of receipt.payments ?? []) {
        const how = p.provider
          ? `${String(p.method).replace(/_/g, " ")} · ${p.provider}`
          : String(p.method).replace(/_/g, " ");
        page.drawText(how, { x: MARGIN, y, size: 8.5, font: body, color: MUTED });
        const v = `GHS ${amount(p.amount)}`;
        page.drawText(v, {
          x: right - body.widthOfTextAtSize(v, 8.5), y, size: 8.5, font: body, color: MUTED,
        });
        y -= 14;
      }
    }

    // The one line a customer on credit is looking for.
    if (toNumber(receipt.balance) > 0) {
      y -= 6;
      page.drawRectangle({
        x: MARGIN - 6, y: y - 8, width: inner + 12, height: 30,
        color: rgb(0.99, 0.95, 0.9),
      });
      page.drawText("CREDIT SALE — OUTSTANDING", {
        x: MARGIN, y: y + 8, size: 7.5, font: bold, color: rgb(0.55, 0.33, 0.05),
      });
      const owed = `GHS ${amount(receipt.balance)}`;
      page.drawText(owed, {
        x: right - bold.widthOfTextAtSize(owed, 12), y: y + 4,
        size: 12, font: bold, color: rgb(0.55, 0.33, 0.05),
      });
      y -= 30;

      if (receipt.dueDate) {
        page.drawText(`Due ${when(receipt.dueDate).split(",")[0]}`, {
          x: MARGIN, y, size: 8, font: body, color: MUTED,
        });
        y -= 16;
      }
    }
  }

  // ---- the footer ----------------------------------------------
  const footerY = MARGIN + 20;
  page.drawLine({
    start: { x: MARGIN, y: footerY + 16 }, end: { x: right, y: footerY + 16 },
    thickness: 0.75, color: RULE,
  });
  page.drawText("Thank you for your business.", {
    x: MARGIN, y: footerY, size: 9, font: bold, color: INK,
  });
  const issuer = receipt.organization;
  page.drawText(issuer, {
    x: right - body.widthOfTextAtSize(issuer, 8), y: footerY, size: 8, font: body, color: MUTED,
  });

  return doc.save();
}

/** invoice-RCP-2026-000123.pdf — recognisable in a phone's downloads. */
export function pdfFileName(receipt: Receipt): string {
  const kind = receipt.kind === "credit_payment" ? "payment" : "receipt";
  return `${kind}-${receipt.receiptNumber}.pdf`;
}
