/**
 * What a receipt is, and what goes in the message that carries it.
 *
 * Nothing here touches the database or holds a secret, so the sell
 * screen and the customer's page share one definition and cannot drift
 * on what a receipt says.
 */
import { normalisePhone } from "@/lib/auth/phone";

export type ReceiptKind = "sale" | "credit_payment";

export interface ReceiptLine {
  name: string;
  sku: string | null;
  /** Whole units. May be zero on a line of loose pieces only. */
  quantity: number;
  /** Loose pieces, counted apart from the units and never folded in. */
  pieces?: number;
  /** What one loose piece was charged at on this sale. */
  piecePrice?: number;
  /** The product's own unit, for wording the line. */
  unit?: string | null;
  unitPrice: number;
  lineTotal: number;
}

/**
 * How a receipt line's quantity reads: "2 Cartons + 3 Pieces".
 *
 * Shared by the page and the PDF so the customer's copy and the one
 * they were shown cannot say different things. Falls back to the bare
 * number for a line with no pieces, which is every line ever issued
 * before this existed.
 */
export function receiptQuantity(line: ReceiptLine): string {
  const units = Number(line.quantity ?? 0);
  const pieces = Number(line.pieces ?? 0);
  if (pieces === 0) return String(units);

  const parts: string[] = [];
  if (units !== 0) parts.push(word(units, unitWord(line)));
  parts.push(word(pieces, "Piece"));
  return parts.join(" + ");
}

function unitWord(line: ReceiptLine): string {
  const unit = (line.unit ?? "unit").trim() || "unit";
  return unit.charAt(0).toUpperCase() + unit.slice(1);
}

function word(n: number, w: string): string {
  return `${n} ${w}${n === 1 ? "" : "s"}`;
}

/**
 * What was bought and what each of them cost: "2 Pieces x GHS 12.00".
 *
 * A line can be two cartons and three singles at two different prices,
 * and one "Price" column cannot say that - it would show the carton
 * rate against a quantity that is mostly singles, which is precisely
 * the argument at the next delivery this is meant to prevent. So each
 * half is priced on its own line and the customer can see which is
 * which.
 *
 * Returns one entry for a plain line, two for a mixed one.
 */
export function receiptUnitLines(
  line: ReceiptLine,
  money: (n: number) => string,
): { what: string; each: string }[] {
  const units = Number(line.quantity ?? 0);
  const pieces = Number(line.pieces ?? 0);
  const unitPrice = Number(line.unitPrice ?? 0);
  const piecePrice = Number(line.piecePrice ?? 0);

  if (pieces === 0) {
    return [{ what: word(units, unitWord(line)), each: money(unitPrice) }];
  }

  const out: { what: string; each: string }[] = [];
  if (units !== 0) out.push({ what: word(units, unitWord(line)), each: money(unitPrice) });
  out.push({ what: word(pieces, "Piece"), each: money(piecePrice) });
  return out;
}

export interface ReceiptPayment {
  method: string;
  amount: number;
  provider: string | null;
  reference: string | null;
}

/**
 * Exactly what resolve_receipt_token returns, and no more. There is no
 * cost, no margin, no supplier and no internal id in this shape - the
 * type is the second place that is true, after the function itself.
 */
export interface Receipt {
  kind: ReceiptKind;
  receiptNumber: string;
  /** The sale's own number, where there is one. */
  reference: string | null;
  issuedAt: string;
  organization: string;
  customerName: string;
  customerPhone: string | null;
  servedBy: string | null;

  /** Sales. */
  saleType?: string;
  status?: string;
  subtotal?: number;
  taxTotal?: number;
  total?: number;
  amountPaid?: number;
  balance?: number;
  dueDate?: string | null;
  items?: ReceiptLine[];
  payments?: ReceiptPayment[];

  /** Credit payments. */
  method?: string;
  amount?: number;
  notes?: string | null;
  balanceBefore?: number;
  balanceAfter?: number;
}

/** Numbers arrive from postgres as strings; money must not be a string. */
export function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Cedis, the way this business writes them. Never "GH₵". */
export function money(amount: number): string {
  return `₵${toNumber(amount).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ------------------------------------------------------------------
// Phone numbers
// ------------------------------------------------------------------

/**
 * Ghanaian mobile prefixes, as the national numbering plan stands.
 *
 * Checked so a slip of the thumb is caught before a receipt is sent to
 * nobody, and kept deliberately wide: a number that is real and refused
 * costs a customer their receipt, which is worse than a number that is
 * wrong and accepted. Anything outside Ghana is left alone entirely.
 */
const GH_MOBILE_PREFIXES = [
  "20", "23", "24", "25", "26", "27", "28", "29", // MTN, AT, Telecel
  "30",                                            // Accra landline, still reachable
  "50", "53", "54", "55", "56", "57", "59",
];

export interface PhoneCheck {
  ok: boolean;
  /** E.164, ready to store and to hand to WhatsApp. */
  e164?: string;
  message?: string;
}

/**
 * Take what somebody typed and turn it into a number a receipt can be
 * sent to. Accepts 024..., 0244..., +233..., 233..., with or without
 * spaces, brackets or dashes.
 */
export function checkPhone(input: string): PhoneCheck {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: false, message: "Enter the customer's phone number." };

  const e164 = normalisePhone(raw);
  if (!e164) {
    return { ok: false, message: "That does not look like a phone number." };
  }

  // Only Ghanaian numbers are checked against the plan; a foreign
  // number is somebody else's numbering rules and none of our business.
  if (e164.startsWith("+233")) {
    const national = e164.slice(4);
    if (national.length !== 9) {
      return {
        ok: false,
        message: "A Ghana number has nine digits after the 0, for example 024 123 4567.",
      };
    }
    if (!GH_MOBILE_PREFIXES.includes(national.slice(0, 2))) {
      return { ok: false, message: `0${national.slice(0, 2)} is not a network we recognise.` };
    }
  }

  return { ok: true, e164 };
}

/** 024 123 4567 - how the number is written on a receipt and read aloud. */
export function formatPhone(e164: string): string {
  if (!e164?.startsWith("+233")) return e164 ?? "";
  const n = e164.slice(4);
  return n.length === 9 ? `0${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}` : e164;
}

// ------------------------------------------------------------------
// The message
// ------------------------------------------------------------------

/** The customer's first name, for a message that reads like a person wrote it. */
function firstName(full: string): string {
  return (full ?? "").trim().split(/\s+/)[0] || "there";
}

/**
 * What gets typed into WhatsApp.
 *
 * The link is in the message because that is what a wa.me URL can
 * carry: it opens a chat with text in it. It does not attach the PDF,
 * and nothing here or in the interface says it does - the customer taps
 * the link and gets their receipt, which is the honest description of
 * what happens.
 */
export function whatsappMessage(receipt: Receipt, link: string): string {
  const who = firstName(receipt.customerName);
  const company = receipt.organization;

  if (receipt.kind === "credit_payment") {
    const before = toNumber(receipt.balanceBefore);
    const paid = toNumber(receipt.amount);
    const after = toNumber(receipt.balanceAfter);

    return [
      `Hello ${who},`,
      ``,
      `We have received your payment of ${money(paid)}.`,
      ``,
      `Previous balance: ${money(before)}`,
      `Payment received: ${money(paid)}`,
      // Never "paid": what is left is what is still owed.
      `Remaining balance: ${money(after)}`,
      ``,
      `Payment receipt ${receipt.receiptNumber}:`,
      link,
      ``,
      `Thank you.`,
      company,
    ].join("\n");
  }

  const total = toNumber(receipt.total);
  const balance = toNumber(receipt.balance);
  const lines = [
    `Hello ${who},`,
    ``,
    `Thank you for your purchase from ${company}.`,
    ``,
    `Receipt: ${receipt.receiptNumber}`,
    `Total: ${money(total)}`,
  ];

  // Only said when there is something to say: a cash sale that is
  // settled does not need a paragraph explaining that nothing is owed.
  if (balance > 0) {
    lines.push(`Paid: ${money(toNumber(receipt.amountPaid))}`);
    lines.push(`Outstanding: ${money(balance)}`);
  }

  lines.push(``, `Your receipt:`, link, ``, `Thank you for your business.`, company);
  return lines.join("\n");
}

/**
 * The wa.me address that opens a chat with that message already typed.
 *
 * With a number when we have one, so it opens the right conversation;
 * without, so the salesperson can pick the chat themselves.
 */
export function whatsappUrl(message: string, phoneE164?: string | null): string {
  const text = encodeURIComponent(message);
  const digits = (phoneE164 ?? "").replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}?text=${text}` : `https://wa.me/?text=${text}`;
}
