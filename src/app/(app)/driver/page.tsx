import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getDriverRound } from "@/features/driver/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, ErrorState, EmptyState } from "@/components/ui/states";
import { formatMoney, formatQuantity, formatDate } from "@/lib/utils/format";
import {
  Receipt, Banknote, Undo2, Scale, Boxes, ListChecks, TruckIcon, ChevronRight,
} from "lucide-react";

export const metadata: Metadata = { title: "My round" };

/**
 * The driver's home.
 *
 * Built around what they do next, not around the tables underneath.
 * A driver standing at the back of a van needs three things in this
 * order: which van and load am I on, how is the day going, and what am
 * I doing now. Everything else is a tap away under More.
 *
 * No cost figure appears anywhere on this screen. The database will not
 * give a driver one - `product_cost()` returns null to their role - and
 * the screen does not ask for one.
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
  const onTheRoad = round.load?.status === "dispatched";
  const dayClosed = round.reconciliation && round.reconciliation.status !== "draft";

  return (
    <>
      <PageHeader
        title={`Good day, ${user.fullName.split(" ")[0]}`}
        description="Your van, your round, and what to do next."
      />

      {!round.van ? (
        <Card>
          <EmptyState
            icon={TruckIcon}
            title="No van assigned to you"
            description="A supervisor assigns you a van before you can start a round. Ask at the depot."
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {/* ---- my van --------------------------------------------- */}
          <Card>
            <CardBody className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[0.6875rem] font-medium tracking-wide text-[var(--text-muted)] uppercase">
                    My van
                  </p>
                  <p className="mt-0.5 truncate text-lg font-semibold text-[var(--text-primary)]">
                    {round.van.code}
                  </p>
                  <p className="numeric truncate text-xs text-[var(--text-secondary)]">
                    {round.van.registrationNo}
                  </p>
                </div>
                <Badge tone={onTheRoad ? "brand" : round.load ? "info" : "neutral"}>
                  {onTheRoad ? "On the road" : round.load ? "Loading" : "No load"}
                </Badge>
              </div>

              {round.load ? (
                <div className="rounded-[var(--radius-panel)] bg-[var(--surface-sunken)] px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="numeric text-sm font-medium text-[var(--text-primary)]">
                      {round.load.loadNumber}
                    </span>
                    <span className="text-xs text-[var(--text-secondary)]">
                      {formatDate(round.load.loadDate)}
                    </span>
                  </div>
                  <p className="numeric mt-1 text-xs text-[var(--text-secondary)]">
                    {formatQuantity(round.stockUnits)} units still on board ·{" "}
                    {round.load.lineCount} {round.load.lineCount === 1 ? "product" : "products"} loaded
                  </p>
                </div>
              ) : (
                <Alert tone="info" title="Nothing loaded yet">
                  Your van has no open load. A supervisor loads it before you set off.
                </Alert>
              )}
            </CardBody>
          </Card>

          {/* ---- today ---------------------------------------------- */}
          <section>
            <h2 className="mb-2 text-[0.6875rem] font-medium tracking-wide text-[var(--text-muted)] uppercase">
              Today
            </h2>
            <div className="grid grid-cols-3 gap-3">
              <Figure label="Cash" value={formatMoney(round.cashSales)} tone="positive" />
              <Figure label="Credit" value={formatMoney(round.creditSales)} tone="caution" />
              <Figure label="Collected" value={formatMoney(round.collections)} tone="positive" />
            </div>
            <p className="numeric mt-2 text-xs text-[var(--text-muted)]">
              {formatQuantity(round.saleCount)} {round.saleCount === 1 ? "sale" : "sales"} so far
            </p>
          </section>

          {/* ---- what to do now ------------------------------------- */}
          <section>
            <h2 className="mb-2 text-[0.6875rem] font-medium tracking-wide text-[var(--text-muted)] uppercase">
              What would you like to do?
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <Action
                href="/driver/sell" icon={Receipt} label="Sell"
                hint="To a customer" primary disabled={!onTheRoad}
              />
              <Action
                href="/driver/collect" icon={Banknote} label="Collect payment"
                hint="Money owed" primary
              />
              <Action href="/driver/stock" icon={Boxes} label="My van stock" hint="What is left" />
              <Action href="/driver/return" icon={Undo2} label="Return goods" hint="Back to depot" />
            </div>

            <div className="mt-3">
              <Action
                href="/driver/reconcile" icon={Scale} label="End my day"
                hint={dayClosed ? "Already submitted" : "Hand in cash and close the round"}
                wide
              />
            </div>
          </section>

          {!onTheRoad && round.load && (
            <Alert tone="info" title="Not dispatched yet">
              Selling opens once the depot dispatches {round.load.loadNumber} to your van.
            </Alert>
          )}

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
            <ChevronRight className="size-4 text-[var(--text-muted)]" aria-hidden />
          </Link>

          {dayClosed && round.reconciliation && (
            <Alert
              tone={
                round.reconciliation.status === "rejected" ? "danger"
                : round.reconciliation.status === "submitted" ? "info"
                : "success"
              }
              title={
                round.reconciliation.status === "submitted"
                  ? "Your day is with a supervisor"
                  : round.reconciliation.status === "rejected"
                    ? "Your day was sent back"
                    : "Your day is settled"
              }
            >
              {round.reconciliation.reconNumber}
              {round.reconciliation.status === "rejected"
                ? " came back to you. Speak to your supervisor before resubmitting."
                : round.reconciliation.status === "submitted"
                  ? ". You cannot approve your own round."
                  : "."}
            </Alert>
          )}
        </div>
      )}
    </>
  );
}

function Figure({
  label, value, tone,
}: {
  label: string; value: string; tone?: "positive" | "caution";
}) {
  const accent =
    tone === "positive" ? "text-positive"
    : tone === "caution" ? "text-caution"
    : "text-[var(--text-primary)]";
  return (
    <div className="surface rounded-[var(--radius-panel)] border border-[var(--border-subtle)] p-3">
      <p className="text-[0.6875rem] font-medium tracking-wide text-[var(--text-muted)] uppercase">
        {label}
      </p>
      <p className={`numeric mt-1 text-base font-semibold tracking-tight sm:text-lg ${accent}`}>
        {value}
      </p>
    </div>
  );
}

/**
 * A destination sized for a thumb. Disabled rather than hidden when the
 * round is not in a state for it: a driver who cannot find "Sell"
 * assumes the app is broken, where a greyed one with a reason does not.
 */
function Action({
  href, icon: Icon, label, hint, primary, wide, disabled,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint: string;
  primary?: boolean;
  wide?: boolean;
  disabled?: boolean;
}) {
  const body = (
    <>
      <Icon className="size-7 shrink-0" aria-hidden />
      <span className="min-w-0">
        <span className="block text-base font-semibold">{label}</span>
        <span
          className={
            "block text-xs " +
            (primary && !disabled ? "text-white/80" : "text-[var(--text-secondary)]")
          }
        >
          {hint}
        </span>
      </span>
    </>
  );

  const shape = wide
    ? "flex min-h-16 flex-row items-center gap-3 rounded-[var(--radius-panel)] border p-4"
    : "flex min-h-28 flex-col justify-between rounded-[var(--radius-panel)] border p-4";

  if (disabled) {
    return (
      <div
        aria-disabled="true"
        className={`${shape} border-[var(--border-subtle)] bg-[var(--surface-sunken)] text-[var(--text-muted)]`}
      >
        {body}
      </div>
    );
  }

  return (
    <Link
      href={href}
      className={
        `${shape} transition-colors ` +
        (primary
          ? "border-brand-700 bg-brand-700 text-white hover:bg-brand-800"
          : "border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--text-primary)] hover:bg-[var(--surface-sunken)]")
      }
    >
      {body}
    </Link>
  );
}
