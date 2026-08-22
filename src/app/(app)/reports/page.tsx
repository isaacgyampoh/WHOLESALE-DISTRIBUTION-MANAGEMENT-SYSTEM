import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import {
  salesByProduct, salesByDriver, lowStockReport,
  customerBalanceReport, inventoryValueReport,
} from "@/features/reports/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card, CardHeader } from "@/components/ui/card";
import { ListFilters } from "@/components/ui/list-filters";
import { Badge } from "@/components/ui/badge";
import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { ExportLink } from "@/features/reports/export-link";
import { formatMoney, formatQuantity } from "@/lib/utils/format";
import { BarChart3, CircleCheck } from "lucide-react";

export const metadata: Metadata = { title: "Reports" };

const PERIODS: Record<string, number> = { "7": 7, "30": 30, "90": 90, "365": 365 };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user.role, "reports.view")) return <Forbidden />;

  const filters = await searchParams;
  const periodDays = PERIODS[filters.period ?? "30"] ?? 30;

  // Financial reports are not every role's business. A sales rep or a
  // driver holds reports.view for the operational ones only.
  const seesMoney = can(user.role, "credit.view");

  const [products, drivers, lowStock, balances, inventory] = await Promise.all([
    salesByProduct(periodDays),
    salesByDriver(periodDays),
    lowStockReport(),
    seesMoney ? customerBalanceReport() : Promise.resolve(null),
    inventoryValueReport(),
  ]);

  return (
    <>
      <PageHeader
        title="Reports"
        description={`Operational and financial summaries for the last ${periodDays} days.`}
        breadcrumbs={[{ label: "Insight" }, { label: "Reports" }]}
      />

      <ListFilters
        selects={[{
          name: "period", label: "Reporting period", allLabel: "Last 30 days",
          options: [
            { value: "7", label: "Last 7 days" },
            { value: "30", label: "Last 30 days" },
            { value: "90", label: "Last 90 days" },
            { value: "365", label: "Last year" },
          ],
          className: "lg:w-44",
        }]}
        count={periodDays}
        noun="day"
      />

      <div className="space-y-5">
        <Card className="overflow-hidden">
          <CardHeader title="Sales by product"
                      description="What is actually moving, ranked by revenue."
                      action={<ExportLink report="sales-by-product" periodDays={periodDays} />} />
          {!products.ok ? (
            <ErrorState title="Report unavailable" message={products.message} />
          ) : products.data.length === 0 ? (
            <EmptyState icon={BarChart3} title="No sales in this period"
                        description="Nothing has been sold in the window selected." />
          ) : (
            <TableWrap className="rounded-none border-0">
              <Table>
                <thead>
                  <tr>
                    <Th>Product</Th>
                    <Th numeric>Units sold</Th>
                    <Th numeric>Revenue</Th>
                  </tr>
                </thead>
                <tbody>
                  {products.data.slice(0, 20).map((p) => (
                    <Tr key={p.productId}>
                      <Td>
                        <span className="block font-medium">{p.name}</span>
                        <span className="numeric text-xs text-[var(--text-muted)]">{p.sku}</span>
                      </Td>
                      <Td numeric>{formatQuantity(p.quantity)}</Td>
                      <Td numeric>{formatMoney(p.revenue)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="Sales by driver"
                      description="Who sold what, and how much of it is still owed."
                      action={<ExportLink report="sales-by-driver" periodDays={periodDays} />} />
          {!drivers.ok ? (
            <ErrorState title="Report unavailable" message={drivers.message} />
          ) : drivers.data.length === 0 ? (
            <EmptyState icon={BarChart3} title="No sales in this period"
                        description="No driver recorded a sale in the window selected." />
          ) : (
            <TableWrap className="rounded-none border-0">
              <Table>
                <thead>
                  <tr>
                    <Th>Driver</Th>
                    <Th numeric>Sales</Th>
                    <Th numeric>Cash</Th>
                    <Th numeric>Credit</Th>
                    <Th numeric>Outstanding</Th>
                    <Th numeric>Total</Th>
                  </tr>
                </thead>
                <tbody>
                  {drivers.data.map((d) => (
                    <Tr key={d.driverId}>
                      <Td className="font-medium">{d.driverName}</Td>
                      <Td numeric>{formatQuantity(d.saleCount)}</Td>
                      <Td numeric>{formatMoney(d.cash)}</Td>
                      <Td numeric>{formatMoney(d.credit)}</Td>
                      <Td numeric className={d.outstanding > 0 ? "text-caution" : ""}>
                        {formatMoney(d.outstanding)}
                      </Td>
                      <Td numeric className="font-medium">{formatMoney(d.revenue)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="Low stock"
                      description="Lines at or below their reorder point, and how many to bring in."
                      action={<ExportLink report="low-stock" />} />
          {!lowStock.ok ? (
            <ErrorState title="Report unavailable" message={lowStock.message} />
          ) : lowStock.data.length === 0 ? (
            <EmptyState icon={CircleCheck} title="Nothing needs reordering"
                        description="Every active line is above its reorder point." />
          ) : (
            <TableWrap className="rounded-none border-0">
              <Table>
                <thead>
                  <tr>
                    <Th>Product</Th>
                    <Th numeric>Available</Th>
                    <Th numeric>Reorder at</Th>
                    <Th numeric>Order</Th>
                    <Th>State</Th>
                  </tr>
                </thead>
                <tbody>
                  {lowStock.data.map((p) => (
                    <Tr key={p.productId}>
                      <Td>
                        <span className="block font-medium">{p.name}</span>
                        <span className="numeric text-xs text-[var(--text-muted)]">{p.sku}</span>
                      </Td>
                      <Td numeric className={p.available <= 0 ? "text-critical" : "text-caution"}>
                        {formatQuantity(p.available)}
                      </Td>
                      <Td numeric>{formatQuantity(p.reorderPoint)}</Td>
                      <Td numeric>{formatQuantity(p.reorderQty)}</Td>
                      <Td>
                        <Badge tone={p.available <= 0 ? "critical" : "caution"}>
                          {p.available <= 0 ? "Out of stock" : "Low stock"}
                        </Badge>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="Inventory value by category"
                      description="Where the money on the shelves is sitting, at cost."
                      action={<ExportLink report="inventory-value" />} />
          {!inventory.ok ? (
            <ErrorState title="Report unavailable" message={inventory.message} />
          ) : inventory.data.length === 0 ? (
            <EmptyState icon={BarChart3} title="No stock to value"
                        description="No active product is carrying stock." />
          ) : (
            <TableWrap className="rounded-none border-0">
              <Table>
                <thead>
                  <tr>
                    <Th>Category</Th>
                    <Th numeric>Product lines</Th>
                    <Th numeric>Units</Th>
                    <Th numeric>Value at cost</Th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.data.map((c) => (
                    <Tr key={c.categoryName}>
                      <Td className="font-medium">{c.categoryName}</Td>
                      <Td numeric>{formatQuantity(c.productLines)}</Td>
                      <Td numeric>{formatQuantity(c.units)}</Td>
                      <Td numeric>{formatMoney(c.value)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>

        {balances && (
          <Card className="overflow-hidden">
            <CardHeader title="Customer balances"
                        description="Who owes what, and how far past due they are."
                        action={<ExportLink report="customer-balances" />} />
            {!balances.ok ? (
              <ErrorState title="Report unavailable" message={balances.message} />
            ) : balances.data.length === 0 ? (
              <EmptyState icon={CircleCheck} title="Nothing outstanding"
                          description="No customer is carrying a balance." />
            ) : (
              <TableWrap className="rounded-none border-0">
                <Table>
                  <thead>
                    <tr>
                      <Th>Customer</Th>
                      <Th numeric>Credit limit</Th>
                      <Th numeric>Balance</Th>
                      <Th numeric>Available</Th>
                      <Th>State</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {balances.data.map((c) => (
                      <Tr key={c.customerId}>
                        <Td>
                          <span className="block font-medium">{c.name}</span>
                          <span className="numeric text-xs text-[var(--text-muted)]">{c.code}</span>
                        </Td>
                        <Td numeric>{formatMoney(c.creditLimit)}</Td>
                        <Td numeric className={c.balance > 0 ? "text-caution" : ""}>
                          {formatMoney(c.balance)}
                        </Td>
                        <Td numeric>{formatMoney(c.creditAvailable)}</Td>
                        <Td>
                          <div className="flex flex-wrap gap-1.5">
                            {c.overLimit && <Badge tone="critical">Over limit</Badge>}
                            {(c.daysPastDue ?? 0) > 0 && (
                              <Badge tone="caution">{c.daysPastDue}d overdue</Badge>
                            )}
                            {!c.overLimit && !(c.daysPastDue ?? 0) && (
                              <Badge tone="positive">Within terms</Badge>
                            )}
                          </div>
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
