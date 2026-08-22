import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import {
  getSupplier, listSupplierDocuments, listPortalTokens,
} from "@/features/suppliers/queries";
import { listPurchaseOrders } from "@/features/warehouses/queries";
import {
  UploadDocumentButton, OpenDocumentButton, DeleteDocumentButton,
  IssuePortalLinkButton, RevokePortalLinkButton,
} from "@/features/suppliers/supplier-forms";
import { ApproveInvoiceButton, RejectInvoiceButton } from "@/features/suppliers/review-forms";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card, CardHeader } from "@/components/ui/card";
import { StatTile, StatGrid } from "@/components/ui/stat-tile";
import { Badge } from "@/components/ui/badge";
import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { EmptyState, ErrorState, Alert } from "@/components/ui/states";
import { formatMoney, formatDate, formatDateTime, formatQuantity } from "@/lib/utils/format";
import { FileText, Link2 } from "lucide-react";

export const metadata: Metadata = { title: "Supplier" };

const KIND_LABELS: Record<string, string> = {
  invoice: "Invoice",
  delivery_note: "Delivery note",
  waybill: "Waybill",
  credit_note: "Credit note",
  certificate: "Certificate",
  contract: "Contract",
  other: "Document",
};

/** How far along a document is, worded for whoever is looking at it. */
const STATUS_LABELS: Record<string, string> = {
  pending: "Not yet sent",
  received: "Awaiting review",
  reviewing: "Being checked",
  approved: "Approved",
  rejected: "Sent back",
};

const STATUS_TONE: Record<string, "positive" | "caution" | "critical" | "neutral" | "info"> = {
  pending: "neutral",
  received: "caution",
  reviewing: "info",
  approved: "positive",
  rejected: "critical",
};

/** Bytes are not a unit anybody reads. */
function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function SupplierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  // Supplier records carry purchase prices, which is management
  // information under the same rule as cost on a product.
  if (!can(user.role, "inventory.view")) return <Forbidden />;

  const { id } = await params;
  const [supplier, documents, tokens, orders] = await Promise.all([
    getSupplier(id),
    listSupplierDocuments(id),
    can(user.role, "users.manage") ? listPortalTokens(id) : Promise.resolve(null),
    listPurchaseOrders({ page: 1 }),
  ]);

  if (!supplier.ok) {
    return <Card><ErrorState title="Supplier could not be loaded" message={supplier.message} /></Card>;
  }
  if (!supplier.data) notFound();

  const s = supplier.data;
  const canFile = can(user.role, "inventory.transfer");
  const theirOrders = orders.ok
    ? orders.data.orders
        .filter((o) => o.supplierName === s.name)
        .map((o) => ({ id: o.id, label: `${o.poNumber} · ${formatDate(o.orderDate)}` }))
    : [];

  return (
    <>
      <PageHeader
        title={s.name}
        description={s.contactName ? `${s.code} · ${s.contactName}` : s.code}
        breadcrumbs={[
          { label: "Warehouse" },
          { label: "Purchasing", href: "/purchasing" },
          { label: s.name },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!s.isActive && <Badge tone="neutral">Inactive</Badge>}
            {can(user.role, "users.manage") && (
              <IssuePortalLinkButton supplierId={s.id} supplierName={s.name} />
            )}
            {canFile && <UploadDocumentButton supplierId={s.id} orders={theirOrders} />}
          </div>
        }
      />

      <StatGrid>
        <StatTile label="Orders placed" value={formatQuantity(s.orderCount)}
                  sub={s.lastOrderDate ? `Last on ${formatDate(s.lastOrderDate)}` : "None yet"}
                  href="/purchasing" />
        <StatTile label="Still open" value={formatQuantity(s.openOrders)}
                  sub="Sent and not fully received"
                  tone={s.openOrders > 0 ? "caution" : "neutral"} />
        <StatTile label="Payment terms" value={`${s.paymentTermsDays} days`}
                  sub="What we have agreed to pay in" />
        <StatTile label="Lead time" value={`${s.leadTimeDays} days`}
                  sub="From order to delivery" />
      </StatGrid>

      <Card>
        <CardHeader
          title="Paperwork"
          description="Kept privately. Opening one mints a link that lasts five minutes."
        />
        {!documents.ok ? (
          <div className="p-5"><Alert tone="warning">{documents.message}</Alert></div>
        ) : documents.data.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="Nothing filed yet"
            description="File the invoice and delivery note that came with a delivery, so a dispute six weeks later has something behind it."
          />
        ) : (
          <TableWrap className="rounded-t-none border-0">
            <Table>
              <thead>
                <tr>
                  <Th>Document</Th>
                  <Th>Kind</Th>
                  <Th>Status</Th>
                  <Th>Dated</Th>
                  <Th numeric>Amount</Th>
                  <Th>Against</Th>
                  <Th>Filed by</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {documents.data.map((d) => (
                  <Tr key={d.id}>
                    <Td>
                      <span className="block font-medium">{d.title}</span>
                      <span className="text-xs text-[var(--text-muted)]">
                        {d.fileName} · {fileSize(d.sizeBytes)}
                        {d.reference ? ` · ${d.reference}` : ""}
                      </span>
                    </Td>
                    <Td><Badge tone="neutral">{KIND_LABELS[d.kind] ?? d.kind}</Badge></Td>
                    <Td>
                      <Badge tone={STATUS_TONE[d.status] ?? "neutral"}>
                        {STATUS_LABELS[d.status] ?? d.status}
                      </Badge>
                      {/* Where it came from matters: an invoice the
                          supplier sent themselves is evidence in a way
                          one we typed up is not. */}
                      {d.submittedAt && (
                        <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
                          Sent by them
                        </span>
                      )}
                      {d.status === "rejected" && d.reviewNote && (
                        <span className="mt-0.5 block max-w-48 text-xs text-critical">
                          {d.reviewNote}
                        </span>
                      )}
                    </Td>
                    <Td className="numeric whitespace-nowrap text-[var(--text-secondary)]">
                      {d.documentDate ? formatDate(d.documentDate) : "—"}
                    </Td>
                    <Td numeric>{d.amount === null ? "—" : formatMoney(d.amount)}</Td>
                    <Td className="numeric text-[var(--text-secondary)]">{d.poNumber ?? "—"}</Td>
                    <Td className="text-[var(--text-secondary)]">{d.uploadedByName ?? "—"}</Td>
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        <OpenDocumentButton documentId={d.id} fileName={d.fileName} />
                        {(d.status === "received" || d.status === "reviewing")
                          && can(user.role, "payments.create") && (
                          <>
                            <ApproveInvoiceButton
                              documentId={d.id}
                              title={d.title}
                              amount={d.amount === null ? "No amount given" : formatMoney(d.amount)}
                            />
                            <RejectInvoiceButton
                              documentId={d.id}
                              title={d.title}
                              amount={d.amount === null ? "No amount given" : formatMoney(d.amount)}
                            />
                          </>
                        )}
                        {can(user.role, "products.edit") && (
                          <DeleteDocumentButton documentId={d.id} title={d.title} />
                        )}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>

      {tokens && (
        <Card>
          <CardHeader
            title="Portal links"
            description="What this supplier can open to see their own orders. No account, no password, and revocable."
          />
          {!tokens.ok ? (
            <div className="p-5"><Alert tone="warning">{tokens.message}</Alert></div>
          ) : tokens.data.length === 0 ? (
            <EmptyState
              icon={Link2}
              title="No links issued"
              description="Issue one so this supplier can check their own orders instead of ringing to ask."
            />
          ) : (
            <TableWrap className="rounded-t-none border-0">
              <Table>
                <thead>
                  <tr>
                    <Th>Link</Th>
                    <Th>Expires</Th>
                    <Th>Last used</Th>
                    <Th numeric>Opened</Th>
                    <Th>State</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {tokens.data.map((t) => (
                    <Tr key={t.id}>
                      <Td>
                        <span className="block font-medium">{t.label ?? "Portal link"}</span>
                        {/* The first few characters only. The rest is not
                            stored, and would not be shown if it were. */}
                        <span className="numeric text-xs text-[var(--text-muted)]">
                          {t.hint}… · issued {formatDate(t.createdAt)}
                        </span>
                      </Td>
                      <Td className="numeric whitespace-nowrap text-[var(--text-secondary)]">
                        {formatDate(t.expiresAt)}
                      </Td>
                      <Td className="numeric whitespace-nowrap text-[var(--text-secondary)]">
                        {t.lastUsedAt ? formatDateTime(t.lastUsedAt) : "Never"}
                      </Td>
                      <Td numeric>{formatQuantity(t.useCount)}</Td>
                      <Td>
                        <Badge
                          tone={
                            t.state === "active" ? "positive"
                              : t.state === "revoked" ? "critical" : "neutral"
                          }
                        >
                          {t.state === "active" ? "Active"
                            : t.state === "revoked" ? "Revoked" : "Expired"}
                        </Badge>
                      </Td>
                      <Td>
                        <div className="flex justify-end">
                          {t.state === "active" && (
                            <RevokePortalLinkButton tokenId={t.id} hint={t.hint} />
                          )}
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>
      )}

      <p className="text-sm">
        <Link href="/purchasing" className="text-brand-700 hover:underline">
          Back to purchasing
        </Link>
      </p>
    </>
  );
}
