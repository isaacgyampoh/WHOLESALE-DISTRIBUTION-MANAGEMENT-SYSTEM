import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatDate } from "@/lib/utils/format";
import type { InvoiceRow } from "./queries";

/**
 * Ageing.
 *
 * The bucket carries the urgency, so it is coloured; the day count is
 * kept beside it because "91+" and "184 days" call for different
 * conversations.
 */
const BUCKET_TONE: Record<string, "positive" | "caution" | "critical" | "neutral"> = {
  current: "positive",
  "1-30": "caution",
  "31-60": "caution",
  "61-90": "critical",
  "90+": "critical",
  "91+": "critical",
};

export function CreditList({ invoices }: { invoices: InvoiceRow[] }) {
  return (
    <>
      <TableWrap className="hidden pointer-fine:block">
        <Table>
          <thead>
            <tr>
              <Th>Invoice</Th>
              <Th>Customer</Th>
              <Th>Due</Th>
              <Th numeric>Invoiced</Th>
              <Th numeric>Outstanding</Th>
              <Th>Age</Th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => (
              <Tr key={i.id}>
                <Td className="numeric font-medium">{i.invoiceNumber}</Td>
                <Td>{i.customerName}</Td>
                <Td className="numeric whitespace-nowrap text-[var(--text-secondary)]">
                  {formatDate(i.dueDate)}
                </Td>
                <Td numeric>{formatMoney(i.total)}</Td>
                <Td numeric className={i.balance > 0 ? "text-caution" : ""}>
                  {formatMoney(i.balance)}
                </Td>
                <Td>
                  <Badge tone={BUCKET_TONE[i.bucket] ?? "neutral"}>
                    {i.daysOverdue > 0 ? `${i.daysOverdue} days` : "Current"}
                  </Badge>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      <ul className="divide-y divide-[var(--border-subtle)] pointer-fine:hidden">
        {invoices.map((i) => (
          <li key={i.id} className="px-5 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)]">{i.customerName}</p>
                <p className="numeric mt-0.5 text-xs text-[var(--text-muted)]">{i.invoiceNumber}</p>
              </div>
              <span className="numeric shrink-0 text-sm font-semibold text-caution">
                {formatMoney(i.balance)}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <Badge tone={BUCKET_TONE[i.bucket] ?? "neutral"}>
                {i.daysOverdue > 0 ? `${i.daysOverdue} days overdue` : "Current"}
              </Badge>
              <span className="numeric text-xs text-[var(--text-muted)]">
                Due {formatDate(i.dueDate)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
