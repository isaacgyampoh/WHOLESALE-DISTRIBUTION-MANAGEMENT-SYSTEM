import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { getSaleReceipt } from "@/features/documents/queries";
import {
  DocumentShell, DocumentTable, DocumentTotals,
} from "@/features/documents/document-shell";
import { ShareButton } from "@/features/documents/share-button";
import { Forbidden } from "@/components/layout/forbidden";
import { Card } from "@/components/ui/card";
import { ShareReceipt } from "@/features/receipts/share-receipt";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/ui/states";
import { formatMoney, formatDateTime, formatDate, formatQuantity } from "@/lib/utils/format";
import { METHOD_LABELS } from "@/features/commercial/payment-list";

export const metadata: Metadata = { title: "Receipt" };

/**
 * The receipt for a sale.
 *
 * Most of what a van does is settle at the door, and until now that
 * produced no document at all - only credit sales, which raise an
 * invoice, had anything to print. This is the other case, and the more
 * common one.
 *
 * A split is itemised rather than totalled. A customer who paid ₵200 in
 * cash and ₵300 on mobile money needs to see both, because those are two
 * different things to query later.
 */
export default async function SaleReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, "sales.view")) return <Forbidden />;

  const { id } = await params;
  const result = await getSaleReceipt(id);

  if (!result.ok) {
    return <Card><ErrorState title="Receipt could not be loaded" message={result.message} /></Card>;
  }
  if (!result.data) notFound();

  const sale = result.data;
  const onCredit = sale.saleType === "credit";
  const settled = sale.balance <= 0;

  // Before migration 0025 a sale had no breakdown, so it falls back to
  // the single figure that was recorded - which is what it was assumed
  // to be at the time.
  const breakdown = sale.payments.length > 0
    ? sale.payments
    : sale.amountPaid > 0
      ? [{ method: "cash", amount: sale.amountPaid, reference: null }]
      : [];

  return (
    <>
      {/*
        Above the document, because this is what somebody opening a past
        sale came to do: the customer is on the phone asking for their
        receipt again, and re-sending it must not mean reading the page
        first. Issuing a link records no money and creates no sale - it
        prepares the same receipt again.
      */}
      <Card className="mb-6">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            Send this receipt to the customer
          </h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            They get a link to open, read and download it. No printer, no
            account, nothing to install.
          </p>
        </div>
        <ShareReceipt
          kind="sale"
          subjectId={sale.id}
          customerPhone={sale.customerPhone}
        />
      </Card>

    <DocumentShell
      title={onCredit ? "Sales receipt" : "Receipt"}
      reference={sale.saleNumber}
      backHref="/sales"
      backLabel="All sales"
      status={
        <>
          <Badge tone={settled ? "positive" : onCredit ? "caution" : "neutral"}>
            {settled ? "Paid in full" : `${formatMoney(sale.balance)} outstanding`}
          </Badge>
          <ShareButton title={`Receipt ${sale.saleNumber}`} />
        </>
      }
      parties={[
        {
          label: "Sold to",
          lines: [sale.customerName, sale.customerCode, sale.customerPhone],
        },
        {
          label: "Served by",
          lines: [
            sale.soldBy,
            // Both, because they are different people. A customer with a
            // query names whoever they dealt with, and that is the
            // salesperson.
            sale.drivenBy && sale.drivenBy !== sale.soldBy
              ? `Driver ${sale.drivenBy}`
              : null,
            sale.vanCode ? `Van ${sale.vanCode}` : null,
            onCredit && sale.dueDate ? `Due ${formatDate(sale.dueDate)}` : null,
          ],
        },
      ]}
      meta={[
        { label: "Date", value: formatDateTime(sale.soldAt) },
        { label: "Terms", value: onCredit ? "On account" : "Settled at the door" },
        ...(sale.invoiceNumber
          ? [{ label: "Invoice", value: sale.invoiceNumber }]
          : []),
      ]}
      footer={
        <p>
          Thank you for your custom.
          {onCredit && !settled
            ? ` ${formatMoney(sale.balance)} remains payable${sale.dueDate ? ` by ${formatDate(sale.dueDate)}` : ""}.`
            : ""}
        </p>
      }
    >
      <DocumentTable
        head={
          <>
            <th className="py-2 pr-3 font-medium text-[var(--text-secondary)]">Item</th>
            <th className="py-2 px-3 text-right font-medium text-[var(--text-secondary)]">Qty</th>
            <th className="py-2 px-3 text-right font-medium text-[var(--text-secondary)]">
              Unit price
            </th>
            <th className="py-2 pl-3 text-right font-medium text-[var(--text-secondary)]">
              Amount
            </th>
          </>
        }
      >
        {sale.lines.map((line, i) => (
          <tr key={i}>
            <td className="py-2.5 pr-3">
              <span className="text-[var(--text-primary)]">{line.productName}</span>
              {line.sku && (
                <span className="numeric ml-2 text-xs text-[var(--text-muted)]">{line.sku}</span>
              )}
            </td>
            <td className="numeric py-2.5 px-3 text-right">{formatQuantity(line.quantity)}</td>
            <td className="numeric py-2.5 px-3 text-right">{formatMoney(line.unitPrice)}</td>
            <td className="numeric py-2.5 pl-3 text-right">{formatMoney(line.lineTotal)}</td>
          </tr>
        ))}
      </DocumentTable>

      <DocumentTotals
        rows={[
          { label: "Subtotal", value: formatMoney(sale.subtotal) },
          ...(sale.taxTotal > 0 ? [{ label: "Tax", value: formatMoney(sale.taxTotal) }] : []),
          { label: "Total", value: formatMoney(sale.total), emphasis: true },
        ]}
      />

      {/* Itemised, because ₵200 in cash and ₵300 on mobile money are two
          different things for the customer to query later. */}
      <section className="print-keep mt-8 border-t border-[var(--border-subtle)] pt-4">
        <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
          How it was paid
        </h2>

        {breakdown.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Nothing was paid at the door. The whole amount is on account.
          </p>
        ) : (
          <dl className="mt-2 space-y-1.5">
            {breakdown.map((p, i) => (
              <div key={i} className="flex items-baseline justify-between gap-6">
                <dt className="text-sm text-[var(--text-secondary)]">
                  {METHOD_LABELS[p.method] ?? p.method}
                  {p.reference && (
                    <span className="numeric ml-2 text-xs text-[var(--text-muted)]">
                      {p.reference}
                    </span>
                  )}
                </dt>
                <dd className="numeric text-sm font-medium text-[var(--text-primary)]">
                  {formatMoney(p.amount)}
                </dd>
              </div>
            ))}

            {breakdown.length > 1 && (
              <div className="flex items-baseline justify-between gap-6 border-t border-[var(--border-subtle)] pt-1.5">
                <dt className="text-sm font-semibold text-[var(--text-primary)]">Paid</dt>
                <dd className="numeric text-sm font-semibold text-[var(--text-primary)]">
                  {formatMoney(breakdown.reduce((s, p) => s + p.amount, 0))}
                </dd>
              </div>
            )}

            {sale.balance > 0 && (
              <div className="flex items-baseline justify-between gap-6 border-t border-[var(--border-strong)] pt-1.5">
                <dt className="text-sm font-semibold text-[var(--text-primary)]">On account</dt>
                <dd className="numeric text-sm font-semibold text-caution">
                  {formatMoney(sale.balance)}
                </dd>
              </div>
            )}
          </dl>
        )}
      </section>

      {sale.invoiceId && (
        <p className="print-hide mt-6 text-sm">
          <Link href={`/invoices/${sale.invoiceId}`} className="text-brand-700 hover:underline">
            View the invoice raised for this sale
          </Link>
        </p>
      )}
    </DocumentShell>
    </>
  );
}
