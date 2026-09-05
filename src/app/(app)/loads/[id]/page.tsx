import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { getLoadDetail, listLoadableProducts } from "@/features/distribution/queries";
import { TopUpVanButton } from "@/features/distribution/top-up-form";
import { SendBackButton } from "@/features/distribution/send-back-form";
import { listWarehouses } from "@/features/catalogue/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ErrorState, EmptyState } from "@/components/ui/states";
import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { formatQuantity, formatDate, formatDateTime } from "@/lib/utils/format";
import { formatHolding } from "@/lib/catalogue/quantity";
import { PackageX, Users, PackagePlus } from "lucide-react";

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

  /*
   * The round is open while the load is dispatched.
   *
   * That is the whole cutoff: approve_van_return moves the load to
   * 'returned', so a dispatched load is a week still running whether it
   * is Monday or Friday afternoon. No clock, no day of the week.
   */
  const roundIsOpen = load.status === "dispatched";
  const canTopUp = roundIsOpen && can(user.role, "loads.dispatch");

  // Only fetched when there is a button to put them behind.
  const [pickable, depots] = await Promise.all([
    canTopUp ? listLoadableProducts() : Promise.resolve(null),
    canTopUp ? listWarehouses() : Promise.resolve(null),
  ]);

  // Nothing on the van is nothing to send back, so the button is not
  // offered at all in that case.
  const anythingOnBoard = load.lines.some((l) => l.remaining > 0 || l.remainingPieces > 0);

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
          <div className="flex flex-wrap items-center gap-2">
          {canTopUp && anythingOnBoard && depots?.ok && depots.data.length > 0 && (
            <SendBackButton
              loadId={load.id}
              loadNumber={load.loadNumber}
              vanCode={load.vanCode}
              lines={load.lines}
              warehouses={depots.data.map((w) => ({ id: w.id, name: w.name }))}
              defaultWarehouseId={load.warehouseId}
            />
          )}
          {canTopUp && pickable?.ok && (
            <TopUpVanButton
              loadId={load.id}
              loadNumber={load.loadNumber}
              vanCode={load.vanCode}
              warehouseId={load.warehouseId}
              warehouseName={load.warehouseName}
              products={pickable.data}
            />
          )}
          <Link
            href={`/vans/${load.vanId}/crew`}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius-panel)] border border-[var(--border-strong)] px-4 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-sunken)] pointer-fine:h-9.5"
          >
            <Users className="size-4" aria-hidden />
            {load.salespeople.length ? "Change crew" : "Assign salesperson"}
          </Link>
          </div>
        }
      />

      <Card className="mt-6">
        <dl className="grid gap-4 px-5 py-4 sm:grid-cols-3 lg:grid-cols-5">
          <Pair label="Warehouse" value={load.warehouseName ?? "-"} />
          {/*
            Said here because it changes what Friday expects. A week with
            three top-ups holds more than its opening load, and anyone
            reading a variance needs to know that before they read it.
          */}
          {load.topUps.length > 0 && (
            <Pair
              label="Top-ups"
              value={`${formatQuantity(load.topUps.length)} since dispatch`}
            />
          )}
          {load.stockReturns.length > 0 && (
            <Pair
              label="Sent back"
              value={`${formatQuantity(load.stockReturns.length)} before Friday`}
            />
          )}
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
      {/*
        Every mid-week delivery, oldest first.
        
        Read from the movements each one wrote rather than from a second
        copy kept alongside - the ledger is the history, and a separate
        table of it could only ever disagree.
      */}
      {load.topUps.length > 0 && (
        <Card className="mt-6 p-0">
          <CardHeader
            title="Sent during the round"
            description={
              `${formatQuantity(load.topUps.length)} ` +
              `${load.topUps.length === 1 ? "delivery" : "deliveries"} after this van went out. ` +
              `All of it counts towards what is expected back.`
            }
          />
          <TableWrap>
            <Table>
              <thead>
                <Tr>
                  <Th>When</Th>
                  <Th>Sent by</Th>
                  <Th numeric>Products</Th>
                  <Th numeric>Units</Th>
                  <Th numeric>Loose</Th>
                  <Th>Note</Th>
                </Tr>
              </thead>
              <tbody>
                {load.topUps.map((t) => (
                  <Tr key={t.id}>
                    <Td>{formatDateTime(t.createdAt)}</Td>
                    <Td>{t.byName ?? "-"}</Td>
                    <Td numeric>{formatQuantity(t.lineCount)}</Td>
                    <Td numeric>{formatQuantity(t.units)}</Td>
                    <Td numeric>
                      {t.pieces > 0
                        ? formatQuantity(t.pieces)
                        : <span className="text-[var(--text-muted)]">-</span>}
                    </Td>
                    <Td className="text-[var(--text-secondary)]">
                      {t.note ?? <span className="text-[var(--text-muted)]">-</span>}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Card>
      )}

      {/*
        Stock that went back to a warehouse before the Friday count.
        
        Kept apart from the top-up history above because they are
        opposite events, and reading them in one table would make a busy
        week harder to follow rather than easier. Both are read from the
        movements they wrote.
      */}
      {load.stockReturns.length > 0 && (
        <Card className="mt-6 p-0">
          <CardHeader
            title="Sent back during the round"
            description={
              `${formatQuantity(load.stockReturns.length)} ` +
              `${load.stockReturns.length === 1 ? "hand-back" : "hand-backs"} to a warehouse ` +
              `before the Friday return. Friday expects what is left, not what went out.`
            }
          />
          <TableWrap>
            <Table>
              <thead>
                <Tr>
                  <Th>When</Th>
                  <Th>Sent by</Th>
                  <Th>To</Th>
                  <Th numeric>Products</Th>
                  <Th numeric>Units</Th>
                  <Th numeric>Loose</Th>
                  <Th>Why</Th>
                </Tr>
              </thead>
              <tbody>
                {load.stockReturns.map((r) => (
                  <Tr key={r.id}>
                    <Td>{formatDateTime(r.createdAt)}</Td>
                    <Td>{r.byName ?? "-"}</Td>
                    <Td>{r.warehouseName ?? "-"}</Td>
                    <Td numeric>{formatQuantity(r.lineCount)}</Td>
                    <Td numeric>{formatQuantity(r.units)}</Td>
                    <Td numeric>
                      {r.pieces > 0
                        ? formatQuantity(r.pieces)
                        : <span className="text-[var(--text-muted)]">-</span>}
                    </Td>
                    <Td className="text-[var(--text-secondary)]">
                      {r.note ?? <span className="text-[var(--text-muted)]">-</span>}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Card>
      )}

      {/*
        A round with nothing sent to it yet, for somebody who came here
        looking for the button. Said once, quietly, and only while the
        van is actually out.
      */}
      {canTopUp && load.topUps.length === 0 && (
        <Card className="mt-6">
          <div className="flex items-start gap-3 px-5 py-4">
            <PackagePlus className="mt-0.5 size-4 shrink-0 text-[var(--text-muted)]" aria-hidden />
            <p className="text-sm text-[var(--text-secondary)]">
              This van is out on its round. Until its return is approved,
              more stock can be sent to it with <span className="font-medium
              text-[var(--text-primary)]">Top up van</span>, and anything it does
              not need can go back to a warehouse with <span className="font-medium
              text-[var(--text-primary)]">Send stock back</span>. Neither closes
              the round.
            </p>
          </div>
        </Card>
      )}
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
