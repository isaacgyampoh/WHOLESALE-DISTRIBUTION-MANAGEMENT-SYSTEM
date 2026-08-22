import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatDateTime } from "@/lib/utils/format";
import type { PaymentRow } from "./queries";

/** Payment methods, worded for people rather than for the database. */
export const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  card: "Card",
  mobile_money: "Mobile money",
};

/**
 * Money coming in.
 *
 * The reference is shown whenever there is one: for mobile money and
 * bank transfers it is what a collection gets matched against when a
 * customer disputes it.
 */
export function PaymentList({ payments }: { payments: PaymentRow[] }) {
  return (
    <>
      <TableWrap className="hidden pointer-fine:block">
        <Table>
          <thead>
            <tr>
              <Th>Receipt</Th>
              <Th>Customer</Th>
              <Th>Against</Th>
              <Th>Method</Th>
              <Th>Received</Th>
              <Th numeric>Amount</Th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <Tr key={p.id}>
                <Td>
                  <span className="numeric block font-medium">{p.paymentNumber}</span>
                  {p.reference && (
                    <span className="numeric text-xs text-[var(--text-muted)]">{p.reference}</span>
                  )}
                </Td>
                <Td>{p.customerName}</Td>
                <Td className="numeric text-[var(--text-secondary)]">{p.invoiceNumber}</Td>
                <Td><Badge tone="info">{METHOD_LABELS[p.method] ?? p.method}</Badge></Td>
                <Td className="numeric whitespace-nowrap text-[var(--text-secondary)]">
                  {formatDateTime(p.paidAt)}
                  <span className="block text-xs text-[var(--text-muted)]">
                    {p.receivedBy ?? "System"}
                  </span>
                </Td>
                <Td numeric className="font-medium text-positive">{formatMoney(p.amount)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      <ul className="divide-y divide-[var(--border-subtle)] pointer-fine:hidden">
        {payments.map((p) => (
          <li key={p.id} className="px-5 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)]">{p.customerName}</p>
                <p className="numeric mt-0.5 text-xs text-[var(--text-muted)]">
                  {p.paymentNumber} · {p.invoiceNumber}
                </p>
              </div>
              <span className="numeric shrink-0 text-sm font-semibold text-positive">
                {formatMoney(p.amount)}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <Badge tone="info">{METHOD_LABELS[p.method] ?? p.method}</Badge>
              <span className="numeric text-xs text-[var(--text-muted)]">
                {formatDateTime(p.paidAt)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
