import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { formatQuantity, formatDateTime } from "@/lib/utils/format";
import { ActionButton } from "@/components/ui/action-button";
import { approveReturnAction } from "./actions";
import { Check } from "lucide-react";
import type { ReturnRow } from "./queries";

/**
 * Stock coming back off a van.
 *
 * Good, damaged and missing are shown apart rather than netted: they
 * have different consequences, and a total would hide the one that
 * matters. Missing stock is a loss until it is explained.
 */
export function ReturnList({
  returns,
  canApprove = false,
}: {
  returns: ReturnRow[];
  canApprove?: boolean;
}) {
  const approvable = (r: ReturnRow) => canApprove && r.status === "submitted";

  const approve = (r: ReturnRow) => (
    <ActionButton
      action={approveReturnAction}
      fields={{ returnId: r.id }}
      label="Approve"
      title={`Approve ${r.returnNumber}`}
      description="Good stock rejoins the warehouse; damage and shortage are written off."
      icon={<Check className="size-3.5" aria-hidden />}
      warning={
        r.qtyMissing > 0
          ? {
              title: `${r.qtyMissing} unaccounted for`,
              body: "Approving writes that off against the van. Check it with the driver first.",
            }
          : undefined
      }
    />
  );
  return (
    <>
      <TableWrap className="hidden pointer-fine:block">
        <Table>
          <thead>
            <tr>
              <Th>Return</Th>
              <Th>Load</Th>
              <Th>Driver</Th>
              <Th>Received at</Th>
              <Th numeric>Good</Th>
              <Th numeric>Damaged</Th>
              <Th numeric>Missing</Th>
              <Th>Status</Th>
              {canApprove && <Th className="text-right">Action</Th>}
            </tr>
          </thead>
          <tbody>
            {returns.map((r) => (
              <Tr key={r.id}>
                <Td>
                  <span className="numeric block font-medium">{r.returnNumber}</span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {r.lineCount} {r.lineCount === 1 ? "line" : "lines"}
                  </span>
                </Td>
                <Td className="numeric text-[var(--text-secondary)]">{r.loadNumber}</Td>
                <Td>
                  <span className="block">{r.driverName}</span>
                  <span className="text-xs text-[var(--text-muted)]">{r.vanCode}</span>
                </Td>
                <Td className="numeric whitespace-nowrap text-[var(--text-secondary)]">
                  {formatDateTime(r.returnedAt)}
                </Td>
                <Td numeric className="text-positive">{formatQuantity(r.qtyGood)}</Td>
                <Td numeric className={r.qtyDamaged > 0 ? "text-caution" : ""}>
                  {formatQuantity(r.qtyDamaged)}
                </Td>
                <Td numeric className={r.qtyMissing > 0 ? "text-critical" : ""}>
                  {formatQuantity(r.qtyMissing)}
                </Td>
                <Td><StatusBadge status={r.status} /></Td>
                {canApprove && (
                  <Td className="text-right">{approvable(r) && approve(r)}</Td>
                )}
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      <ul className="divide-y divide-[var(--border-subtle)] pointer-fine:hidden">
        {returns.map((r) => (
          <li key={r.id} className="px-5 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="numeric text-sm font-medium text-[var(--text-primary)]">
                  {r.returnNumber}
                </p>
                <p className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">
                  {r.driverName} · {r.vanCode}
                </p>
              </div>
              <StatusBadge status={r.status} />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone="positive">{formatQuantity(r.qtyGood)} good</Badge>
              {r.qtyDamaged > 0 && <Badge tone="caution">{formatQuantity(r.qtyDamaged)} damaged</Badge>}
              {r.qtyMissing > 0 && <Badge tone="critical">{formatQuantity(r.qtyMissing)} missing</Badge>}
            </div>
            <p className="numeric mt-1.5 text-xs text-[var(--text-muted)]">
              {formatDateTime(r.returnedAt)} · load {r.loadNumber}
            </p>
            {approvable(r) && <div className="mt-2.5">{approve(r)}</div>}
          </li>
        ))}
      </ul>
    </>
  );
}
