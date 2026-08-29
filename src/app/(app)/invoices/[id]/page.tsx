import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { getInvoice } from "@/features/documents/queries";
import {
  DocumentShell, DocumentTable, DocumentTotals,
} from "@/features/documents/document-shell";
import { INVOICE_STATUS_LABELS } from "@/features/documents/invoice-list";
import { Forbidden } from "@/components/layout/forbidden";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/ui/states";
import { formatMoney, formatDate } from "@/lib/utils/format";
import { formatHolding } from "@/lib/catalogue/quantity";
import { METHOD_LABELS } from "@/features/commercial/payment-list";
import { ShareButton } from "@/features/documents/share-button";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, "documents.view")) return <Forbidden />;

  const { id } = await params;
  const result = await getInvoice(id);

  if (!result.ok) {
    return <Card><ErrorState title="Invoice could not be loaded" message={result.message} /></Card>;
  }
  if (!result.data) notFound();

  const invoice = result.data;
  const overdue = invoice.isOverdue && invoice.balance > 0;
  const status = overdue ? "overdue" : invoice.status;

  return (
    <DocumentShell
      title="Invoice"
      reference={invoice.invoiceNumber}
      backHref="/invoices"
      backLabel="All invoices"
      status={
        <>
          <Badge tone={status === "paid" ? "positive" : overdue ? "critical" : "caution"}>
            {INVOICE_STATUS_LABELS[status] ?? status}
          </Badge>
          <ShareButton title={`Invoice ${invoice.invoiceNumber}`} />
        </>
      }
      parties={[
        {
          label: "Billed to",
          lines: [
            invoice.customerName,
            invoice.customerCode,
            invoice.customerAddress,
            invoice.customerPhone,
          ],
        },
        {
          label: "Reference",
          lines: [
            invoice.saleNumber ? `Sale ${invoice.saleNumber}` : null,
            invoice.soldBy ? `Sold by ${invoice.soldBy}` : null,
          ],
        },
      ]}
      meta={[
        { label: "Issued", value: formatDate(invoice.issueDate) },
        { label: "Due", value: formatDate(invoice.dueDate) },
        { label: "Amount due", value: formatMoney(invoice.balance) },
      ]}
      footer={
        <p>
          Payable to {""}
          <span className="font-medium text-[var(--text-secondary)]">GAB Premium Ent</span> by{" "}
          {formatDate(invoice.dueDate)}. Please quote {invoice.invoiceNumber} on payment.
        </p>
      }
    >
      {invoice.lines.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--text-muted)]">
          No line detail is held for this invoice.
        </p>
      ) : (
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
          {invoice.lines.map((line, i) => (
            <tr key={i}>
              <td className="py-2.5 pr-3">
                <span className="text-[var(--text-primary)]">{line.productName}</span>
                {line.sku && (
                  <span className="numeric ml-2 text-xs text-[var(--text-muted)]">{line.sku}</span>
                )}
              </td>
              <td className="numeric py-2.5 px-3 text-right">
                {formatHolding(
                  { units: line.quantity, pieces: line.pieces },
                  line.unit, { empty: "0" },
                )}
              </td>
              <td className="numeric py-2.5 px-3 text-right">{formatMoney(line.unitPrice)}</td>
              <td className="numeric py-2.5 pl-3 text-right">{formatMoney(line.lineTotal)}</td>
            </tr>
          ))}
        </DocumentTable>
      )}

      <DocumentTotals
        rows={[
          { label: "Subtotal", value: formatMoney(invoice.subtotal) },
          // Shown as its own line rather than folded into the total: a
          // customer who was given a discount should be able to see it,
          // and so should whoever gave it.
          ...(invoice.discount > 0
            ? [{ label: "Discount", value: `-${formatMoney(invoice.discount)}` }]
            : []),
          ...(invoice.taxTotal > 0
            ? [{ label: "Tax", value: formatMoney(invoice.taxTotal) }]
            : []),
          { label: "Total", value: formatMoney(invoice.total) },
          ...(invoice.amountPaid > 0
            ? [{ label: "Paid", value: `-${formatMoney(invoice.amountPaid)}` }]
            : []),
          { label: "Amount due", value: formatMoney(invoice.balance), emphasis: true },
        ]}
      />

      {invoice.receipts.length > 0 && (
        <section className="print-keep mt-8 border-t border-[var(--border-subtle)] pt-4">
          <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
            Payments received
          </h2>
          <ul className="mt-2 space-y-1.5">
            {invoice.receipts.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
                <span className="text-[var(--text-secondary)]">
                  <Link
                    href={`/payments/${r.id}`}
                    className="numeric text-[var(--text-primary)] hover:underline"
                  >
                    {r.paymentNumber}
                  </Link>
                  {" · "}
                  {formatDate(r.paidAt)} · {METHOD_LABELS[r.method] ?? r.method}
                  {r.reference ? ` · ${r.reference}` : ""}
                </span>
                <span className="numeric text-[var(--text-primary)]">{formatMoney(r.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </DocumentShell>
  );
}
