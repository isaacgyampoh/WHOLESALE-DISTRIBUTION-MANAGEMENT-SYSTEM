import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { getVanReturn } from "@/features/distribution/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatTile } from "@/components/ui/stat-tile";
import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { ErrorState, EmptyState } from "@/components/ui/states";
import { formatDateTime, formatMoney, formatQuantity } from "@/lib/utils/format";
import { formatHolding } from "@/lib/catalogue/quantity";
import { PackageCheck } from "lucide-react";

export const metadata: Metadata = { title: "Van return" };

const TONE: Record<string, "positive" | "caution" | "critical" | "neutral" | "info"> = {
  draft: "caution", submitted: "info", approved: "positive", rejected: "critical",
};

/**
 * What came back off a van, and what did not.
 *
 * The returns list could only say "161 missing", which is a number
 * nobody can act on: not which products, so the warehouse cannot go and
 * look for them, and not what it is worth, so nobody can tell a bad
 * afternoon from a serious loss. This is the screen that answers both,
 * from figures that were already in the table.
 *
 * Ordered by value, not by count. Twelve of something cheap and two of
 * something dear are not the same problem, and the list that starts
 * with the biggest number starts with the wrong line.
 */
export default async function VanReturnPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, "returns.view")) return <Forbidden />;

  const { id } = await params;
  const result = await getVanReturn(id);

  if (!result.ok) {
    return <Card><ErrorState title="Return could not be loaded" message={result.message} /></Card>;
  }
  if (!result.data) notFound();

  const ret = result.data;
  const { totals } = ret;
  const shortfall = ret.lines.filter((l) => l.missing > 0 || l.missingPieces > 0);
  const accountedFor = totals.missing === 0 && totals.missingPieces === 0;

  return (
    <>
      <PageHeader
        title={ret.returnNumber}
        description={`${ret.vanCode} · ${ret.driverName} · back to ${ret.warehouseName}`}
        breadcrumbs={[
          { label: "Distribution" },
          { label: "Returns", href: "/returns" },
          { label: ret.returnNumber },
        ]}
        actions={<Badge tone={TONE[ret.status] ?? "neutral"}>{ret.status}</Badge>}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile label="Went out" value={formatQuantity(totals.expected)} sub="On the load" />
        <StatTile label="Came back" value={formatQuantity(totals.good)} sub="Good, back on the shelf" />
        <StatTile label="Damaged" value={formatQuantity(totals.damaged)}
                  sub="Back, but not sellable"
                  tone={totals.damaged > 0 ? "caution" : "neutral"} />
        <StatTile
          label="Unaccounted for"
          value={formatQuantity(totals.missing)}
          sub={totals.missingPieces > 0
            ? `and ${formatQuantity(totals.missingPieces)} loose pieces`
            : "Neither sold nor returned"}
          // Painted only when there is something to chase. A bright card
          // around a nought is a screen raising an alarm about nothing.
          emphasis={totals.missing > 0 || totals.missingPieces > 0 ? "attention" : "plain"}
        />
      </div>

      {/*
        The money, where the caller is entitled to it.

        Cost comes through the masking view, so a driver sees the counts
        and nothing else - the same rule as every other screen, not
        relaxed because this figure happens to be a loss.
      */}
      {!accountedFor && totals.missingValue !== null && (
        <div className="mb-5">
          <Card className="rounded-[var(--radius-card)] border-critical/30 bg-critical-soft dark:bg-critical/10">
            <div className="p-5">
              <p className="text-xs font-medium tracking-wide text-[var(--text-secondary)] uppercase">
                What the shortfall is worth
              </p>
              <p className="numeric mt-1 text-3xl font-semibold text-critical">
                {formatMoney(totals.missingValue)}
              </p>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                At cost, across {formatQuantity(shortfall.length)}{" "}
                {shortfall.length === 1 ? "product" : "products"}
                {totals.missingPieces > 0 && (
                  <>
                    {" "}· the {formatQuantity(totals.missingPieces)} loose pieces are not
                    priced here, because a piece is worth a share of what the case cost and
                    that needs a pack size
                  </>
                )}
                .
              </p>
            </div>
          </Card>
        </div>
      )}

      <Card className="mb-5">
        <CardHeader
          title={accountedFor ? "Every line accounted for" : "What is missing"}
          description={accountedFor
            ? "Everything that went out came back, was sold, or was recorded as damaged."
            : "Ordered by what it is worth. This is the list to go and look for."}
        />
        {accountedFor ? (
          <EmptyState
            icon={PackageCheck}
            title="Nothing unaccounted for"
            description="The van came back square."
          />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Product</Th>
                  <Th numeric>Went out</Th>
                  <Th numeric>Came back</Th>
                  <Th numeric>Damaged</Th>
                  <Th numeric>Missing</Th>
                  <Th numeric>At cost</Th>
                </tr>
              </thead>
              <tbody>
                {shortfall.map((l) => (
                  <Tr key={l.productId}>
                    <Td>
                      <span className="font-medium text-[var(--text-primary)]">{l.name}</span>
                      <span className="numeric block text-xs text-[var(--text-muted)]">{l.sku}</span>
                    </Td>
                    <Td numeric>
                      {formatHolding({ units: l.expected, pieces: l.expectedPieces },
                                     l.unit, { empty: "-" })}
                    </Td>
                    <Td numeric>
                      {formatHolding({ units: l.returnedGood, pieces: l.returnedGoodPieces },
                                     l.unit, { empty: "-" })}
                    </Td>
                    <Td numeric>
                      {formatHolding({ units: l.damaged, pieces: l.damagedPieces },
                                     l.unit, { empty: "-" })}
                    </Td>
                    <Td numeric className="font-medium text-critical">
                      {formatHolding({ units: l.missing, pieces: l.missingPieces },
                                     l.unit, { empty: "-" })}
                    </Td>
                    <Td numeric>
                      {l.missingValue === null
                        ? <span className="text-[var(--text-muted)]">—</span>
                        : formatMoney(l.missingValue)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>

      <Card>
        <CardHeader title="This return" />
        <dl className="grid gap-x-6 gap-y-3 p-5 sm:grid-cols-2">
          {[
            ["Load", ret.loadNumber],
            ["Van", ret.vanCode],
            ["Driver", ret.driverName],
            ["Back to", ret.warehouseName],
            ["Returned", formatDateTime(ret.returnedAt)],
            ["Approved", ret.approvedAt ? formatDateTime(ret.approvedAt) : "Not yet"],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-[var(--text-muted)]">{label}</dt>
              <dd className="text-sm text-[var(--text-primary)]">{value}</dd>
            </div>
          ))}
          {ret.notes && (
            <div className="sm:col-span-2">
              <dt className="text-xs text-[var(--text-muted)]">Note</dt>
              <dd className="text-sm text-[var(--text-primary)]">{ret.notes}</dd>
            </div>
          )}
        </dl>
      </Card>
    </>
  );
}
