import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { getWaybill } from "@/features/documents/queries";
import {
  DocumentShell, DocumentTable, SignatureBlock,
} from "@/features/documents/document-shell";
import { WAYBILL_STATUS_LABELS } from "@/features/documents/waybill-list";
import { MarkDeliveredButton } from "@/features/documents/waybill-forms";
import { Forbidden } from "@/components/layout/forbidden";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/ui/states";
import { BRAND } from "@/lib/brand";
import { formatDate, formatDateTime, formatQuantity } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Waybill" };

/**
 * The document that travels with the goods.
 *
 * No money on it anywhere. A waybill is evidence that a quantity of
 * something moved from one place to another, and the person signing it
 * at the far end has no business seeing what the load was worth.
 */
export default async function WaybillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, "documents.view")) return <Forbidden />;

  const { id } = await params;
  const result = await getWaybill(id);

  if (!result.ok) {
    return <Card><ErrorState title="Waybill could not be loaded" message={result.message} /></Card>;
  }
  if (!result.data) notFound();

  const waybill = result.data;
  const carrier = waybill.vanCode
    ? [
        `Van ${waybill.vanCode}`,
        waybill.vanRegistration,
        waybill.driverName ? `Driver ${waybill.driverName}` : null,
      ]
    : [waybill.customerName ?? waybill.destination, waybill.driverName];

  return (
    <DocumentShell
      title="Waybill"
      reference={waybill.waybillNumber}
      backHref="/waybills"
      backLabel="All waybills"
      status={
        <>
          <Badge tone={waybill.status === "delivered" ? "positive" : "info"}>
            {WAYBILL_STATUS_LABELS[waybill.status] ?? waybill.status}
          </Badge>
          {waybill.status === "issued" && can(user.role, "documents.issue") && (
            <MarkDeliveredButton waybillId={waybill.id} waybillNumber={waybill.waybillNumber} />
          )}
        </>
      }
      parties={[
        {
          label: "Dispatched from",
          lines: [BRAND.name, waybill.warehouseName, "Ghana"],
        },
        { label: "Carried by", lines: carrier },
      ]}
      meta={[
        { label: "Issued", value: formatDate(waybill.issuedOn) },
        { label: "Lines", value: formatQuantity(waybill.itemCount) },
        { label: "Total units", value: formatQuantity(waybill.totalQuantity) },
        ...(waybill.deliveredAt
          ? [{ label: "Delivered", value: formatDateTime(waybill.deliveredAt) }]
          : []),
      ]}
      footer={
        <p>
          Goods are to be checked on receipt. Any shortage or damage must be noted on this
          waybill at the point of delivery.
          {waybill.notes ? ` ${waybill.notes}` : ""}
        </p>
      }
    >
      {waybill.lines.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--text-muted)]">This waybill has no lines.</p>
      ) : (
        <DocumentTable
          head={
            <>
              <th className="py-2 pr-3 font-medium text-[var(--text-secondary)]">Item</th>
              <th className="py-2 px-3 font-medium text-[var(--text-secondary)]">Unit</th>
              <th className="py-2 px-3 text-right font-medium text-[var(--text-secondary)]">
                Quantity
              </th>
              <th className="py-2 pl-3 font-medium text-[var(--text-secondary)]">
                Checked on receipt
              </th>
            </>
          }
        >
          {waybill.lines.map((line, i) => (
            <tr key={i}>
              <td className="py-2.5 pr-3">
                <span className="text-[var(--text-primary)]">{line.productName}</span>
                {line.sku && (
                  <span className="numeric ml-2 text-xs text-[var(--text-muted)]">{line.sku}</span>
                )}
              </td>
              <td className="py-2.5 px-3 text-[var(--text-secondary)]">{line.unit}</td>
              <td className="numeric py-2.5 px-3 text-right font-medium">
                {formatQuantity(line.quantity)}
              </td>
              {/* Filled in with a pen at the far end, which is the whole
                  point of the document. */}
              <td className="py-2.5 pl-3">
                <span className="block h-5 w-24 border-b border-dotted border-[var(--border-strong)]" />
              </td>
            </tr>
          ))}
        </DocumentTable>
      )}

      {waybill.receivedByName ? (
        <div className="print-keep mt-8 rounded-lg border border-[var(--border-subtle)] px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
            Received by
          </p>
          <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">
            {waybill.receivedByName}
          </p>
          {waybill.deliveredAt && (
            <p className="numeric mt-0.5 text-xs text-[var(--text-muted)]">
              {formatDateTime(waybill.deliveredAt)}
            </p>
          )}
        </div>
      ) : (
        <SignatureBlock lines={["Dispatched by · date", "Received by · date"]} />
      )}
    </DocumentShell>
  );
}
