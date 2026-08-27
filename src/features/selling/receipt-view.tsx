"use client";

import { useState } from "react";
import { Printer, Share2, Check } from "lucide-react";
import type { Receipt } from "./receipt-queries";
import { Button } from "@/components/ui/button";
import { formatMoney, formatDateTime, formatQuantity, formatDate } from "@/lib/utils/format";

/**
 * The receipt, and the two things a salesperson does with it.
 *
 * Print goes through the browser's own print dialogue, which on a phone
 * offers "Save as PDF" and on a desktop offers the printer. That is the
 * PDF: no library, no server round trip, and it works offline once the
 * page is open.
 *
 * Share uses the Web Share API where the device has it - which is how a
 * receipt actually reaches a customer here, over WhatsApp - and falls
 * back to copying the link.
 */
export function ReceiptView({ receipt }: { receipt: Receipt }) {
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const url = typeof window === "undefined" ? "" : window.location.href;
    const text = `${receipt.organizationName} receipt ${receipt.saleNumber} - ${formatMoney(receipt.total)}`;

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: receipt.saleNumber, text, url });
        return;
      } catch {
        // Cancelled, or the device refused. Fall through to copying.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2 print:hidden">
        <Button onClick={() => window.print()} variant="secondary">
          <Printer className="size-4" />
          Print or save as PDF
        </Button>
        <Button onClick={share} variant="outline">
          {copied ? <Check className="size-4" /> : <Share2 className="size-4" />}
          {copied ? "Link copied" : "Share"}
        </Button>
      </div>

      <article className="surface mx-auto max-w-md rounded-[var(--radius-panel)] border border-[var(--border-subtle)] p-6 print:border-0 print:p-0">
        <header className="border-b border-dashed border-[var(--border-strong)] pb-4 text-center">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            {receipt.organizationName}
          </h2>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            Receipt {receipt.saleNumber}
          </p>
          <p className="text-xs text-[var(--text-muted)]">{formatDateTime(receipt.soldAt)}</p>
        </header>

        <dl className="grid grid-cols-2 gap-y-1 py-4 text-xs">
          <dt className="text-[var(--text-muted)]">Customer</dt>
          <dd className="text-right text-[var(--text-primary)]">{receipt.customerName}</dd>
          <dt className="text-[var(--text-muted)]">Served by</dt>
          <dd className="text-right text-[var(--text-primary)]">{receipt.salespersonName ?? "-"}</dd>
          <dt className="text-[var(--text-muted)]">Payment</dt>
          <dd className="text-right text-[var(--text-primary)]">
            {receipt.saleType === "credit" ? "On credit" : "Paid"}
          </dd>
        </dl>

        <table className="w-full border-t border-dashed border-[var(--border-strong)] pt-2 text-sm">
          <thead>
            <tr className="text-xs text-[var(--text-muted)]">
              <th className="py-2 text-left font-normal">Item</th>
              <th className="py-2 text-right font-normal">Qty</th>
              <th className="py-2 text-right font-normal">Amount</th>
            </tr>
          </thead>
          <tbody>
            {receipt.lines.map((line, i) => (
              <tr key={`${line.sku}-${i}`} className="align-top">
                <td className="py-1.5 pr-2">
                  <span className="block text-[var(--text-primary)]">{line.productName}</span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {formatMoney(line.unitPrice)} per {line.unit}
                  </span>
                </td>
                <td className="numeric py-1.5 text-right">{formatQuantity(line.quantity)}</td>
                <td className="numeric py-1.5 text-right">{formatMoney(line.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="mt-3 space-y-1 border-t border-dashed border-[var(--border-strong)] pt-3 text-sm">
          <Row label="Subtotal" value={formatMoney(receipt.subtotal)} />
          {receipt.taxTotal > 0 && <Row label="Tax" value={formatMoney(receipt.taxTotal)} />}
          <Row label="Total" value={formatMoney(receipt.total)} strong />
          <Row label="Paid" value={formatMoney(receipt.amountPaid)} />
          {receipt.balance > 0 && (
            <Row
              label={receipt.dueDate ? `Balance, due ${formatDate(receipt.dueDate)}` : "Balance"}
              value={formatMoney(receipt.balance)}
              strong
            />
          )}
        </dl>

        <p className="mt-6 text-center text-xs text-[var(--text-muted)]">
          Thank you for your custom.
        </p>
      </article>
    </>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className={strong ? "font-medium text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}>
        {label}
      </dt>
      <dd className={strong ? "numeric font-semibold text-[var(--text-primary)]" : "numeric text-[var(--text-secondary)]"}>
        {value}
      </dd>
    </div>
  );
}
