import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatQuantity } from "@/lib/utils/format";
import { WarehouseActions } from "./warehouse-forms";
import type { WarehouseRow } from "./queries";

/**
 * Where stock physically sits.
 *
 * A table on a pointer device, cards on a phone: the same figures, laid
 * out for the space available rather than scrolled sideways.
 */
export function WarehouseList({
  warehouses,
  canManage = false,
}: {
  warehouses: WarehouseRow[];
  canManage?: boolean;
}) {
  return (
    <>
      <TableWrap className="hidden pointer-fine:block">
        <Table>
          <thead>
            <tr>
              <Th>Warehouse</Th>
              <Th>Location</Th>
              <Th numeric>Product lines</Th>
              <Th numeric>Units on hand</Th>
              <Th numeric>Stock value</Th>
              <Th>Status</Th>
              {canManage && <Th className="text-right">Actions</Th>}
            </tr>
          </thead>
          <tbody>
            {warehouses.map((w) => (
              <Tr key={w.id}>
                <Td>
                  <span className="block font-medium">{w.name}</span>
                  <span className="numeric text-xs text-[var(--text-muted)]">{w.code}</span>
                </Td>
                <Td className="text-[var(--text-secondary)]">
                  {w.city ?? w.address ?? "-"}
                </Td>
                <Td numeric>{formatQuantity(w.productLines)}</Td>
                <Td numeric>{formatQuantity(w.unitsOnHand)}</Td>
                <Td numeric>{formatMoney(w.stockValue)}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1.5">
                    {w.isDefault && <Badge tone="brand">Default</Badge>}
                    <Badge tone={w.isActive ? "positive" : "neutral"}>
                      {w.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </Td>
                {canManage && <Td><WarehouseActions warehouse={w} /></Td>}
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      <ul className="divide-y divide-[var(--border-subtle)] pointer-fine:hidden">
        {warehouses.map((w) => (
          <li key={w.id} className="px-5 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)]">{w.name}</p>
                <p className="numeric mt-0.5 text-xs text-[var(--text-muted)]">
                  {w.code}{w.city ? ` · ${w.city}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                {w.isDefault && <Badge tone="brand">Default</Badge>}
                <Badge tone={w.isActive ? "positive" : "neutral"}>
                  {w.isActive ? "Active" : "Inactive"}
                </Badge>
              </div>
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <Cell label="Lines" value={formatQuantity(w.productLines)} />
              <Cell label="Units" value={formatQuantity(w.unitsOnHand)} />
              <Cell label="Value" value={formatMoney(w.stockValue)} />
            </dl>
            {canManage && (
              <div className="mt-2.5">
                <WarehouseActions warehouse={w} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[var(--text-muted)]">{label}</dt>
      <dd className="numeric mt-0.5 font-medium text-[var(--text-primary)]">{value}</dd>
    </div>
  );
}
