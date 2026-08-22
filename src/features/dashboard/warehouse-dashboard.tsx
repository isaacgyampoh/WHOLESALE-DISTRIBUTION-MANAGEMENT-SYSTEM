import Link from "next/link";
import type { WarehouseView } from "./role-queries";
import { StatTile, StatGrid } from "@/components/ui/stat-tile";
import { Card, CardHeader } from "@/components/ui/card";
import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Alert } from "@/components/ui/states";
import { formatMoney, formatQuantity } from "@/lib/utils/format";
import { PackageCheck } from "lucide-react";

/**
 * The warehouse's morning.
 *
 * Ordered by what stops something else: expired stock blocks a van from
 * dispatching at all, a load waiting to go out holds up a round, and a
 * transfer nobody has booked in is stock the business cannot see. Value
 * comes last, because nobody in a warehouse acts on it.
 */
export function WarehouseDashboard({ view }: { view: WarehouseView }) {
  const waiting =
    view.loadsToDispatch + view.returnsToApprove
    + view.transfersToDispatch + view.transfersToReceive;

  return (
    <>
      {view.expiredBatches > 0 && (
        <div className="mb-5">
          <Alert tone="danger" title="Expired stock is on hand">
            {formatQuantity(view.expiredBatches)}{" "}
            {view.expiredBatches === 1 ? "batch is" : "batches are"} past their date. No van
            will dispatch and no transfer will leave while they are in the warehouse.{" "}
            <Link href="/inventory/expiry?status=expired" className="underline">
              Write them off
            </Link>
          </Alert>
        </div>
      )}

      <StatGrid>
        <StatTile label="Loads to dispatch" value={formatQuantity(view.loadsToDispatch)}
                  sub="Signed for and waiting to go"
                  tone={view.loadsToDispatch > 0 ? "caution" : "neutral"}
                  href="/loads" />
        <StatTile label="Returns to approve" value={formatQuantity(view.returnsToApprove)}
                  sub="Stock does not come back until you do"
                  tone={view.returnsToApprove > 0 ? "caution" : "neutral"}
                  href="/returns" />
        <StatTile label="Transfers to send" value={formatQuantity(view.transfersToDispatch)}
                  sub="Approved and still in the warehouse"
                  tone={view.transfersToDispatch > 0 ? "caution" : "neutral"}
                  href="/transfers?status=approved" />
        <StatTile label="Transfers to receive" value={formatQuantity(view.transfersToReceive)}
                  sub="On the road, counted nowhere"
                  tone={view.transfersToReceive > 0 ? "caution" : "neutral"}
                  href="/transfers?status=in_transit" />
      </StatGrid>

      <StatGrid>
        <StatTile label="Below reorder point" value={formatQuantity(view.lowStockCount)}
                  sub="Lines to put on an order"
                  tone={view.lowStockCount > 0 ? "caution" : "positive"}
                  href="/inventory?stock=low_stock" />
        <StatTile label="Expiring soon" value={formatQuantity(view.expiringBatches)}
                  sub="Sell these first"
                  tone={view.expiringBatches > 0 ? "caution" : "positive"}
                  href="/inventory/expiry?status=expiring" />
        <StatTile label="Deliveries expected" value={formatQuantity(view.purchasesExpected)}
                  sub="Purchase orders still open"
                  href="/purchasing" />
        <StatTile label="Stock on hand" value={formatMoney(view.stockValue)}
                  sub="At cost, across every warehouse"
                  href="/inventory" />
      </StatGrid>

      <Card>
        <CardHeader
          title="On the road"
          description="Stock that has left one warehouse and not been booked in at the other. It counts in neither."
          action={
            <Link href="/transfers?status=in_transit" className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">
              All transfers
            </Link>
          }
        />
        {view.inTransit.length === 0 ? (
          <EmptyState
            icon={PackageCheck}
            title={waiting === 0 ? "Nothing is waiting on you" : "Nothing is in transit"}
            description="Every transfer that left has been counted in at the far end."
          />
        ) : (
          <TableWrap className="rounded-t-none border-0">
            <Table>
              <thead>
                <tr>
                  <Th>Transfer</Th>
                  <Th>Item</Th>
                  <Th>Going to</Th>
                  <Th numeric>Units</Th>
                  <Th>On the road</Th>
                </tr>
              </thead>
              <tbody>
                {view.inTransit.map((r, i) => (
                  <Tr key={`${r.transferNumber}-${i}`}>
                    <Td className="numeric font-medium">{r.transferNumber}</Td>
                    <Td>{r.productName}</Td>
                    <Td className="text-[var(--text-secondary)]">{r.toWarehouse}</Td>
                    <Td numeric>{formatQuantity(r.quantity)}</Td>
                    <Td>
                      {/* Two days is generous for a depot move within
                          Ghana; beyond that somebody has forgotten to
                          book it in, or it never arrived. */}
                      <Badge tone={r.daysInTransit > 2 ? "critical" : "neutral"}>
                        {r.daysInTransit === 0
                          ? "Today"
                          : `${r.daysInTransit} day${r.daysInTransit === 1 ? "" : "s"}`}
                      </Badge>
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
