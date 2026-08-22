import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { getTransfer } from "@/features/transfers/queries";
import { TRANSFER_STATUS_LABELS } from "@/features/transfers/transfer-list";
import {
  ApproveTransferButton, DispatchTransferButton,
  ReceiveTransferButton, CancelTransferButton,
} from "@/features/transfers/transfer-forms";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { Alert, ErrorState } from "@/components/ui/states";
import { formatDate, formatDateTime, formatQuantity } from "@/lib/utils/format";
import { ArrowRight } from "lucide-react";

export const metadata: Metadata = { title: "Transfer" };

const TONE: Record<string, "positive" | "caution" | "critical" | "neutral" | "info"> = {
  draft: "caution", approved: "info", in_transit: "info",
  received: "positive", cancelled: "neutral",
};

/** The four steps, so the state of the thing is readable at a glance. */
const STEPS = [
  { key: "draft", label: "Raised" },
  { key: "approved", label: "Approved" },
  { key: "in_transit", label: "Dispatched" },
  { key: "received", label: "Received" },
] as const;

export default async function TransferPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, "inventory.transfer")) return <Forbidden />;

  const { id } = await params;
  const result = await getTransfer(id);

  if (!result.ok) {
    return <Card><ErrorState title="Transfer could not be loaded" message={result.message} /></Card>;
  }
  if (!result.data) notFound();

  const transfer = result.data;
  const reached = STEPS.findIndex((s) => s.key === transfer.status);
  const cancelled = transfer.status === "cancelled";

  // What is on hand at the source against what the transfer asks for.
  // Shown before dispatch, because that is when it can still be changed.
  const shortOfStock = transfer.lines.filter((l) => l.available < l.quantity);
  const beforeDispatch = transfer.status === "draft" || transfer.status === "approved";

  return (
    <>
      <PageHeader
        title={transfer.transferNumber}
        description={`${transfer.fromWarehouse} to ${transfer.toWarehouse}`}
        breadcrumbs={[
          { label: "Warehouse" },
          { label: "Transfers", href: "/transfers" },
          { label: transfer.transferNumber },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={TONE[transfer.status] ?? "neutral"}>
              {TRANSFER_STATUS_LABELS[transfer.status] ?? transfer.status}
            </Badge>
            {transfer.status === "draft" && can(user.role, "transfers.approve") && (
              <ApproveTransferButton transferId={transfer.id}
                                     transferNumber={transfer.transferNumber} />
            )}
            {transfer.status === "approved" && (
              <DispatchTransferButton transferId={transfer.id}
                                      transferNumber={transfer.transferNumber} />
            )}
            {transfer.status === "in_transit" && (
              <ReceiveTransferButton transferId={transfer.id}
                                     transferNumber={transfer.transferNumber}
                                     lines={transfer.lines} />
            )}
            {beforeDispatch && (
              <CancelTransferButton transferId={transfer.id}
                                    transferNumber={transfer.transferNumber} />
            )}
          </div>
        }
      />

      {transfer.status === "draft" && !can(user.role, "transfers.approve") && (
        <Alert tone="info">
          This is waiting for a manager to approve it. Nothing moves until then, which is
          deliberate: a depot that signs off its own transfers can move stock wherever it likes.
        </Alert>
      )}

      {cancelled && transfer.cancelledReason && (
        <Alert tone="warning" title="Cancelled">{transfer.cancelledReason}</Alert>
      )}

      {beforeDispatch && shortOfStock.length > 0 && (
        <Alert tone="warning" title="Not enough stock at the source">
          {shortOfStock.map((l) => l.productName).join(", ")} cannot be filled from{" "}
          {transfer.fromWarehouse} in the quantities asked for. Dispatch will be refused until
          the stock is there or the lines are reduced.
        </Alert>
      )}

      {transfer.status === "received" && transfer.qtyShort > 0 && (
        <Alert tone="warning" title="Some of it never arrived">
          {formatQuantity(transfer.qtyShort)} of the {formatQuantity(transfer.qtySent)} sent
          were not counted in at {transfer.toWarehouse}.
        </Alert>
      )}

      {/* Where it has got to. */}
      {!cancelled && (
        <Card className="p-5">
          <ol className="flex flex-wrap items-center gap-x-2 gap-y-3">
            {STEPS.map((step, i) => {
              const done = reached >= i;
              return (
                <li key={step.key} className="flex items-center gap-2">
                  <span
                    className={
                      done
                        ? "grid size-6 place-items-center rounded-full bg-brand-700 text-xs font-medium text-white"
                        : "grid size-6 place-items-center rounded-full border border-[var(--border-strong)] text-xs text-[var(--text-muted)]"
                    }
                  >
                    {i + 1}
                  </span>
                  <span
                    className={
                      done
                        ? "text-sm font-medium text-[var(--text-primary)]"
                        : "text-sm text-[var(--text-muted)]"
                    }
                  >
                    {step.label}
                  </span>
                  {i < STEPS.length - 1 && (
                    <ArrowRight className="size-4 text-[var(--text-muted)]" aria-hidden />
                  )}
                </li>
              );
            })}
          </ol>

          <dl className="mt-5 grid gap-4 border-t border-[var(--border-subtle)] pt-4 sm:grid-cols-4">
            {[
              { label: "Raised", value: formatDate(transfer.transferDate), by: null },
              {
                label: "Approved",
                value: transfer.approvedAt ? formatDateTime(transfer.approvedAt) : "—",
                by: transfer.approvedByName,
              },
              {
                label: "Dispatched",
                value: transfer.dispatchedAt ? formatDateTime(transfer.dispatchedAt) : "—",
                by: null,
              },
              {
                label: "Received",
                value: transfer.receivedAt ? formatDateTime(transfer.receivedAt) : "—",
                by: transfer.receivedByName,
              },
            ].map((entry) => (
              <div key={entry.label}>
                <dt className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                  {entry.label}
                </dt>
                <dd className="numeric mt-0.5 text-sm text-[var(--text-primary)]">{entry.value}</dd>
                {entry.by && (
                  <dd className="text-xs text-[var(--text-secondary)]">{entry.by}</dd>
                )}
              </div>
            ))}
          </dl>
        </Card>
      )}

      <Card className="overflow-hidden">
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Item</Th>
                <Th>Unit</Th>
                <Th numeric>Sent</Th>
                {beforeDispatch && <Th numeric>At {transfer.fromWarehouse}</Th>}
                {transfer.status === "received" && <Th numeric>Received</Th>}
                {transfer.status === "received" && <Th numeric>Short</Th>}
              </tr>
            </thead>
            <tbody>
              {transfer.lines.map((line) => {
                const short = line.quantity - (line.qtyReceived ?? line.quantity);
                return (
                  <Tr key={line.id}>
                    <Td>
                      <Link href={`/products/${line.productId}`} className="font-medium hover:underline">
                        {line.productName}
                      </Link>
                      {line.sku && (
                        <span className="numeric ml-2 text-xs text-[var(--text-muted)]">
                          {line.sku}
                        </span>
                      )}
                    </Td>
                    <Td className="text-[var(--text-secondary)]">{line.unit}</Td>
                    <Td numeric>{formatQuantity(line.quantity)}</Td>
                    {beforeDispatch && (
                      <Td numeric className={line.available < line.quantity ? "text-critical" : ""}>
                        {formatQuantity(line.available)}
                      </Td>
                    )}
                    {transfer.status === "received" && (
                      <Td numeric>{formatQuantity(line.qtyReceived ?? 0)}</Td>
                    )}
                    {transfer.status === "received" && (
                      <Td numeric className={short > 0 ? "text-critical" : ""}>
                        {short > 0 ? formatQuantity(short) : "—"}
                      </Td>
                    )}
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      </Card>

      {transfer.notes && (
        <Card className="p-5">
          <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
            Note
          </h2>
          <p className="mt-1.5 text-sm text-[var(--text-secondary)]">{transfer.notes}</p>
        </Card>
      )}
    </>
  );
}
