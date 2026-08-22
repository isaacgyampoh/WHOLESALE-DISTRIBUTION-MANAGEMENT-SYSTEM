import Link from "next/link";
import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/utils/format";
import type { CustomerRow } from "./queries";

/**
 * The customer book.
 *
 * Balance and credit headroom sit next to each other because that pair
 * is the decision a sales rep is actually making at the counter: can
 * this customer take more goods on credit right now.
 */
export function CustomerList({ customers }: { customers: CustomerRow[] }) {
  return (
    <>
      <TableWrap className="hidden pointer-fine:block">
        <Table>
          <thead>
            <tr>
              <Th>Customer</Th>
              <Th>Contact</Th>
              <Th>Location</Th>
              <Th numeric>Balance</Th>
              <Th numeric>Credit available</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <Tr key={c.id}>
                <Td>
                  <Link href={`/customers/${c.id}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                  <span className="numeric block text-xs text-[var(--text-muted)]">{c.code}</span>
                </Td>
                <Td className="text-[var(--text-secondary)]">
                  {c.contactName ?? "-"}
                  {c.phone && <span className="numeric block text-xs">{c.phone}</span>}
                </Td>
                <Td className="text-[var(--text-secondary)]">
                  {[c.city, c.region].filter(Boolean).join(", ") || "-"}
                </Td>
                <Td numeric className={c.balance > 0 ? "text-caution" : ""}>
                  {formatMoney(c.balance)}
                </Td>
                <Td numeric className={c.overLimit ? "text-critical" : ""}>
                  {formatMoney(c.creditAvailable)}
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone={c.isActive ? "positive" : "neutral"}>
                      {c.isActive ? "Active" : "Inactive"}
                    </Badge>
                    {c.overLimit && <Badge tone="critical">Over limit</Badge>}
                    {(c.daysPastDue ?? 0) > 0 && (
                      <Badge tone="caution">{c.daysPastDue}d overdue</Badge>
                    )}
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      <ul className="divide-y divide-[var(--border-subtle)] pointer-fine:hidden">
        {customers.map((c) => (
          <li key={c.id}>
            <Link href={`/customers/${c.id}`} className="block px-5 py-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{c.name}</p>
                  <p className="numeric mt-0.5 text-xs text-[var(--text-muted)]">
                    {c.code}{c.phone ? ` · ${c.phone}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                  {c.overLimit && <Badge tone="critical">Over limit</Badge>}
                  {!c.isActive && <Badge tone="neutral">Inactive</Badge>}
                </div>
              </div>
              <p className="numeric mt-1.5 text-xs text-[var(--text-secondary)]">
                Owes {formatMoney(c.balance)} · {formatMoney(c.creditAvailable)} available
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
