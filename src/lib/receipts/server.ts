import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import type { Receipt, ReceiptKind } from "./receipt";

/**
 * Minting and redeeming the link a customer opens.
 *
 * The link is 32 random bytes. Only its SHA-256 digest is stored, so
 * this table is not a set of working links, and the string itself
 * exists in the WhatsApp message and nowhere else - which is also why
 * it cannot be shown again later, only replaced.
 */

/** How long a customer can still open their receipt. */
const DEFAULT_DAYS = 180;

export interface IssuedReceipt {
  /** The full link path, ready to put in a message. */
  path: string;
  token: string;
  receiptNumber: string;
}

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Issue a link for a sale or a credit payment.
 *
 * Called after the money is already recorded, never as part of
 * recording it: a receipt that cannot be minted must not undo a sale
 * that happened. Callers treat a null return as "the sale stands, the
 * receipt can be retried".
 */
export async function issueReceipt(
  kind: ReceiptKind,
  subjectId: string,
  phoneE164?: string | null,
  days = DEFAULT_DAYS,
): Promise<IssuedReceipt | null> {
  const token = randomBytes(32).toString("base64url");

  // Issued under the caller's own session, so the database checks the
  // transaction belongs to their organization rather than trusting this.
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("issue_receipt_token", {
    p_subject_type: kind,
    p_subject_id: subjectId,
    p_token_hash: digest(token),
    p_token_hint: token.slice(0, 6),
    p_phone: phoneE164 ?? null,
    p_days: days,
  });

  if (error || !data) {
    console.error("[receipts] could not issue a link", error);
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    token,
    path: `/receipt/${token}`,
    receiptNumber: (row?.receipt_number as string) ?? "",
  };
}

/**
 * Exchange a link for the one receipt it belongs to.
 *
 * Runs with the service role because the person holding the link has no
 * session - the token is the whole of their authorization. What comes
 * back is assembled by the database, so nothing here can widen it.
 *
 * Returns null for unknown, expired and revoked alike.
 */
export async function resolveReceipt(token: string): Promise<Receipt | null> {
  // Cheap shape check first: a string of the wrong length was never one
  // of ours and is not worth a round trip.
  if (!token || token.length < 32 || token.length > 200) return null;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("resolve_receipt_token", {
    p_token_hash: digest(token),
  });

  if (error) {
    console.error("[receipts] could not resolve a link", error);
    return null;
  }
  return (data as Receipt | null) ?? null;
}

/**
 * The links already issued for a transaction, newest first.
 *
 * This is what makes "send it again" possible without recording another
 * sale: the receipt already exists, and re-sending is re-opening it.
 */
export async function listReceipts(kind: ReceiptKind, subjectId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("receipt_tokens")
    .select("id, receipt_number, token_hint, customer_phone, expires_at, revoked_at, created_at, view_count, last_viewed_at")
    .eq("subject_type", kind)
    .eq("subject_id", subjectId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[receipts] could not list links", error);
    return [];
  }
  return data ?? [];
}
