import Link from "next/link";
import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatDate } from "@/lib/utils/format";
import type { InvoiceSummaryRow } from "./queries";

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  issued: "Issued",
  partially_paid: "Part paid",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
};

const TONE: Record<string, "positive" | "caution" | "critical" | "neutral"> = {
  draft: "neutral",
  issued: "neutral",
  partially_paid: "caution",
  paid: "positive",
  overdue: "critical",
  void: "neutral",
};

/**
 * Overdue is shown as overdue even when the stored status has not
 * caught up: the status column only moves when something happens to the
 * invoice, and time passing is not an event.
 */
function statusOf(invoice: InvoiceSummaryRow): string {
  return invoice.isOverdue && invoice.balance > 0 ? "overdue" : invoice.status;
}

export function InvoiceList({ invoices }: { invoices: InvoiceSummaryRow[] }) {
  return (
    <>
      <TableWrap className="hidden pointer-fine:block">
        <Table>
          <thead>
            <tr>
              <Th>Invoice</Th>
              <Th>Customer</Th>
              <Th>Issued</Th>
              <Th>Due</Th>
              <Th numeric>Total</Th>
              <Th numeric>Outstanding</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => (
              <Tr key={i.id}>
                <Td className="numeric font-medium">
                  <Link href={`/invoices/${i.id}`} className="hover:underline">
                    {i.invoiceNumber}
                  </Link>
                </Td>
                <Td>{i.customerName}</Td>
                <Td className="numeric whitespace-nowrap text-[var(--text-secondary)]">
                  {formatDate(i.issueDate)}
                </Td>
                <Td className="numeric whitespace-nowrap text-[var(--text-secondary)]">
                  {formatDate(i.dueDate)}
                </Td>
                <Td numeric>{formatMoney(i.total)}</Td>
                <Td numeric className={i.balance > 0 ? "text-caution" : ""}>
                  {formatMoney(i.balance)}
                </Td>
                <Td>
                  <Badge tone={TONE[statusOf(i)] ?? "neutral"}>
                    {INVOICE_STATUS_LABELS[statusOf(i)] ?? statusOf(i)}
                  </Badge>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      <ul className="divide-y divide-[var(--border-subtle)] pointer-fine:hidden">
        {invoices.map((i) => (
          <li key={i.id}>
            <Link href={`/invoices/${i.id}`} className="block px-5 py-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{i.customerName}</p>
                  <p className="numeric mt-0.5 text-xs text-[var(--text-muted)]">
                    {i.invoiceNumber}
                  </p>
                </div>
                <span className="numeric shrink-0 text-sm font-semibold text-[var(--text-primary)]">
                  {formatMoney(i.balance > 0 ? i.balance : i.total)}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <Badge tone={TONE[statusOf(i)] ?? "neutral"}>
                  {INVOICE_STATUS_LABELS[statusOf(i)] ?? statusOf(i)}
                </Badge>
                <span className="numeric text-xs text-[var(--text-muted)]">
                  Due {formatDate(i.dueDate)}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
