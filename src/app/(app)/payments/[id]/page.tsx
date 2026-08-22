import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { getReceipt } from "@/features/documents/queries";
import { DocumentShell, DocumentTotals } from "@/features/documents/document-shell";
import { Forbidden } from "@/components/layout/forbidden";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/ui/states";
import { formatMoney, formatDateTime } from "@/lib/utils/format";
import { METHOD_LABELS } from "@/features/commercial/payment-list";

export const metadata: Metadata = { title: "Receipt" };

/**
 * The receipt for one payment.
 *
 * A customer settling ₵400 across two invoices gets a receipt for each,
 * because each one is evidence against a specific debt. The figure that
 * matters to them is what is still owed on that invoice afterwards, so
 * it is on the document rather than left to be asked about.
 */
export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, "documents.view")) return <Forbidden />;

  const { id } = await params;
  const result = await getReceipt(id);

  if (!result.ok) {
    return <Card><ErrorState title="Receipt could not be loaded" message={result.message} /></Card>;
  }
  if (!result.data) notFound();

  const receipt = result.data;
  const settled = receipt.invoiceBalance <= 0;

  return (
    <DocumentShell
      title="Receipt"
      reference={receipt.paymentNumber}
      backHref="/payments"
      backLabel="All collections"
      status={
        <Badge tone={settled ? "positive" : "caution"}>
          {settled ? "Invoice settled" : "Balance remaining"}
        </Badge>
      }
      parties={[
        {
          label: "Received from",
          lines: [receipt.customerName, receipt.customerCode, receipt.customerPhone],
        },
        {
          label: "Against invoice",
          lines: [
            receipt.invoiceNumber,
            receipt.receivedBy ? `Received by ${receipt.receivedBy}` : null,
          ],
        },
      ]}
      meta={[
        { label: "Received", value: formatDateTime(receipt.paidAt) },
        { label: "Method", value: METHOD_LABELS[receipt.method] ?? receipt.method },
        ...(receipt.reference ? [{ label: "Reference", value: receipt.reference }] : []),
      ]}
      footer={
        <p>
          Thank you. This receipt is evidence of payment against{" "}
          <span className="numeric">{receipt.invoiceNumber}</span> only.
        </p>
      }
    >
      <div className="print-keep mt-6 rounded-lg border border-[var(--border-strong)] px-5 py-6 text-center">
        <p className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
          Amount received
        </p>
        <p className="numeric mt-1 text-3xl font-semibold text-[var(--text-primary)]">
          {formatMoney(receipt.amount)}
        </p>
      </div>

      <DocumentTotals
        rows={[
          { label: "Invoice total", value: formatMoney(receipt.invoiceTotal) },
          { label: "This payment", value: `-${formatMoney(receipt.amount)}` },
          {
            label: settled ? "Settled in full" : "Still outstanding",
            value: formatMoney(receipt.invoiceBalance),
            emphasis: true,
          },
        ]}
      />

      <p className="print-hide mt-6 text-sm">
        <Link href="/invoices" className="text-brand-700 hover:underline">
          View the invoice this settles
        </Link>
      </p>
    </DocumentShell>
  );
}
