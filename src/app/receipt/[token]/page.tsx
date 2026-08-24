import type { Metadata } from "next";
import { resolveReceipt } from "@/lib/receipts/server";
import { money, toNumber, formatPhone } from "@/lib/receipts/receipt";
import { ReceiptActions } from "@/features/receipts/receipt-actions";
import { ReceiptDocument } from "@/features/receipts/receipt-document";
import { ShieldAlert } from "lucide-react";
import { BRAND } from "@/lib/brand";

/**
 * A customer's own receipt.
 *
 * No account, no password, no shell: whoever holds the link holds the
 * receipt, and the link reaches one document and nothing else. Never
 * indexed - a receipt in a search result is a receipt that has been
 * published.
 */
export const metadata: Metadata = {
  title: "Your receipt",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const receipt = await resolveReceipt(token);

  // One message for every kind of failure. Telling the holder of a bad
  // link whether it was unknown, expired or revoked tells them how to
  // make a better guess.
  if (!receipt) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
        <ShieldAlert className="size-10 text-[var(--text-muted)]" aria-hidden />
        <h1 className="mt-4 text-lg font-semibold text-[var(--text-primary)]">
          This receipt is not available
        </h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          The link may have expired. Ask {BRAND.name} to send it again.
        </p>
      </main>
    );
  }

  const owed = toNumber(receipt.balance);
  const isPayment = receipt.kind === "credit_payment";

  return (
    <main className="mx-auto min-h-dvh max-w-lg px-4 pt-8 pb-16 sm:px-6">
      {/*
        The answer first. Somebody opening this on a phone wants one
        figure - what they paid, or what they still owe - and should not
        have to read a table to find it.
      */}
      <div className="rounded-t-[14px] bg-ink-900 px-5 py-5 text-white sm:px-7">
        <p className="text-[0.6875rem] font-medium tracking-[0.12em] text-ink-400 uppercase">
          {receipt.organization}
        </p>
        <p className="mt-2.5 text-[0.8125rem] text-ink-300">
          {isPayment ? "Payment received" : "Total"}
        </p>
        <p className="numeric mt-0.5 text-[2rem] leading-none font-semibold">
          {money(isPayment ? toNumber(receipt.amount) : toNumber(receipt.total))}
        </p>
        <p className="mt-3 text-[0.8125rem] text-ink-400">
          {isPayment ? "Payment receipt" : "Receipt"} {receipt.receiptNumber}
          {receipt.customerName ? ` · ${receipt.customerName}` : ""}
        </p>

        {isPayment ? (
          <p className="mt-3 border-t border-white/15 pt-3 text-sm text-ink-200">
            Remaining balance{" "}
            <span className="numeric font-semibold text-white">
              {money(toNumber(receipt.balanceAfter))}
            </span>
          </p>
        ) : owed > 0 ? (
          <p className="mt-3 border-t border-white/15 pt-3 text-sm text-ink-200">
            Outstanding{" "}
            <span className="numeric font-semibold text-gold-400">{money(owed)}</span>
          </p>
        ) : (
          <p className="mt-3 border-t border-white/15 pt-3 text-sm text-ink-200">
            Paid in full. Thank you.
          </p>
        )}
      </div>

      <div className="rounded-b-[14px] border border-t-0 border-[var(--border-subtle)] bg-[var(--surface-raised)] px-5 py-6 sm:px-7">
        <ReceiptDocument receipt={receipt} />

        {receipt.customerPhone && (
          <p className="mt-6 border-t border-[var(--border-subtle)] pt-4 text-xs text-[var(--text-muted)]">
            Sent to {formatPhone(receipt.customerPhone)}
          </p>
        )}
      </div>

      <div className="mt-5">
        <ReceiptActions token={token} receiptNumber={receipt.receiptNumber} />
      </div>

      <p className="mt-8 text-center text-xs leading-relaxed text-[var(--text-muted)]">
        Keep this link to open your receipt again. Anyone holding it can
        see this receipt, so please do not post it publicly.
      </p>
    </main>
  );
}
