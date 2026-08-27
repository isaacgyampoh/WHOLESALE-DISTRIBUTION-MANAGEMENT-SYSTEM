import type { Metadata } from "next";
import Link from "next/link";
import { Eye, Truck } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { getMyVan } from "@/features/van/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { EmptyState, Alert } from "@/components/ui/states";
import { formatMoney, formatQuantity, formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "My van" };

/**
 * The van, for the people on it.
 *
 * For the driver this is read-only by design: they answer for the stock,
 * they can see every unit that left and who sold it, and there is no
 * control here that changes anything. That is not a UI decision - a
 * driver is refused a sale and refused a stock movement by the database
 * as well.
 */
export default async function MyVanPage() {
  const user = await requirePermission("vans.crew");
  const van = await getMyVan(user.id);

  if (!van) {
    return (
      <>
        <PageHeader title="My van" />
        <Card>
          <EmptyState
            icon={Truck}
            title="You are not on a van at the moment"
            description="A manager assigns the crew for each van. Once you are assigned, your van and its stock appear here."
          />
        </Card>
      </>
    );
  }

  const isDriver = van.myCrewRole === "driver";
  const driver = van.crew.find((c) => c.crewRole === "driver");
  const sellers = van.crew.filter((c) => c.crewRole === "salesperson");

  return (
    <>
      <PageHeader
        title={van.code}
        description={van.registration}
        actions={
          van.loadStatus ? <StatusBadge status={van.loadStatus} /> : undefined
        }
      />

      {isDriver && (
        <div className="mb-5">
          <Alert tone="info" title="This screen is yours to read, not to change">
            <span className="inline-flex items-center gap-1.5">
              <Eye className="size-3.5" aria-hidden />
              You keep the van; sales are made by the salesperson crewed with you,
              and appear here as they happen.
            </span>
          </Alert>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Figure label="Lines on board" value={formatQuantity(van.stock.filter((s) => s.remaining > 0).length)} />
        <Figure label="Units sold today" value={formatQuantity(van.unitsSoldToday)} />
        <Figure label="Cash sales today" value={formatMoney(van.cashSalesToday)} />
        <Figure label="Credit sales today" value={formatMoney(van.creditSalesToday)} />
      </div>

      <div className="mb-5 grid gap-5 xl:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader
            title="Stock on this van"
            description="What was on board before today's selling, what went, what is left."
          />
          {van.stock.length === 0 ? (
            <EmptyState
              title="The van is empty"
              description="Nothing has been loaded onto this van yet."
            />
          ) : (
            <TableWrap className="rounded-t-none border-0">
              <Table>
                <thead>
                  <tr>
                    <Th>Product</Th>
                    <Th numeric>Before sales</Th>
                    <Th numeric>Sold today</Th>
                    <Th numeric>Remaining</Th>
                  </tr>
                </thead>
                <tbody>
                  {van.stock.map((s) => (
                    <Tr key={s.productId}>
                      <Td>
                        <span className="block font-medium">{s.name}</span>
                        <span className="text-xs text-[var(--text-muted)]">{s.sku}</span>
                      </Td>
                      <Td numeric>{formatQuantity(s.beforeSales)}</Td>
                      <Td numeric className={s.soldToday > 0 ? "text-brand-700 dark:text-brand-300" : undefined}>
                        {s.soldToday > 0 ? `-${formatQuantity(s.soldToday)}` : "-"}
                      </Td>
                      <Td numeric className={s.remaining === 0 ? "text-critical" : "font-medium"}>
                        {formatQuantity(s.remaining)} {s.unit}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>

        <Card>
          <CardHeader title="Crew" description="Who is on this van today." />
          <CardBody className="space-y-3 text-sm">
            <CrewRow label="Driver" names={driver ? [driver.name] : []} empty="No driver assigned" />
            <CrewRow
              label="Salesperson"
              names={sellers.map((s) => s.name)}
              empty="No salesperson assigned"
            />
            {van.loadNumber && (
              <div className="border-t border-[var(--border-subtle)] pt-3">
                <p className="text-xs text-[var(--text-muted)]">Current load</p>
                <p className="font-medium text-[var(--text-primary)]">{van.loadNumber}</p>
                <p className="text-xs text-[var(--text-secondary)]">
                  Opening float {formatMoney(van.openingFloat)}
                </p>
              </div>
            )}
            {sellers.length === 0 && (
              <Alert tone="warning">
                Nobody on this van can sell. A manager assigns a salesperson to the crew.
              </Alert>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Sales from this van today"
          description="Made by the salesperson; shown here so the van's stock adds up."
        />
        {van.salesToday.length === 0 ? (
          <EmptyState title="No sales yet today" />
        ) : (
          <TableWrap className="rounded-t-none border-0">
            <Table>
              <thead>
                <tr>
                  <Th>Receipt</Th>
                  <Th>Customer</Th>
                  <Th>Sold by</Th>
                  <Th numeric>Units</Th>
                  <Th numeric>Amount</Th>
                  <Th>Time</Th>
                </tr>
              </thead>
              <tbody>
                {van.salesToday.map((s) => (
                  <Tr key={s.saleId}>
                    <Td className="font-medium">
                      {can(user.role, "sales.view") ? (
                        <Link href={`/sell/${s.saleId}/receipt`} className="hover:underline">
                          {s.saleNumber}
                        </Link>
                      ) : (
                        s.saleNumber
                      )}
                    </Td>
                    <Td>{s.customerName}</Td>
                    <Td>{s.salespersonName ?? "-"}</Td>
                    <Td numeric>{formatQuantity(s.units)}</Td>
                    <Td numeric>
                      {formatMoney(s.total)}
                      {s.saleType === "credit" && (
                        <Badge tone="caution" className="ml-2">Credit</Badge>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-[var(--text-secondary)]">
                      {formatDateTime(s.soldAt)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardBody className="py-4">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <p className="numeric mt-1 text-lg font-semibold text-[var(--text-primary)]">{value}</p>
      </CardBody>
    </Card>
  );
}

function CrewRow({ label, names, empty }: { label: string; names: string[]; empty: string }) {
  return (
    <div>
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      {names.length === 0 ? (
        <p className="text-[var(--text-secondary)]">{empty}</p>
      ) : (
        names.map((n) => (
          <p key={n} className="font-medium text-[var(--text-primary)]">{n}</p>
        ))
      )}
    </div>
  );
}
