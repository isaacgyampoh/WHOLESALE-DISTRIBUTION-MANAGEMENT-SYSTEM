import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { getDashboardMetrics, getOpenVariances, getLowStock } from "@/features/dashboard/queries";
import { getDriverSummary } from "@/features/dashboard/driver-queries";
import { DriverDashboard } from "@/features/dashboard/driver-dashboard";
import { getSalespersonSummary } from "@/features/selling/queries";
import { SalespersonDashboard } from "@/features/dashboard/salesperson-dashboard";
import { StatTile } from "@/features/dashboard/stat-tile";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { StatusBadge, VarianceBadge } from "@/components/ui/badge";
import { EmptyState, ErrorState, Alert } from "@/components/ui/states";
import { formatMoney, formatQuantity } from "@/lib/utils/format";
import { toAppError } from "@/lib/errors/app-error";
import { CheckCircle2, PackageCheck } from "lucide-react";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser();

  // A driver sees their own round. The management tiles below query
  // company-wide views a driver cannot read, so they would render as a
  // wall of zeros rather than anything useful.
  if (user.role === "driver") {
    const driver = await loadDriver(user.id);
    return (
      <>
        <PageHeader
          title={`Good day, ${user.fullName.split(" ")[0]}`}
          description="Your van, what has sold from it today and what is still on board."
        />
        {driver.ok ? (
          <DriverDashboard summary={driver.data} />
        ) : (
          <Card>
            <ErrorState title="Your round could not be loaded" message={driver.message} />
          </Card>
        )}
      </>
    );
  }

  // A salesperson gets the same treatment for the same reason, and for
  // them the home screen is one step from the only thing they came to do.
  if (user.role === "sales_rep") {
    const seller = await loadSalesperson(user.id);
    return (
      <>
        <PageHeader
          title={`Good day, ${user.fullName.split(" ")[0]}`}
          description="Where you are selling from today, and what you have sold."
        />
        {seller.ok ? (
          <SalespersonDashboard summary={seller.data} />
        ) : (
          <Card>
            <ErrorState title="Your day could not be loaded" message={seller.message} />
          </Card>
        )}
      </>
    );
  }

  // Only the data fetch is guarded here. Wrapping the JSX in try/catch
  // would not catch render errors anyway - error.tsx handles those.
  const result = await loadDashboard(user.role);

  if (!result.ok) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <Card>
          <ErrorState title="The dashboard could not be loaded" message={result.message} />
        </Card>
      </>
    );
  }

  const { metrics, variances, lowStock } = result.data;

  return (
    <>
      <PageHeader
        title={`Good day, ${user.fullName.split(" ")[0]}`}
        description="Today's trading position and anything waiting on a decision."
      />

      {user.role === "manager" && (
        <div className="mb-5">
          <Alert tone="info" title="Scoped view">
            These figures cover only the product categories assigned to you.
          </Alert>
        </div>
      )}

      <section aria-label="Today" className="mb-6">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatTile
            label="Cash sales today"
            value={formatMoney(metrics.todaysCashSales)}
            sub={`${metrics.todaysSaleCount} van sale${metrics.todaysSaleCount === 1 ? "" : "s"} recorded`}
          />
          <StatTile
            label="Credit sales today"
            value={formatMoney(metrics.todaysCreditSales)}
            sub="Extended against customer limits"
          />
          <StatTile
            label="Outstanding receivables"
            value={formatMoney(metrics.outstandingReceivables)}
            sub={`${metrics.overdueCustomers} customer${metrics.overdueCustomers === 1 ? "" : "s"} past due`}
            tone={metrics.overdueCustomers > 0 ? "caution" : "neutral"}
            href="/credit"
          />
          <StatTile
            label="Pending reconciliations"
            value={formatQuantity(metrics.pendingReconciliations)}
            sub={
              metrics.openVariances > 0
                ? `${metrics.openVariances} with a variance`
                : "Awaiting manager review"
            }
            tone={metrics.pendingReconciliations > 0 ? "caution" : "neutral"}
            href="/reconciliation"
          />
        </div>
      </section>

      <section aria-label="Stock and fleet" className="mb-6">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatTile
            label="Warehouse stock"
            value={formatMoney(metrics.warehouseStockValue)}
            sub="At cost"
            href="/inventory"
          />
          <StatTile
            label="Stock on vans"
            value={formatMoney(metrics.vanStockValue)}
            sub="Currently out with drivers"
            href="/vans"
          />
          <StatTile
            label="Low stock lines"
            value={formatQuantity(metrics.lowStockCount)}
            sub="At or below reorder point"
            tone={metrics.lowStockCount > 0 ? "caution" : "neutral"}
          />
          <StatTile
            label="Active vans"
            value={formatQuantity(metrics.activeVans)}
            sub={`${metrics.activeDrivers} driver${metrics.activeDrivers === 1 ? "" : "s"} assigned`}
            href="/vans"
          />
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        {can(user.role, "reconciliation.view") && (
          <Card>
            <CardHeader
              title="Variances awaiting review"
              description="A driver cannot clear their own variance."
              action={
                <Link href="/reconciliation" className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">
                  View all
                </Link>
              }
            />
            {variances.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="Nothing outstanding"
                description="Every submitted reconciliation has been reviewed."
              />
            ) : (
              <TableWrap className="rounded-t-none border-0">
                <Table>
                  <thead>
                    <tr>
                      <Th>Reference</Th>
                      <Th>Driver</Th>
                      <Th numeric>Cash</Th>
                      <Th numeric>Stock</Th>
                      <Th>Status</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {variances.map((v) => (
                      <Tr key={v.id}>
                        <Td className="font-medium">{v.reconNumber}</Td>
                        <Td>
                          <span className="block">{v.driverName}</span>
                          <span className="text-xs text-[var(--text-muted)]">{v.vanCode}</span>
                        </Td>
                        <Td numeric><VarianceBadge value={v.cashVariance} /></Td>
                        <Td numeric><VarianceBadge value={v.stockVariance} /></Td>
                        <Td><StatusBadge status={v.status} /></Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            )}
          </Card>
        )}

        {can(user.role, "inventory.view") && (
          <Card>
            <CardHeader
              title="Reorder queue"
              description="Available stock at or below the reorder point."
              action={
                <Link href="/inventory" className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">
                  View stock
                </Link>
              }
            />
            {lowStock.length === 0 ? (
              <EmptyState
                icon={PackageCheck}
                title="Stock levels are healthy"
                description="No product has fallen to its reorder point."
              />
            ) : (
              <TableWrap className="rounded-t-none border-0">
                <Table>
                  <thead>
                    <tr>
                      <Th>Product</Th>
                      <Th numeric>Available</Th>
                      <Th numeric>Reorder at</Th>
                      <Th numeric>Suggested</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {lowStock.map((p) => (
                      <Tr key={p.productId}>
                        <Td>
                          <span className="block font-medium">{p.name}</span>
                          <span className="text-xs text-[var(--text-muted)]">{p.sku}</span>
                        </Td>
                        <Td numeric className="text-critical">{formatQuantity(p.qtyAvailable)}</Td>
                        <Td numeric>{formatQuantity(p.reorderPoint)}</Td>
                        <Td numeric>{formatQuantity(p.reorderQty)}</Td>
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

interface DashboardData {
  metrics: Awaited<ReturnType<typeof getDashboardMetrics>>;
  variances: Awaited<ReturnType<typeof getOpenVariances>>;
  lowStock: Awaited<ReturnType<typeof getLowStock>>;
}

type LoadResult =
  | { ok: true; data: DashboardData }
  | { ok: false; message: string };

type DriverResult =
  | { ok: true; data: Awaited<ReturnType<typeof getDriverSummary>> }
  | { ok: false; message: string };

type SalespersonResult =
  | { ok: true; data: Awaited<ReturnType<typeof getSalespersonSummary>> }
  | { ok: false; message: string };

async function loadSalesperson(userId: string): Promise<SalespersonResult> {
  try {
    return { ok: true, data: await getSalespersonSummary(userId) };
  } catch (error) {
    console.error("[dashboard] salesperson summary failed", error);
    return { ok: false, message: toAppError(error).userMessage };
  }
}

async function loadDriver(userId: string): Promise<DriverResult> {
  try {
    return { ok: true, data: await getDriverSummary(userId) };
  } catch (error) {
    console.error("[dashboard] driver summary failed", error);
    return { ok: false, message: toAppError(error).userMessage };
  }
}

/** Fetches everything the dashboard needs, converting failure into a value. */
async function loadDashboard(role: Parameters<typeof can>[0]): Promise<LoadResult> {
  try {
    const [metrics, variances, lowStock] = await Promise.all([
      getDashboardMetrics(),
      can(role, "reconciliation.view") ? getOpenVariances() : Promise.resolve([]),
      can(role, "inventory.view") ? getLowStock() : Promise.resolve([]),
    ]);
    return { ok: true, data: { metrics, variances, lowStock } };
  } catch (error) {
    // Full detail to the server log, safe message to the operator.
    console.error("[dashboard] failed to load", error);
    return { ok: false, message: toAppError(error).userMessage };
  }
}
