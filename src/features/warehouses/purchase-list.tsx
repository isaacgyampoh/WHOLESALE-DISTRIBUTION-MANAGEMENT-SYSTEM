import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";
import { formatMoney, formatQuantity, formatDate } from "@/lib/utils/format";
import { PurchaseOrderActions } from "./purchase-form";
import type { PurchaseOrderRow } from "./queries";

/**
 * Inbound orders.
 *
 * Received progress is shown as a proportion rather than a percentage:
 * "180 of 240" tells a warehouse clerk what is still outstanding, which
 * "75%" does not.
 */
export function PurchaseList({
  orders,
  canManage = false,
}: {
  orders: PurchaseOrderRow[];
  canManage?: boolean;
}) {
  return (
    <>
      <TableWrap className="hidden pointer-fine:block">
        <Table>
          <thead>
            <tr>
              <Th>Order</Th>
              <Th>Supplier</Th>
              <Th>Destination</Th>
              <Th>Ordered</Th>
              <Th>Expected</Th>
              <Th numeric>Received</Th>
              <Th numeric>Value</Th>
              <Th>Status</Th>
              {canManage && <Th className="text-right">Actions</Th>}
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <Tr key={o.id}>
                <Td>
                  <span className="numeric block font-medium">{o.poNumber}</span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {o.lineCount} {o.lineCount === 1 ? "line" : "lines"}
                  </span>
                </Td>
                <Td>{o.supplierName}</Td>
                <Td className="text-[var(--text-secondary)]">{o.warehouseName}</Td>
                <Td className="numeric whitespace-nowrap text-[var(--text-secondary)]">
                  {formatDate(o.orderDate)}
                </Td>
                <Td className="numeric whitespace-nowrap text-[var(--text-secondary)]">
                  {o.expectedDate ? formatDate(o.expectedDate) : "-"}
                </Td>
                <Td numeric className={o.qtyReceived < o.qtyOrdered ? "text-caution" : "text-positive"}>
                  {formatQuantity(o.qtyReceived)} of {formatQuantity(o.qtyOrdered)}
                </Td>
                <Td numeric>{formatMoney(o.total)}</Td>
                <Td><StatusBadge status={o.status} /></Td>
                {canManage && (
                  <Td><PurchaseOrderActions order={o} lines={o.lines} /></Td>
                )}
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      <ul className="divide-y divide-[var(--border-subtle)] pointer-fine:hidden">
        {orders.map((o) => (
          <li key={o.id} className="px-5 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="numeric text-sm font-medium text-[var(--text-primary)]">{o.poNumber}</p>
                <p className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">{o.supplierName}</p>
              </div>
              <StatusBadge status={o.status} />
            </div>
            <p className="numeric mt-2 text-xs text-[var(--text-secondary)]">
              {formatQuantity(o.qtyReceived)} of {formatQuantity(o.qtyOrdered)} received ·{" "}
              {formatMoney(o.total)}
            </p>
            <p className="numeric mt-0.5 text-xs text-[var(--text-muted)]">
              Ordered {formatDate(o.orderDate)}
              {o.expectedDate ? ` · expected ${formatDate(o.expectedDate)}` : ""}
            </p>
            {canManage && (
              <div className="mt-2.5">
                <PurchaseOrderActions order={o} lines={o.lines} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
