import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatQuantity, formatDate } from "@/lib/utils/format";
import type { BatchRow } from "./queries";

/**
 * Stock by batch, and how long each has left.
 *
 * The day count is what people act on - "expires in 4 days" prompts a
 * decision in a way that a date on its own does not - so it leads, and
 * the date follows for the record.
 */
const TONE: Record<BatchRow["status"], "critical" | "caution" | "positive" | "neutral"> = {
  expired: "critical",
  expiring: "caution",
  good: "positive",
  no_expiry: "neutral",
};

const LABEL: Record<BatchRow["status"], string> = {
  expired: "Expired",
  expiring: "Expiring",
  good: "Good",
  no_expiry: "No expiry",
};

function when(batch: BatchRow): string {
  if (batch.status === "no_expiry" || batch.expiresOn === null) return "Does not expire";
  const days = batch.daysToExpiry ?? 0;
  if (days < 0) return `${Math.abs(days)} days ago`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

export function BatchList({ batches }: { batches: BatchRow[] }) {
  return (
    <>
      <TableWrap className="hidden pointer-fine:block">
        <Table>
          <thead>
            <tr>
              <Th>Product</Th>
              <Th>Batch</Th>
              <Th>Where</Th>
              <Th>Expires</Th>
              <Th numeric>Remaining</Th>
              <Th numeric>Received</Th>
              <Th>State</Th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <Tr key={b.batchId}>
                <Td>
                  <span className="block font-medium">{b.productName}</span>
                  <span className="numeric text-xs text-[var(--text-muted)]">{b.sku}</span>
                </Td>
                <Td className="numeric">{b.batchNumber}</Td>
                <Td className="text-[var(--text-secondary)]">{b.warehouseName}</Td>
                <Td>
                  <span
                    className={
                      "block " +
                      (b.status === "expired" ? "text-critical"
                        : b.status === "expiring" ? "text-caution"
                        : "text-[var(--text-primary)]")
                    }
                  >
                    {when(b)}
                  </span>
                  {b.expiresOn && (
                    <span className="numeric text-xs text-[var(--text-muted)]">
                      {formatDate(b.expiresOn)}
                    </span>
                  )}
                </Td>
                <Td numeric className={b.status === "expired" ? "text-critical" : ""}>
                  {formatQuantity(b.qtyRemaining)}
                </Td>
                <Td numeric className="text-[var(--text-secondary)]">
                  {formatQuantity(b.qtyReceived)}
                </Td>
                <Td><Badge tone={TONE[b.status]}>{LABEL[b.status]}</Badge></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      <ul className="divide-y divide-[var(--border-subtle)] pointer-fine:hidden">
        {batches.map((b) => (
          <li key={b.batchId} className="px-5 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                  {b.productName}
                </p>
                <p className="numeric mt-0.5 truncate text-xs text-[var(--text-muted)]">
                  Batch {b.batchNumber} · {b.warehouseName}
                </p>
              </div>
              <Badge tone={TONE[b.status]}>{LABEL[b.status]}</Badge>
            </div>
            <p
              className={
                "mt-1.5 text-xs " +
                (b.status === "expired" ? "text-critical"
                  : b.status === "expiring" ? "text-caution"
                  : "text-[var(--text-secondary)]")
              }
            >
              {when(b)}{b.expiresOn ? ` · ${formatDate(b.expiresOn)}` : ""}
            </p>
            <p className="numeric mt-0.5 text-xs text-[var(--text-muted)]">
              {formatQuantity(b.qtyRemaining)} of {formatQuantity(b.qtyReceived)} left
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
