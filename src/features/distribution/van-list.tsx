import Link from "next/link";
import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatQuantity } from "@/lib/utils/format";
import { VanActions, type Option } from "./van-forms";
import type { VanRow } from "./queries";

/**
 * The fleet, with who is driving each van and what it is carrying.
 *
 * A van holding stock with no driver assigned is worth noticing, so the
 * driver column says "Unassigned" rather than being left blank.
 */
export function VanList({
  vans,
  warehouses = [],
  drivers = [],
  salespeople = [],
  canManage = false,
}: {
  vans: VanRow[];
  warehouses?: Option[];
  drivers?: Option[];
  /** Field salespeople who can be put on a van. */
  salespeople?: Option[];
  canManage?: boolean;
}) {
  return (
    <>
      <TableWrap className="hidden pointer-fine:block">
        <Table>
          <thead>
            <tr>
              <Th>Van</Th>
              <Th>Driver</Th>
              <Th>Selling</Th>
              <Th>Home warehouse</Th>
              <Th numeric>Lines</Th>
              <Th numeric>Units</Th>
              <Th numeric>Stock value</Th>
              <Th>Status</Th>
              {canManage && <Th className="text-right">Actions</Th>}
            </tr>
          </thead>
          <tbody>
            {vans.map((v) => (
              <Tr key={v.id}>
                <Td>
                  <Link href={`/vans/${v.id}/crew`} className="block font-medium hover:underline">
                    {v.code}
                  </Link>
                  <span className="numeric text-xs text-[var(--text-muted)]">
                    {v.registrationNo}
                    {v.make ? ` · ${v.make}${v.model ? ` ${v.model}` : ""}` : ""}
                  </span>
                </Td>
                {/* Two jobs, listed apart. A van with a driver and
                    nobody selling cannot go out, and that has to be
                    visible before somebody tries to dispatch it. */}
                <Td className={v.driverName ? "" : "text-[var(--text-muted)]"}>
                  {v.driverName ?? "No driver"}
                </Td>
                <Td className={v.salespeople.length ? "" : "text-[var(--text-muted)]"}>
                  {v.salespeople.length === 0
                    ? "Nobody selling"
                    : v.salespeople.map((p) => p.name).join(", ")}
                </Td>
                <Td className="text-[var(--text-secondary)]">{v.homeWarehouse ?? "-"}</Td>
                <Td numeric>{formatQuantity(v.stockLines)}</Td>
                <Td numeric>{formatQuantity(v.stockUnits)}</Td>
                <Td numeric>{formatMoney(v.stockValue)}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone={v.isActive ? "positive" : "neutral"}>
                      {v.isActive ? "Active" : "Inactive"}
                    </Badge>
                    {/*
                      A link, not a label.
                      
                      Everything done to a van mid-week - sending it more
                      stock, taking some back - lives on its round's own
                      page, and the person thinking "Kennedy needs more
                      soap" starts here, at the van. Without this they
                      have to know the round's number and find it in
                      another list.
                    */}
                    {v.openLoad && v.openLoadId ? (
                      <Link href={`/loads/${v.openLoadId}`}>
                        <Badge tone="brand">
                          On {v.openLoad}
                          {v.isOnRound ? " · top up or take back" : ""}
                        </Badge>
                      </Link>
                    ) : v.openLoad ? (
                      <Badge tone="brand">On {v.openLoad}</Badge>
                    ) : null}
                  </div>
                </Td>
                {canManage && (
                  <Td>
                    <VanActions van={v} warehouses={warehouses} drivers={drivers}
                                salespeople={salespeople} />
                  </Td>
                )}
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      <ul className="divide-y divide-[var(--border-subtle)] pointer-fine:hidden">
        {vans.map((v) => (
          <li key={v.id} className="px-5 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={`/vans/${v.id}/crew`}
                      className="block truncate text-sm font-medium text-[var(--text-primary)]">
                  {v.code}
                </Link>
                <p className="numeric mt-0.5 truncate text-xs text-[var(--text-muted)]">
                  {v.registrationNo}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                <Badge tone={v.isActive ? "positive" : "neutral"}>
                  {v.isActive ? "Active" : "Inactive"}
                </Badge>
                {v.openLoad && v.openLoadId ? (
                  <Link href={`/loads/${v.openLoadId}`}>
                    <Badge tone="brand">
                      On {v.openLoad}
                      {v.isOnRound ? " · top up" : ""}
                    </Badge>
                  </Link>
                ) : v.openLoad ? (
                  <Badge tone="brand">On {v.openLoad}</Badge>
                ) : null}
              </div>
            </div>
            <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
              Driver: {v.driverName ?? "none"}
            </p>
            <p className="text-xs text-[var(--text-secondary)]">
              Selling: {v.salespeople.length === 0
                ? "nobody"
                : v.salespeople.map((p) => p.name).join(", ")}
            </p>
            <p className="numeric mt-0.5 text-xs text-[var(--text-muted)]">
              {formatQuantity(v.stockUnits)} units on board · {formatMoney(v.stockValue)}
            </p>
            {canManage && (
              <div className="mt-2.5">
                <VanActions van={v} warehouses={warehouses} drivers={drivers}
                            salespeople={salespeople} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
