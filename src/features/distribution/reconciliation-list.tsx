import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { StatusBadge, VarianceBadge } from "@/components/ui/badge";
import { formatMoney, formatDateTime } from "@/lib/utils/format";
import { ActionButton } from "@/components/ui/action-button";
import { approveReconciliationAction, rejectReconciliationAction } from "./actions";
import { Check, X } from "lucide-react";
import type { ReconciliationRow } from "./queries";

/**
 * End of day: what the van should have brought back against what it did.
 *
 * Cash and stock are reconciled separately because they fail
 * differently - short cash is a cash problem, short stock is a stock
 * problem, and a driver can be right about one and wrong about the
 * other.
 */
export function ReconciliationList({
  reconciliations,
  canApprove = false,
}: {
  reconciliations: ReconciliationRow[];
  canApprove?: boolean;
}) {
  const decidable = (r: ReconciliationRow) => canApprove && r.status === "submitted";

  const decide = (r: ReconciliationRow) => (
    <div className="flex flex-wrap justify-end gap-2">
      <ActionButton
        action={approveReconciliationAction}
        fields={{ reconciliationId: r.id }}
        label="Approve"
        title={`Approve ${r.reconNumber}`}
        description="Settles the round and closes its load."
        icon={<Check className="size-3.5" aria-hidden />}
        warning={
          Math.abs(r.totalVariance) >= 0.01
            ? {
                title: "This does not balance",
                body: `Approving accepts a variance of ${r.totalVariance.toFixed(2)}. ` +
                      (r.explanation ? `The driver said: "${r.explanation}"` : "No explanation was given."),
              }
            : undefined
        }
      />
      <ActionButton
        action={rejectReconciliationAction}
        fields={{ reconciliationId: r.id }}
        label="Send back"
        title={`Send ${r.reconNumber} back`}
        description="It returns to the driver to be counted again."
        variant="outline"
        icon={<X className="size-3.5" aria-hidden />}
        reasonLabel="Why is it going back?"
        reasonHint="The driver sees this."
      />
    </div>
  );
  return (
    <>
      <TableWrap className="hidden pointer-fine:block">
        <Table>
          <thead>
            <tr>
              <Th>Reconciliation</Th>
              <Th>Driver</Th>
              <Th numeric>Expected cash</Th>
              <Th numeric>Actual cash</Th>
              <Th>Cash variance</Th>
              <Th>Stock variance</Th>
              <Th>Submitted</Th>
              <Th>Status</Th>
              {canApprove && <Th className="text-right">Action</Th>}
            </tr>
          </thead>
          <tbody>
            {reconciliations.map((r) => (
              <Tr key={r.id}>
                <Td>
                  <span className="numeric block font-medium">{r.reconNumber}</span>
                  <span className="numeric text-xs text-[var(--text-muted)]">{r.vanCode}</span>
                </Td>
                <Td>{r.driverName}</Td>
                <Td numeric>{formatMoney(r.expectedCash)}</Td>
                <Td numeric>{formatMoney(r.actualCash)}</Td>
                <Td><VarianceBadge value={r.cashVariance} /></Td>
                <Td><VarianceBadge value={r.stockVariance} /></Td>
                <Td className="numeric whitespace-nowrap text-[var(--text-secondary)]">
                  {r.submittedAt ? formatDateTime(r.submittedAt) : "-"}
                </Td>
                <Td><StatusBadge status={r.status} /></Td>
                {canApprove && (
                  <Td className="text-right">{decidable(r) && decide(r)}</Td>
                )}
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      <ul className="divide-y divide-[var(--border-subtle)] pointer-fine:hidden">
        {reconciliations.map((r) => (
          <li key={r.id} className="px-5 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="numeric text-sm font-medium text-[var(--text-primary)]">
                  {r.reconNumber}
                </p>
                <p className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">
                  {r.driverName} · {r.vanCode}
                </p>
              </div>
              <StatusBadge status={r.status} />
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div>
                <dt className="text-[var(--text-muted)]">Expected cash</dt>
                <dd className="numeric mt-0.5 font-medium">{formatMoney(r.expectedCash)}</dd>
              </div>
              <div>
                <dt className="text-[var(--text-muted)]">Actual cash</dt>
                <dd className="numeric mt-0.5 font-medium">{formatMoney(r.actualCash)}</dd>
              </div>
            </dl>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <VarianceBadge value={r.cashVariance} />
              <VarianceBadge value={r.stockVariance} />
            </div>
            {r.explanation && (
              <p className="mt-1.5 text-xs text-[var(--text-secondary)]">{r.explanation}</p>
            )}
            {decidable(r) && <div className="mt-2.5">{decide(r)}</div>}
          </li>
        ))}
      </ul>
    </>
  );
}
