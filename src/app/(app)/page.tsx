import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { getDashboardMetrics, getOpenVariances, getLowStock } from "@/features/dashboard/queries";
import { getDriverSummary } from "@/features/dashboard/driver-queries";
import { refreshStandingAlerts } from "@/features/notifications/queries";
import {
  getAccountantView, getWarehouseView, getAdminView,
} from "@/features/dashboard/role-queries";
import { AccountantDashboard } from "@/features/dashboard/accountant-dashboard";
import { WarehouseDashboard } from "@/features/dashboard/warehouse-dashboard";
import { AdminPanel } from "@/features/dashboard/admin-panel";
import { DriverDashboard } from "@/features/dashboard/driver-dashboard";
import { StatTile } from "@/components/ui/stat-tile";
import { HeroCard, HeroProgress } from "@/components/ui/hero-card";
import { getExpirySummary } from "@/features/warehouses/queries";
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

  // Recompute the standing conditions - low stock, money past due,
  // goods still on the road - while somebody is here to read them.
  // Doing it on the dashboard rather than on a schedule means
  // notifications work on a database with no cron installed, and the
  // conditions are recomputed in place so this cannot pile up.
  await refreshStandingAlerts();

  // A driver sees their own round. The management tiles below query
  // company-wide views a driver cannot read, so they would render as a
  // wall of zeros rather than anything useful.
  if (user.role === "driver") {
    const driver = await loadDriver(user.id);
    return (
      <>
        <PageHeader
          title={`Good day, ${user.fullName.split(" ")[0]}`}
          description="Your van, today's takings and what is still on board."
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


  // Each job gets the numbers it is accountable for. One dashboard for
  // everybody is a dashboard for nobody: the accountant opens it to find
  // out what is owed and the warehouse to find out what has to move, and
  // neither should have to read past the other's figures to get there.
  if (user.role === "accountant") {
    const view = await guard(getAccountantView);
    return (
      <>
        <PageHeader
          title={`Good day, ${user.fullName.split(" ")[0]}`}
          description="What is owed, how old it is, and what came in."
        />
        {view.ok ? (
          <AccountantDashboard view={view.data} />
        ) : (
          <Card><ErrorState title="The dashboard could not be loaded" message={view.message} /></Card>
        )}
      </>
    );
  }

  if (user.role === "warehouse") {
    const view = await guard(getWarehouseView);
    return (
      <>
        <PageHeader
          title={`Good day, ${user.fullName.split(" ")[0]}`}
          description="What has to move today, and what is holding something else up."
        />
        {view.ok ? (
          <WarehouseDashboard view={view.data} />
        ) : (
          <Card><ErrorState title="The dashboard could not be loaded" message={view.message} /></Card>
        )}
      </>
    );
  }

  // Only the data fetch is guarded here. Wrapping the JSX in try/catch
  // would not catch render errors anyway - error.tsx handles those.
  const result = await loadDashboard(user.role);
  const admin = can(user.role, "users.manage") ? await guard(getAdminView) : null;

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

  const { metrics, variances, lowStock, expiry } = result.data;

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

      {/* Expiry leads the alerts: stock that has gone off is money
          already lost, and stock about to go off is the only kind that
          can still be sold in time. */}
      {expiry && expiry.expiredUnits > 0 && (
        <div className="mb-5">
          <Alert tone="danger" title="Expired stock in the warehouse">
            {formatQuantity(expiry.expiredUnits)} units across{" "}
            {expiry.expiredBatches} {expiry.expiredBatches === 1 ? "batch" : "batches"} are
            past their date. A van will not dispatch while they are on hand.{" "}
            <Link href="/inventory/expiry?status=expired" className="underline">
              Write them off
            </Link>
          </Alert>
        </div>
      )}

      {expiry && expiry.expiredUnits === 0 && expiry.expiringUnits > 0 && (
        <div className="mb-5">
          <Alert tone="warning" title="Stock is going out of date">
            {formatQuantity(expiry.expiringUnits)} units are inside the warning
            period.{" "}
            <Link href="/inventory/expiry?status=expiring" className="underline">
              See what to move first
            </Link>
          </Alert>
        </div>
      )}

      {/*
        The day, led by the day.

        This was eight tiles of identical weight - the same size, box and
        border for the takings, the receivables and the van count - so
        the screen ranked nothing and the reader had to. On a phone, where
        the row becomes a column, it was eight boxes deep before anything
        was said.

        Now the state of the day leads, the money sits beside the thing
        that needs a decision, and the rest goes quiet underneath. Only
        the decision card is painted, and only while there is a decision
        to make: a screen where everything shouts says nothing.
      */}
      <section aria-label="Today" className="mb-6 space-y-3">
        <HeroCard
          eyebrow="Today"
          headline={
            metrics.activeVans === 0
              ? "No vans are out today"
              : `${formatQuantity(metrics.activeVans)} ${metrics.activeVans === 1 ? "van is" : "vans are"} out on the road`
          }
          detail={
            metrics.todaysSaleCount === 0
              ? `${formatQuantity(metrics.activeDrivers)} driver${metrics.activeDrivers === 1 ? "" : "s"} assigned · nothing sold yet`
              : `${formatQuantity(metrics.todaysSaleCount)} sale${metrics.todaysSaleCount === 1 ? "" : "s"} so far · ${formatQuantity(metrics.activeDrivers)} driver${metrics.activeDrivers === 1 ? "" : "s"} assigned`
          }
          href="/vans"
          hrefLabel="See the vans"
          footer={
            metrics.activeVans > 0 && (
              <HeroProgress
                label={`${Math.max(0, metrics.activeVans - metrics.pendingReconciliations)} of ${metrics.activeVans} vans reckoned up`}
                segments={Array.from({ length: metrics.activeVans }, (_, i) => ({
                  // A van whose end-of-day is in has finished. Clamped,
                  // because reconciliations waiting from earlier days
                  // would otherwise outnumber the vans out today and
                  // paint a strip that is all problem.
                  tone: i < Math.max(0, metrics.activeVans - metrics.pendingReconciliations)
                    ? "done" as const
                    : "waiting" as const,
                }))}
              />
            )
          }
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile
            label="Taken today"
            value={formatMoney(metrics.todaysCashSales + metrics.todaysCreditSales)}
            sub={`${formatMoney(metrics.todaysCashSales)} cash · ${formatMoney(metrics.todaysCreditSales)} on credit`}
            // Painted only once there is something to be pleased about.
            // A bright card celebrating nought is a screen congratulating
            // somebody for a morning that has not started.
            emphasis={metrics.todaysCashSales + metrics.todaysCreditSales > 0 ? "money" : "plain"}
            href="/sales"
          />
          <StatTile
            label={metrics.pendingReconciliations > 0 ? "Needs a decision" : "Nothing waiting"}
            value={
              metrics.pendingReconciliations > 0
                ? `${formatQuantity(metrics.pendingReconciliations)} to review`
                : "All clear"
            }
            sub={
              metrics.openVariances > 0
                ? `${formatQuantity(metrics.openVariances)} with a variance to explain`
                : "Every end-of-day has been reviewed"
            }
            emphasis={metrics.pendingReconciliations > 0 ? "attention" : "plain"}
            href="/reconciliation"
          />
          {/* Money and a problem at once, which is why it sits with these
              two and not among the stock figures - but left plain, with
              the amber on the number alone. Three painted cards in one
              row would be three things shouting. */}
          <StatTile
            label="Outstanding receivables"
            value={formatMoney(metrics.outstandingReceivables)}
            sub={`${metrics.overdueCustomers} customer${metrics.overdueCustomers === 1 ? "" : "s"} past due`}
            tone={metrics.overdueCustomers > 0 ? "caution" : "neutral"}
            href="/credit"
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

      {admin?.ok && (
        <div className="mt-5">
          <AdminPanel view={admin.data} />
        </div>
      )}
  </>
  );
}

/** Turns a throwing read into a value, so one dead panel is not a dead page. */
async function guard<T>(load: () => Promise<T>): Promise<
  { ok: true; data: T } | { ok: false; message: string }
> {
  try {
    return { ok: true, data: await load() };
  } catch (error) {
    console.error("[dashboard]", error);
    return { ok: false, message: toAppError(error).userMessage };
  }
}

interface DashboardData {
  metrics: Awaited<ReturnType<typeof getDashboardMetrics>>;
  variances: Awaited<ReturnType<typeof getOpenVariances>>;
  lowStock: Awaited<ReturnType<typeof getLowStock>>;
  /** Null for a role that does not see inventory. */
  expiry: {
    expiredBatches: number; expiredUnits: number;
    expiringBatches: number; expiringUnits: number; goodBatches: number;
  } | null;
}

type LoadResult =
  | { ok: true; data: DashboardData }
  | { ok: false; message: string };

type DriverResult =
  | { ok: true; data: Awaited<ReturnType<typeof getDriverSummary>> }
  | { ok: false; message: string };

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
    const [metrics, variances, lowStock, expiry] = await Promise.all([
      getDashboardMetrics(),
      can(role, "reconciliation.view") ? getOpenVariances() : Promise.resolve([]),
      can(role, "inventory.view") ? getLowStock() : Promise.resolve([]),
      can(role, "inventory.view") ? getExpirySummary() : Promise.resolve(null),
    ]);
    return {
      ok: true,
      data: {
        metrics, variances, lowStock,
        expiry: expiry?.ok ? expiry.data : null,
      },
    };
  } catch (error) {
    // Full detail to the server log, safe message to the operator.
    console.error("[dashboard] failed to load", error);
    return { ok: false, message: toAppError(error).userMessage };
  }
}
