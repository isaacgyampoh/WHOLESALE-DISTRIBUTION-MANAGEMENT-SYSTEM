import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { MOVEMENT_LABELS, movementDirection } from "@/lib/catalogue/units";
import { formatDateTime, formatQuantity } from "@/lib/utils/format";
import { formatHolding } from "@/lib/catalogue/quantity";
import type { MovementRow } from "./queries";

/**
 * The stock ledger.
 *
 * Quantity is stored positive and the direction comes from the type, so
 * it is shown signed here: what a reader needs to know is whether stock
 * went up or down.
 */
/**
 * What a movement moved.
 *
 * A movement carries full units, loose pieces, or both, and one
 * direction governs the lot - so the sign sits outside this and the
 * two halves read together: "+2 Cartons + 3 Pieces". Bare number for
 * the overwhelming majority, which move units only.
 */
function moved(m: { quantity: number; pieces?: number; unit?: string }): string {
  const pieces = Number(m.pieces ?? 0);
  if (pieces === 0) return formatQuantity(m.quantity);
  return formatHolding(
    { units: m.quantity, pieces },
    m.unit ?? "unit",
    { empty: "0" },
  );
}

export function MovementList({
  movements,
  showProduct = true,
}: {
  movements: MovementRow[];
  showProduct?: boolean;
}) {
  return (
    <>
      <TableWrap className="hidden rounded-none border-0 pointer-fine:block">
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              {showProduct && <Th>Product</Th>}
              <Th>Movement</Th>
              <Th numeric>Quantity</Th>
              <Th>Where</Th>
              <Th>Reason</Th>
              <Th>By</Th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => {
              const sign = movementDirection(m.type);
              return (
                <Tr key={m.id}>
                  <Td className="numeric whitespace-nowrap text-[var(--text-secondary)]">
                    {formatDateTime(m.occurredAt)}
                  </Td>
                  {showProduct && (
                    <Td>
                      <span className="block font-medium">{m.productName}</span>
                      <span className="numeric text-xs text-[var(--text-muted)]">{m.productSku}</span>
                    </Td>
                  )}
                  <Td>
                    <Badge tone={sign > 0 ? "positive" : "caution"}>
                      {MOVEMENT_LABELS[m.type] ?? m.type}
                    </Badge>
                  </Td>
                  <Td numeric className={sign > 0 ? "text-positive" : "text-caution"}>
                    {sign > 0 ? "+" : "-"}{moved(m)}
                  </Td>
                  <Td className="text-[var(--text-secondary)]">{m.warehouseName ?? "Van"}</Td>
                  <Td className="text-[var(--text-secondary)]">
                    {m.reason ?? m.referenceType?.replace(/_/g, " ") ?? "-"}
                  </Td>
                  <Td className="text-[var(--text-secondary)]">{m.actorName ?? "System"}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </TableWrap>

      <ul className="divide-y divide-[var(--border-subtle)] pointer-fine:hidden">
        {movements.map((m) => {
          const sign = movementDirection(m.type);
          return (
            <li key={m.id} className="px-5 py-3">
              <div className="flex items-start justify-between gap-3">
                <Badge tone={sign > 0 ? "positive" : "caution"}>
                  {MOVEMENT_LABELS[m.type] ?? m.type}
                </Badge>
                <span className={`numeric shrink-0 font-medium ${sign > 0 ? "text-positive" : "text-caution"}`}>
                  {sign > 0 ? "+" : "-"}{moved(m)}
                </span>
              </div>
              {showProduct && (
                <p className="mt-1.5 text-sm font-medium text-[var(--text-primary)]">
                  {m.productName}
                </p>
              )}
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                {m.reason ?? m.referenceType?.replace(/_/g, " ") ?? "No reason recorded"}
              </p>
              <p className="numeric mt-0.5 text-xs text-[var(--text-muted)]">
                {formatDateTime(m.occurredAt)} · {m.actorName ?? "System"}
              </p>
            </li>
          );
        })}
      </ul>
    </>
  );
}
