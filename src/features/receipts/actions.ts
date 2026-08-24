"use server";

import { headers } from "next/headers";
import { requirePermission } from "@/lib/auth/session";
import { issueReceipt, resolveReceipt } from "@/lib/receipts/server";
import { checkPhone, whatsappMessage, whatsappUrl } from "@/lib/receipts/receipt";
import type { ReceiptKind } from "@/lib/receipts/receipt";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { recordAudit } from "@/lib/audit";

export interface ShareableReceipt {
  ok: boolean;
  message?: string;
  receiptNumber?: string;
  /** Absolute, because it goes into a message that leaves this device. */
  url?: string;
  /** wa.me address with the message already written. */
  whatsapp?: string;
  /** The message itself, for the clipboard fallback. */
  text?: string;
}

/**
 * The site's own address, for a link that has to work in somebody
 * else's WhatsApp.
 *
 * Taken from the request rather than configured, so the same code makes
 * correct links from a preview deployment, the production domain, and a
 * laptop on the warehouse wifi.
 */
async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Issue a receipt for a transaction that has already happened, and
 * prepare the message that carries it.
 *
 * Never part of recording the money. A sale that succeeded stands
 * whether or not this works; the caller shows "receipt can be retried"
 * rather than pretending the sale failed.
 */
export async function shareReceiptAction(
  kind: ReceiptKind,
  subjectId: string,
  phoneInput: string,
): Promise<ShareableReceipt> {
  // Whoever may take the money may issue its receipt.
  const actor = await requirePermission(
    kind === "credit_payment" ? "payments.create" : "sales.create",
  );

  if (!subjectId) return { ok: false, message: "That transaction could not be found." };

  const phone = checkPhone(phoneInput);
  if (!phone.ok) return { ok: false, message: phone.message };

  const issued = await issueReceipt(kind, subjectId, phone.e164);
  if (!issued) {
    return {
      ok: false,
      message: "The receipt could not be prepared. The transaction is saved - please try again.",
    };
  }

  // Read back through the same door the customer will use, so the
  // message quotes the document they will actually see rather than
  // figures assembled separately here.
  const receipt = await resolveReceipt(issued.token);
  if (!receipt) {
    return {
      ok: false,
      message: "The receipt could not be prepared. The transaction is saved - please try again.",
    };
  }

  const url = `${await origin()}${issued.path}`;
  const text = whatsappMessage(receipt, url);

  await recordAudit(actor, {
    action: "receipt.issued",
    targetType: kind === "credit_payment" ? "credit_transaction" : "van_sale",
    targetId: subjectId,
    targetLabel: issued.receiptNumber,
    // The link is deliberately absent: an audit trail that records
    // credentials is a place to steal them from.
    after: { receipt_number: issued.receiptNumber, sent_to: phone.e164 },
  });

  return {
    ok: true,
    receiptNumber: issued.receiptNumber,
    url,
    whatsapp: whatsappUrl(text, phone.e164),
    text,
  };
}

/**
 * The phone number already on file for a transaction's customer, so the
 * salesperson is not asked to type something the system knows.
 */
export async function customerPhoneForAction(
  kind: ReceiptKind,
  subjectId: string,
): Promise<{ phone: string | null; customerName: string | null }> {
  await requirePermission(kind === "credit_payment" ? "payments.view" : "sales.view");

  const admin = createSupabaseAdminClient();

  const { data } = kind === "credit_payment"
    ? await admin
        .from("credit_transactions")
        .select("customers(name, phone)")
        .eq("id", subjectId)
        .maybeSingle()
    : await admin
        .from("van_sales")
        .select("customers(name, phone)")
        .eq("id", subjectId)
        .maybeSingle();

  const customer = data?.customers as { name?: string; phone?: string | null } | null;
  return {
    phone: customer?.phone ?? null,
    customerName: customer?.name ?? null,
  };
}
