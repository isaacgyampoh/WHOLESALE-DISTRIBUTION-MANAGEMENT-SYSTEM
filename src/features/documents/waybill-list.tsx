import Link from "next/link";
import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatQuantity } from "@/lib/utils/format";
import type { WaybillSummaryRow } from "./queries";

export const WAYBILL_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  issued: "Out",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const TONE: Record<string, "positive" | "caution" | "critical" | "neutral" | "info"> = {
  draft: "neutral",
  issued: "info",
  delivered: "positive",
  cancelled: "neutral",
};

export function WaybillList({ waybills }: { waybills: WaybillSummaryRow[] }) {
  return (
    <>
      <TableWrap className="hidden pointer-fine:block">
        <Table>
          <thead>
            <tr>
              <Th>Waybill</Th>
              <Th>Issued</Th>
              <Th>To</Th>
              <Th>Carried by</Th>
              <Th numeric>Lines</Th>
              <Th numeric>Units</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {waybills.map((w) => (
              <Tr key={w.id}>
                <Td className="numeric font-medium">
                  <Link href={`/waybills/${w.id}`} className="hover:underline">
                    {w.waybillNumber}
                  </Link>
                </Td>
                <Td className="numeric whitespace-nowrap text-[var(--text-secondary)]">
                  {formatDate(w.issuedOn)}
                </Td>
                <Td>{w.destination}</Td>
                <Td className="text-[var(--text-secondary)]">{w.driverName ?? "—"}</Td>
                <Td numeric>{formatQuantity(w.itemCount)}</Td>
                <Td numeric>{formatQuantity(w.totalQuantity)}</Td>
                <Td>
                  <Badge tone={TONE[w.status] ?? "neutral"}>
                    {WAYBILL_STATUS_LABELS[w.status] ?? w.status}
                  </Badge>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      <ul className="divide-y divide-[var(--border-subtle)] pointer-fine:hidden">
        {waybills.map((w) => (
          <li key={w.id}>
            <Link href={`/waybills/${w.id}`} className="block px-5 py-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{w.destination}</p>
                  <p className="numeric mt-0.5 text-xs text-[var(--text-muted)]">
                    {w.waybillNumber}
                  </p>
                </div>
                <span className="numeric shrink-0 text-sm text-[var(--text-secondary)]">
                  {formatQuantity(w.totalQuantity)} units
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <Badge tone={TONE[w.status] ?? "neutral"}>
                  {WAYBILL_STATUS_LABELS[w.status] ?? w.status}
                </Badge>
                <span className="numeric text-xs text-[var(--text-muted)]">
                  {formatDate(w.issuedOn)}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
