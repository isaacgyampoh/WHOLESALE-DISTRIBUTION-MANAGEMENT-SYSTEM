import Link from "next/link";
import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatQuantity } from "@/lib/utils/format";
import type { TransferRow } from "./queries";
import { ArrowRight } from "lucide-react";

export const TRANSFER_STATUS_LABELS: Record<string, string> = {
  draft: "Awaiting approval",
  approved: "Approved",
  in_transit: "In transit",
  received: "Received",
  cancelled: "Cancelled",
};

const TONE: Record<string, "positive" | "caution" | "critical" | "neutral" | "info"> = {
  draft: "caution",
  approved: "info",
  in_transit: "info",
  received: "positive",
  cancelled: "neutral",
};

export function TransferList({ transfers }: { transfers: TransferRow[] }) {
  return (
    <>
      <TableWrap className="hidden pointer-fine:block">
        <Table>
          <thead>
            <tr>
              <Th>Transfer</Th>
              <Th>Raised</Th>
              <Th>Route</Th>
              <Th numeric>Lines</Th>
              <Th numeric>Sent</Th>
              <Th numeric>Short</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {transfers.map((t) => (
              <Tr key={t.id}>
                <Td className="numeric font-medium">
                  <Link href={`/transfers/${t.id}`} className="hover:underline">
                    {t.transferNumber}
                  </Link>
                </Td>
                <Td className="numeric whitespace-nowrap text-[var(--text-secondary)]">
                  {formatDate(t.transferDate)}
                </Td>
                <Td>
                  <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
                    {t.fromWarehouse}
                    <ArrowRight className="size-3.5 shrink-0" aria-label="to" />
                    {t.toWarehouse}
                  </span>
                </Td>
                <Td numeric>{formatQuantity(t.lineCount)}</Td>
                <Td numeric>{formatQuantity(t.qtySent)}</Td>
                {/* Only meaningful once something has been counted at the
                    other end, so a transfer still on the road shows a
                    dash rather than a reassuring zero. */}
                <Td numeric className={t.qtyShort > 0 ? "text-critical" : ""}>
                  {t.status === "received" ? formatQuantity(t.qtyShort) : "—"}
                </Td>
                <Td>
                  <Badge tone={TONE[t.status] ?? "neutral"}>
                    {TRANSFER_STATUS_LABELS[t.status] ?? t.status}
                  </Badge>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      <ul className="divide-y divide-[var(--border-subtle)] pointer-fine:hidden">
        {transfers.map((t) => (
          <li key={t.id}>
            <Link href={`/transfers/${t.id}`} className="block px-5 py-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)]">
                    <span className="truncate">{t.fromWarehouse}</span>
                    <ArrowRight className="size-3.5 shrink-0" aria-label="to" />
                    <span className="truncate">{t.toWarehouse}</span>
                  </p>
                  <p className="numeric mt-0.5 text-xs text-[var(--text-muted)]">
                    {t.transferNumber}
                  </p>
                </div>
                <span className="numeric shrink-0 text-sm text-[var(--text-secondary)]">
                  {formatQuantity(t.qtySent)} units
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <Badge tone={TONE[t.status] ?? "neutral"}>
                  {TRANSFER_STATUS_LABELS[t.status] ?? t.status}
                </Badge>
                {t.status === "received" && t.qtyShort > 0 ? (
                  <span className="numeric text-xs text-critical">
                    {formatQuantity(t.qtyShort)} short
                  </span>
                ) : (
                  <span className="numeric text-xs text-[var(--text-muted)]">
                    {formatDate(t.transferDate)}
                  </span>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
