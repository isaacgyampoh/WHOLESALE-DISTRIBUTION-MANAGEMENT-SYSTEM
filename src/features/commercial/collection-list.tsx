import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatDateTime } from "@/lib/utils/format";
import { METHOD_LABELS } from "./payment-list";
import type { CollectionRow } from "./queries";

/**
 * Money received against customer accounts.
 *
 * Who took the money is a column rather than a detail: a collection
 * nobody is named against is the one that gets disputed.
 */
export function CollectionList({ collections }: { collections: CollectionRow[] }) {
  return (
    <>
      <TableWrap className="hidden pointer-fine:block">
        <Table>
          <thead>
            <tr>
              <Th>Customer</Th>
              <Th>Method</Th>
              <Th>Reference</Th>
              <Th>Received</Th>
              <Th>By</Th>
              <Th numeric>Amount</Th>
            </tr>
          </thead>
          <tbody>
            {collections.map((c) => (
              <Tr key={c.id}>
                <Td>
                  <span className="block font-medium">{c.customerName}</span>
                  <span className="numeric text-xs text-[var(--text-muted)]">{c.customerCode}</span>
                </Td>
                <Td><Badge tone="info">{METHOD_LABELS[c.method] ?? c.method}</Badge></Td>
                <Td className="text-[var(--text-secondary)]">{c.notes ?? "-"}</Td>
                <Td className="numeric whitespace-nowrap text-[var(--text-secondary)]">
                  {formatDateTime(c.occurredAt)}
                </Td>
                <Td className="text-[var(--text-secondary)]">{c.receivedBy ?? "System"}</Td>
                <Td numeric className="font-medium text-positive">{formatMoney(c.amount)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      <ul className="divide-y divide-[var(--border-subtle)] pointer-fine:hidden">
        {collections.map((c) => (
          <li key={c.id} className="px-5 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)]">{c.customerName}</p>
                <p className="numeric mt-0.5 text-xs text-[var(--text-muted)]">{c.customerCode}</p>
              </div>
              <span className="numeric shrink-0 text-sm font-semibold text-positive">
                {formatMoney(c.amount)}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <Badge tone="info">{METHOD_LABELS[c.method] ?? c.method}</Badge>
              <span className="numeric text-xs text-[var(--text-muted)]">
                {formatDateTime(c.occurredAt)}
              </span>
            </div>
            {c.notes && (
              <p className="mt-1 text-xs text-[var(--text-secondary)]">{c.notes}</p>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
