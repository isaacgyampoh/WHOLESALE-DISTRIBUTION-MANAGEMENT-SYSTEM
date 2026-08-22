import Link from "next/link";
import type { AdminView } from "./role-queries";
import { Card, CardHeader } from "@/components/ui/card";
import { StatTile, StatGrid } from "@/components/ui/stat-tile";
import { Alert } from "@/components/ui/states";
import { formatMoney, formatQuantity } from "@/lib/utils/format";

/**
 * Whether the system itself is healthy.
 *
 * This is not trading information and it is not shown to anybody who
 * cannot act on it. Three things belong here: who can get in, whether
 * anybody is trying to get in who should not, and whether the database
 * is running the schema this build expects - which is the one failure
 * that makes features quietly absent rather than broken, and so the one
 * nobody reports.
 */
export function AdminPanel({ view }: { view: AdminView }) {
  const waiting =
    view.pendingApprovals.reconciliations + view.pendingApprovals.returns
    + view.pendingApprovals.transfers + view.pendingApprovals.supplierInvoices;

  return (
    <>
      {/* Margin first: it is the one figure on this page that says
          whether the trading is worth doing, and it is only computable
          for the roles allowed to see cost. */}
      <div className="mb-5">
        <StatGrid>
          <StatTile label="Revenue" value={formatMoney(view.revenue)}
                    sub="Last 30 days, excluding voided sales" />
          <StatTile label="Gross margin" value={formatMoney(view.grossMargin)}
                    sub={`${view.marginPercent.toFixed(1)}% of revenue`}
                    tone={view.grossMargin > 0 ? "positive" : "critical"} />
          <StatTile label="Waiting on somebody" value={formatQuantity(waiting)}
                    sub="Approvals across the whole system"
                    tone={waiting > 0 ? "caution" : "positive"} />
          <StatTile label="Supplier invoices to check"
                    value={formatQuantity(view.pendingApprovals.supplierInvoices)}
                    sub="Sent in and not yet reviewed"
                    tone={view.pendingApprovals.supplierInvoices > 0 ? "caution" : "positive"}
                    href="/suppliers/review" />
        </StatGrid>
      </div>

      {waiting > 0 && (
        <div className="mb-5">
          <Card>
            <CardHeader
              title="Waiting on a decision"
              description="Nothing here moves until somebody with the authority looks at it."
            />
            <div className="p-5">
              <StatGrid>
                <StatTile label="End of day"
                          value={formatQuantity(view.pendingApprovals.reconciliations)}
                          sub="A driver cannot clear their own variance"
                          tone={view.pendingApprovals.reconciliations > 0 ? "caution" : "neutral"}
                          href="/reconciliation" />
                <StatTile label="Returns"
                          value={formatQuantity(view.pendingApprovals.returns)}
                          sub="Stock does not come back until approved"
                          tone={view.pendingApprovals.returns > 0 ? "caution" : "neutral"}
                          href="/returns" />
                <StatTile label="Transfers"
                          value={formatQuantity(view.pendingApprovals.transfers)}
                          sub="A depot cannot approve its own"
                          tone={view.pendingApprovals.transfers > 0 ? "caution" : "neutral"}
                          href="/transfers?status=draft" />
                <StatTile label="Supplier invoices"
                          value={formatQuantity(view.pendingApprovals.supplierInvoices)}
                          sub="Approving one is agreeing to pay it"
                          tone={view.pendingApprovals.supplierInvoices > 0 ? "caution" : "neutral"}
                          href="/suppliers/review" />
              </StatGrid>
            </div>
          </Card>
        </div>
      )}

      {view.pendingUpgrades.length > 0 && (
        <div className="mb-5">
          <Alert tone="warning" title="The database is behind this build">
            {view.pendingUpgrades.join(", ")}{" "}
            {view.pendingUpgrades.length === 1 ? "has" : "have"} not been applied. The features
            they carry are hidden rather than broken - run the matching{" "}
            <code className="rounded bg-[var(--surface-sunken)] px-1 py-0.5 text-xs">
              database/UPGRADE_*.sql
            </code>{" "}
            scripts in Supabase, then reload.
          </Alert>
        </div>
      )}

      {view.cannotSignIn > 0 && (
        <div className="mb-5">
          <Alert tone="warning" title="Staff who cannot sign in">
            {formatQuantity(view.cannotSignIn)}{" "}
            {view.cannotSignIn === 1 ? "person is active but has" : "people are active but have"}{" "}
            no PIN set, so they cannot get in at all. Nobody finds out until they try.{" "}
            <Link href="/users" className="underline">Set their PIN</Link>
          </Alert>
        </div>
      )}

      <Card>
        <CardHeader
          title="The system itself"
          description="Access, activity and whether the schema matches this build."
          action={
            <Link href="/audit" className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">
              Audit trail
            </Link>
          }
        />
        <div className="p-5">
          <StatGrid>
            <StatTile label="Active staff" value={formatQuantity(view.activeUsers)}
                      sub={`${formatQuantity(view.inactiveUsers)} deactivated`}
                      href="/users" />
            <StatTile label="Cannot sign in" value={formatQuantity(view.cannotSignIn)}
                      sub="Active, but no PIN set"
                      tone={view.cannotSignIn > 0 ? "caution" : "positive"}
                      href="/users" />
            <StatTile label="Recorded today" value={formatQuantity(view.auditEntriesToday)}
                      sub="Entries in the audit trail" href="/audit" />
            <StatTile label="Failed sign-ins today"
                      value={formatQuantity(view.failedSignInsToday)}
                      sub="Wrong PIN, across every account"
                      tone={view.failedSignInsToday > 10 ? "critical"
                            : view.failedSignInsToday > 0 ? "caution" : "positive"} />
          </StatGrid>
        </div>
      </Card>
    </>
  );
}
