import Link from "next/link";
import type { AccountantView } from "./role-queries";
import { StatTile, StatGrid } from "@/components/ui/stat-tile";
import { Card, CardHeader } from "@/components/ui/card";
import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { formatMoney, formatQuantity } from "@/lib/utils/format";
import { CheckCircle2 } from "lucide-react";

const BUCKET_LABELS: Record<string, string> = {
  current: "Not yet due",
  "1-30": "1 to 30 days",
  "31-60": "31 to 60 days",
  "61-90": "61 to 90 days",
  "90+": "Over 90 days",
  "91+": "Over 90 days",
};

const BUCKET_TONE: Record<string, "positive" | "caution" | "critical"> = {
  current: "positive",
  "1-30": "caution",
  "31-60": "caution",
  "61-90": "critical",
  "90+": "critical",
  "91+": "critical",
};

/**
 * The accountant's morning.
 *
 * Ageing comes before totals because a single outstanding figure hides
 * the only thing that matters about a debt, which is how old it is.
 * ₵40,000 owed inside terms is a healthy book; the same figure at ninety
 * days is a write-off waiting to be admitted.
 */
export function AccountantDashboard({ view }: { view: AccountantView }) {
  const worst = view.ageing.filter((a) => a.bucket !== "current");
  const total = view.ageing.reduce((s, a) => s + a.amount, 0);

  return (
    <>
      <StatGrid>
        <StatTile label="Outstanding" value={formatMoney(view.outstanding)}
                  sub="Across every open invoice"
                  tone={view.outstanding > 0 ? "caution" : "positive"}
                  href="/invoices?status=open" />
        <StatTile label="Past due" value={formatMoney(view.overdue)}
                  sub={`${formatQuantity(view.overdueCount)} invoice${view.overdueCount === 1 ? "" : "s"} beyond terms`}
                  tone={view.overdue > 0 ? "critical" : "positive"}
                  href="/invoices?status=overdue" />
        <StatTile label="Collected this week" value={formatMoney(view.collectedThisWeek)}
                  sub={`${formatMoney(view.collectedToday)} of it today`}
                  tone="positive" href="/payments" />
        <StatTile label="Invoiced this month" value={formatMoney(view.invoicedThisMonth)}
                  sub="Value raised on credit" href="/invoices" />
      </StatGrid>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="How old the money is"
            description="Every open invoice, by how far past its due date it has gone."
            action={
              <Link href="/credit" className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">
                Full ageing
              </Link>
            }
          />
          {view.ageing.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="Nothing outstanding"
                        description="Every invoice raised has been settled." />
          ) : (
            <div className="space-y-3 p-5">
              {view.ageing.map((band) => {
                // Proportional bars: the shape of the book is the point,
                // and five numbers in a column do not have a shape.
                const share = total > 0 ? (band.amount / total) * 100 : 0;
                return (
                  <div key={band.bucket}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm text-[var(--text-secondary)]">
                        {BUCKET_LABELS[band.bucket] ?? band.bucket}
                      </span>
                      <span className="numeric text-sm font-medium text-[var(--text-primary)]">
                        {formatMoney(band.amount)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
                        <div
                          className={
                            BUCKET_TONE[band.bucket] === "critical"
                              ? "h-full rounded-full bg-critical"
                              : BUCKET_TONE[band.bucket] === "caution"
                                ? "h-full rounded-full bg-caution"
                                : "h-full rounded-full bg-positive"
                          }
                          style={{ width: `${Math.max(share, share > 0 ? 2 : 0)}%` }}
                        />
                      </div>
                      <span className="numeric w-20 shrink-0 text-right text-xs text-[var(--text-muted)]">
                        {formatQuantity(band.count)} inv
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Who owes the most"
            description="Where a morning of chasing is best spent."
            action={
              <Link href="/customers?credit=owing" className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">
                All customers
              </Link>
            }
          />
          {view.topDebtors.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="Nobody owes anything"
                        description="Every customer account is clear." />
          ) : (
            <TableWrap className="rounded-t-none border-0">
              <Table>
                <thead>
                  <tr>
                    <Th>Customer</Th>
                    <Th numeric>Owed</Th>
                    <Th>Age</Th>
                  </tr>
                </thead>
                <tbody>
                  {view.topDebtors.map((d) => (
                    <Tr key={d.id}>
                      <Td>
                        <Link href={`/customers/${d.id}`} className="font-medium hover:underline">
                          {d.name}
                        </Link>
                      </Td>
                      <Td numeric className="font-medium">{formatMoney(d.balance)}</Td>
                      <Td>
                        {d.daysPastDue > 0 ? (
                          <Badge tone={d.daysPastDue > 60 ? "critical" : "caution"}>
                            {d.daysPastDue} days
                          </Badge>
                        ) : (
                          <Badge tone="positive">Within terms</Badge>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>
      </div>

      <StatGrid>
        <StatTile label="Cash collected" value={formatMoney(view.cashThisWeek)}
                  sub="This week, in notes" />
        <StatTile label="Mobile money collected" value={formatMoney(view.momoThisWeek)}
                  sub="This week, to the float" />
        <StatTile label="End of day to review"
                  value={formatQuantity(view.reconciliationsWaiting)}
                  sub="A driver cannot clear their own variance"
                  tone={view.reconciliationsWaiting > 0 ? "caution" : "neutral"}
                  href="/reconciliation" />
        <StatTile label="Overdue invoices" value={formatQuantity(view.overdueCount)}
                  sub={worst.length > 0 ? `Oldest band: ${BUCKET_LABELS[worst[worst.length - 1].bucket] ?? ""}` : "Nothing past due"}
                  tone={view.overdueCount > 0 ? "critical" : "positive"}
                  href="/invoices?status=overdue" />
      </StatGrid>
    </>
  );
}
