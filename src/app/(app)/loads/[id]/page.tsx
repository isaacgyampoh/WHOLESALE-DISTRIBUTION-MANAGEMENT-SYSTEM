import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { getLoadDetail } from "@/features/distribution/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ErrorState, EmptyState } from "@/components/ui/states";
import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { formatQuantity, formatDate } from "@/lib/utils/format";
import { formatHolding } from "@/lib/catalogue/quantity";
import { PackageX, Users } from "lucide-react";

export const metadata: Metadata = { title: "Van load" };
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, "positive" | "caution" | "neutral"> = {
  dispatched: "caution",
  loaded: "neutral",
  reconciled: "positive",
  returned: "neutral",
  cancelled: "neutral",
};

/**
 * What is actually inside a van.
 *
 * The loads list said a load existed and never what was on it, which is
 * the one thing anybody opens a load to find out. Three columns, because
 * they answer different questions: loaded is what the warehouse signed
 * out, sold is what this round has taken, remaining is what is on the
 * shelf now.
 */
export default async function LoadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, "loads.view")) return <Forbidden />;

  const { id } = await params;
  const result = await getLoadDetail(id);

  if (!result.ok) {
    return <Card><ErrorState title="Load could not be loaded" message={result.message} /></Card>;
  }
  if (!result.data) notFound();

  const load = result.data;
  const totalLoaded = load.lines.reduce((s, l) => s + l.loaded, 0);
  const totalSold = load.lines.reduce((s, l) => s + l.sold, 0);
  const totalLeft = load.lines.reduce((s, l) => s + l.remaining, 0);
  // Counted separately for the summary line. This spans every product on
  // the load, so no single unit word fits and the two are named apart.
  const loosePieces = load.lines.reduce(
    (s, l) => s + l.loadedPieces + l.soldPieces + l.remainingPieces, 0);

  return (
    <>
      <PageHeader
        title={load.loadNumber}
        description={`${load.vanCode}${load.registrationNo ? ` · ${load.registrationNo}` : ""}`}
        breadcrumbs={[
          { label: "Distribution" },
          { label: "Van loads", href: "/loads" },
          { label: load.loadNumber },
        ]}
        actions={
          <Link
            href={`/vans/${load.vanId}/crew`}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius-panel)] border border-[var(--border-strong)] px-4 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-sunken)] pointer-fine:h-9.5"
          >
            <Users className="size-4" aria-hidden />
            {load.salespeople.length ? "Change crew" : "Assign salesperson"}
          </Link>
        }
      />

      <Card className="mt-6">
        <dl className="grid gap-4 px-5 py-4 sm:grid-cols-3 lg:grid-cols-5">
          <Pair label="Warehouse" value={load.warehouseName ?? "-"} />
          <Pair label="Date" value={formatDate(load.loadDate)} />
          <Pair label="Driver" value={load.driverName ?? "No driver"} />
          {/*
            Unassigned is a real answer, not a gap to hide. A van with a
            load and nobody selling from it cannot trade, and that has to
            be visible here rather than discovered by a salesperson
            standing in a yard.
          */}
          <Pair
            label="Salesperson"
            value={load.salespeople.length ? load.salespeople.join(", ") : "Unassigned"}
            muted={load.salespeople.length === 0}
          />
          <div>
            <dt className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Status</dt>
            <dd className="mt-1">
              <Badge tone={STATUS_TONE[load.status] ?? "neutral"}>{load.status}</Badge>
            </dd>
          </div>
        </dl>
      </Card>

      <Card className="mt-6 p-0">
        <CardHeader
          title="What is on the van"
          description={
            load.lines.length
              ? `${formatQuantity(totalLoaded)} loaded · ${formatQuantity(totalSold)} sold · ${formatQuantity(totalLeft)} left` +
                (loosePieces > 0 ? " · loose pieces counted separately below" : "")
              : undefined
          }
        />
        {load.lines.length === 0 ? (
          <EmptyState
            icon={PackageX}
            title="Nothing was loaded"
            description="This load has no lines on it, so the van is carrying nothing from it."
          />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Product</Th>
                  <Th>Unit</Th>
                  <Th numeric>Loaded</Th>
                  <Th numeric>Sold</Th>
                  <Th numeric>Remaining</Th>
                </tr>
              </thead>
              <tbody>
                {load.lines.map((line) => (
                  <Tr key={line.productId}>
                    <Td>
                      <span className="font-medium text-[var(--text-primary)]">
                        {line.productName}
                      </span>
                      <span className="numeric block text-xs text-[var(--text-muted)]">
                        {line.sku}
                      </span>
                    </Td>
                    <Td className="text-[var(--text-secondary)]">{line.unit}</Td>
                    <Td numeric>
                      {formatHolding(
                        { units: line.loaded, pieces: line.loadedPieces },
                        line.unit, { empty: "0" },
                      )}
                    </Td>
                    <Td numeric>
                      {formatHolding(
                        { units: line.sold, pieces: line.soldPieces },
                        line.unit, { empty: "0" },
                      )}
                    </Td>
                    <Td numeric>
                      <span className={
                        line.remaining === 0 && line.remainingPieces === 0
                          ? "text-[var(--text-muted)]" : ""
                      }>
                        {formatHolding(
                          { units: line.remaining, pieces: line.remainingPieces },
                          line.unit, { empty: "0" },
                        )}
                      </span>
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

function Pair({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-[var(--text-muted)]">{label}</dt>
      <dd className={`mt-1 text-sm ${muted ? "text-[var(--text-muted)]" : "text-[var(--text-primary)]"}`}>
        {value}
      </dd>
    </div>
  );
}
