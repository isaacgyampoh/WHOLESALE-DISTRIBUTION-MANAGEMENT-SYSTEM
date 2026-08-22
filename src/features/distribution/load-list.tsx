import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { StatusBadge, VarianceBadge } from "@/components/ui/badge";
import { formatMoney, formatQuantity, formatDate } from "@/lib/utils/format";
import { DispatchButton } from "./load-form";
import type { LoadRow } from "./queries";

/**
 * Loads dispatched to vans.
 *
 * A load that has come back but has no reconciliation yet is the thing
 * a supervisor is looking for, so the variance column shows "Awaiting"
 * rather than a zero that would read as "balanced".
 */
export function LoadList({
  loads,
  canDispatch = false,
}: {
  loads: LoadRow[];
  canDispatch?: boolean;
}) {
  // Only a load that is built and not yet gone can be dispatched.
  const dispatchable = (status: string) => canDispatch && status === "loaded";
  return (
    <>
      <TableWrap className="hidden pointer-fine:block">
        <Table>
          <thead>
            <tr>
              <Th>Load</Th>
              <Th>Van</Th>
              <Th>Driver</Th>
              <Th>Date</Th>
              <Th numeric>Loaded</Th>
              <Th numeric>Sales</Th>
              <Th>Cash variance</Th>
              <Th>Status</Th>
              {canDispatch && <Th className="text-right">Action</Th>}
            </tr>
          </thead>
          <tbody>
            {loads.map((l) => (
              <Tr key={l.id}>
                <Td>
                  <span className="numeric block font-medium">{l.loadNumber}</span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {l.lineCount} {l.lineCount === 1 ? "line" : "lines"}
                  </span>
                </Td>
                <Td className="numeric">{l.vanCode}</Td>
                <Td>{l.driverName}</Td>
                <Td className="numeric whitespace-nowrap text-[var(--text-secondary)]">
                  {formatDate(l.loadDate)}
                </Td>
                <Td numeric>{formatMoney(l.loadedValue)}</Td>
                <Td numeric>
                  {formatMoney(l.cashSales + l.creditSales)}
                  <span className="block text-xs text-[var(--text-muted)]">
                    {formatQuantity(l.saleCount)} {l.saleCount === 1 ? "sale" : "sales"}
                  </span>
                </Td>
                <Td>
                  {l.cashVariance === null ? (
                    <span className="text-xs text-[var(--text-muted)]">Awaiting</span>
                  ) : (
                    <VarianceBadge value={l.cashVariance} />
                  )}
                </Td>
                <Td><StatusBadge status={l.status} /></Td>
                {canDispatch && (
                  <Td className="text-right">
                    {dispatchable(l.status) && (
                      <DispatchButton loadId={l.id} loadNumber={l.loadNumber} />
                    )}
                  </Td>
                )}
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      <ul className="divide-y divide-[var(--border-subtle)] pointer-fine:hidden">
        {loads.map((l) => (
          <li key={l.id} className="px-5 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="numeric text-sm font-medium text-[var(--text-primary)]">
                  {l.loadNumber}
                </p>
                <p className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">
                  {l.vanCode} · {l.driverName}
                </p>
              </div>
              <StatusBadge status={l.status} />
            </div>
            <p className="numeric mt-2 text-xs text-[var(--text-secondary)]">
              Loaded {formatMoney(l.loadedValue)} · sold{" "}
              {formatMoney(l.cashSales + l.creditSales)}
            </p>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="numeric text-xs text-[var(--text-muted)]">
                {formatDate(l.loadDate)}
              </span>
              {l.cashVariance === null ? (
                <span className="text-xs text-[var(--text-muted)]">Awaiting reconciliation</span>
              ) : (
                <VarianceBadge value={l.cashVariance} />
              )}
            </div>
            {dispatchable(l.status) && (
              <div className="mt-2.5">
                <DispatchButton loadId={l.id} loadNumber={l.loadNumber} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
