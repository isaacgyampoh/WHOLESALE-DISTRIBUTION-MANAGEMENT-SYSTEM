import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getDriverRound } from "@/features/driver/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, ErrorState, EmptyState } from "@/components/ui/states";
import { formatMoney, formatQuantity } from "@/lib/utils/format";
import { Receipt, Banknote, Undo2, Scale, TruckIcon, ListChecks } from "lucide-react";

export const metadata: Metadata = { title: "My round" };

/**
 * The driver's home.
 *
 * Not a smaller version of the administrator's dashboard: four things
 * they might do next, and the three numbers that tell them how the day
 * is going. Everything is thumb-sized because it is used standing at
 * the back of a van.
 */
export default async function DriverPage() {
  const user = await requireUser();
  const result = await getDriverRound(user.id);

  if (!result.ok) {
    return (
      <>
        <PageHeader title="My round" />
        <Card><ErrorState title="Your round could not be loaded" message={result.message} /></Card>
      </>
    );
  }

  const round = result.data;

  return (
    <>
      <PageHeader
        title={`Good day, ${user.fullName.split(" ")[0]}`}
        description={round.van ? `${round.van.code} · ${round.van.registrationNo}` : undefined}
      />

      {!round.van ? (
        <Card>
          <EmptyState
            icon={TruckIcon}
            title="No van assigned"
            description="Ask a supervisor to assign you a van before starting a round."
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {!round.load && (
            <Alert tone="info" title="Nothing loaded">
              Your van has no open load. A supervisor loads it before you set off.
            </Alert>
          )}

          {round.load && (
            <Card>
              <CardBody className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="numeric text-sm font-medium text-[var(--text-primary)]">
                      {round.load.loadNumber}
                    </p>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {round.load.lineCount} {round.load.lineCount === 1 ? "line" : "lines"} ·{" "}
                      {formatMoney(round.load.loadedValue)} loaded
                    </p>
                  </div>
                  <Badge tone={round.load.status === "dispatched" ? "brand" : "info"}>
                    {round.load.status === "dispatched" ? "On the road" : round.load.status}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Figure label="On the van" value={formatQuantity(round.stockUnits)} sub="units left" />
                  <Figure label="Worth" value={formatMoney(round.stockValue)} sub="at cost" />
                </div>
              </CardBody>
            </Card>
          )}

          <div className="grid grid-cols-3 gap-3">
            <Figure label="Cash today" value={formatMoney(round.cashSales)} tone="positive" />
            <Figure label="On credit" value={formatMoney(round.creditSales)} tone="caution" />
            <Figure label="Collected" value={formatMoney(round.collections)} tone="positive" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Action href="/driver/sell" icon={Receipt} label="Sell" hint="From the van" primary />
            <Action href="/driver/collect" icon={Banknote} label="Collect" hint="Take a payment" primary />
            <Action href="/driver/return" icon={Undo2} label="Return" hint="Count what is left" />
            <Action href="/driver/reconcile" icon={Scale} label="End of day" hint="Hand in the cash" />
          </div>

          <Link
            href="/driver/queue"
            className="flex min-h-14 items-center justify-between gap-3 rounded-[var(--radius-panel)] border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-4 transition-colors hover:border-[var(--border-strong)]"
          >
            <span className="flex items-center gap-2.5">
              <ListChecks className="size-5 text-[var(--text-secondary)]" aria-hidden />
              <span className="text-sm font-medium text-[var(--text-primary)]">
                Everything I have recorded
              </span>
            </span>
            <span className="text-xs text-[var(--text-muted)]">View</span>
          </Link>

          {round.reconciliation && round.reconciliation.status !== "draft" && (
            <Alert
              tone={round.reconciliation.status === "approved" || round.reconciliation.status === "settled"
                ? "success"
                : round.reconciliation.status === "rejected" ? "danger" : "info"}
              title={`End of day ${round.reconciliation.status}`}
            >
              {round.reconciliation.reconNumber}
              {round.reconciliation.status === "rejected"
                ? " was sent back to you. Check with your supervisor."
                : round.reconciliation.status === "submitted"
                  ? " is with a supervisor."
                  : " is settled."}
            </Alert>
          )}
        </div>
      )}
    </>
  );
}

function Figure({
  label, value, sub, tone,
}: {
  label: string; value: string; sub?: string; tone?: "positive" | "caution";
}) {
  const accent =
    tone === "positive" ? "text-positive" : tone === "caution" ? "text-caution" : "text-[var(--text-primary)]";
  return (
    <div className="surface rounded-[var(--radius-panel)] border border-[var(--border-subtle)] p-3">
      <p className="text-[0.6875rem] font-medium tracking-wide text-[var(--text-muted)] uppercase">
        {label}
      </p>
      <p className={`numeric mt-1 text-lg font-semibold tracking-tight ${accent}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[0.6875rem] text-[var(--text-secondary)]">{sub}</p>}
    </div>
  );
}

function Action({
  href, icon: Icon, label, hint, primary,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        "flex min-h-28 flex-col justify-between rounded-[var(--radius-panel)] border p-4 transition-colors " +
        (primary
          ? "border-brand-700 bg-brand-700 text-white hover:bg-brand-800"
          : "border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--text-primary)] hover:bg-[var(--surface-sunken)]")
      }
    >
      <Icon className="size-7" aria-hidden />
      <span>
        <span className="block text-base font-semibold">{label}</span>
        <span className={"block text-xs " + (primary ? "text-white/80" : "text-[var(--text-secondary)]")}>
          {hint}
        </span>
      </span>
    </Link>
  );
}
