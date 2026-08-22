import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { formatMoney, formatDateTime } from "@/lib/utils/format";
import type { SaleRow } from "./queries";

/**
 * Sales made from a van.
 *
 * Cash and credit are distinguished by a badge rather than by column,
 * because the difference changes what happens next: a credit sale
 * leaves a balance somebody has to collect.
 */
export function SalesList({ sales }: { sales: SaleRow[] }) {
  return (
    <>
      <TableWrap className="hidden pointer-fine:block">
        <Table>
          <thead>
            <tr>
              <Th>Sale</Th>
              <Th>Customer</Th>
              <Th>Sold by</Th>
              <Th>When</Th>
              <Th numeric>Total</Th>
              <Th numeric>Outstanding</Th>
              <Th>Type</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {sales.map((s) => (
              <Tr key={s.id}>
                <Td>
                  <span className="numeric block font-medium">{s.saleNumber}</span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {s.lineCount} {s.lineCount === 1 ? "line" : "lines"}
                  </span>
                </Td>
                <Td>{s.customerName}</Td>
                <Td className="text-[var(--text-secondary)]">
                  {s.driverName}
                  <span className="numeric block text-xs text-[var(--text-muted)]">{s.vanCode}</span>
                </Td>
                <Td className="numeric whitespace-nowrap text-[var(--text-secondary)]">
                  {formatDateTime(s.soldAt)}
                </Td>
                <Td numeric>{formatMoney(s.total)}</Td>
                <Td numeric className={s.balance > 0 ? "text-caution" : "text-positive"}>
                  {formatMoney(s.balance)}
                </Td>
                <Td>
                  <Badge tone={s.saleType === "cash" ? "positive" : "info"}>
                    {s.saleType === "cash" ? "Cash" : "Credit"}
                  </Badge>
                </Td>
                <Td><StatusBadge status={s.status} /></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      <ul className="divide-y divide-[var(--border-subtle)] pointer-fine:hidden">
        {sales.map((s) => (
          <li key={s.id} className="px-5 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)]">{s.customerName}</p>
                <p className="numeric mt-0.5 text-xs text-[var(--text-muted)]">{s.saleNumber}</p>
              </div>
              <span className="numeric shrink-0 text-sm font-semibold text-[var(--text-primary)]">
                {formatMoney(s.total)}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge tone={s.saleType === "cash" ? "positive" : "info"}>
                {s.saleType === "cash" ? "Cash" : "Credit"}
              </Badge>
              <StatusBadge status={s.status} />
              {s.balance > 0 && (
                <span className="numeric text-xs text-caution">
                  {formatMoney(s.balance)} outstanding
                </span>
              )}
            </div>
            <p className="numeric mt-1 text-xs text-[var(--text-muted)]">
              {formatDateTime(s.soldAt)} · {s.driverName}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
