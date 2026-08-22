import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { listAwaitingReview } from "@/features/suppliers/queries";
import { OpenDocumentButton } from "@/features/suppliers/supplier-forms";
import { ApproveInvoiceButton, RejectInvoiceButton } from "@/features/suppliers/review-forms";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { formatMoney, formatDate, formatDateTime } from "@/lib/utils/format";
import { Inbox } from "lucide-react";

export const metadata: Metadata = { title: "Supplier invoices" };

/**
 * What suppliers have sent that nobody here has finished with.
 *
 * Oldest first, because the longest wait is the one about to become a
 * phone call. Each row carries what the supplier typed beside what we
 * hold, so a disagreement about the number or the company name is
 * visible without opening the file.
 */
export default async function SupplierReviewPage() {
  const user = await requireUser();
  // Approving an invoice is agreeing to pay it.
  if (!can(user.role, "payments.view")) return <Forbidden />;

  const queue = await listAwaitingReview();

  return (
    <>
      <PageHeader
        title="Supplier invoices"
        description="Sent in by suppliers through their own link, waiting to be checked."
        breadcrumbs={[
          { label: "Warehouse" },
          { label: "Purchasing", href: "/purchasing" },
          { label: "Supplier invoices" },
        ]}
      />

      {!queue.ok ? (
        <Card><ErrorState title="The review queue could not be loaded" message={queue.message} /></Card>
      ) : queue.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={Inbox}
            title="Nothing waiting"
            description="Every invoice a supplier has sent has been approved or sent back."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {queue.data.map((d) => (
            <Card key={d.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/suppliers/${d.supplierId}`}
                      className="text-base font-semibold text-[var(--text-primary)] hover:underline"
                    >
                      {d.supplierName}
                    </Link>
                    <Badge tone={d.status === "reviewing" ? "info" : "caution"}>
                      {d.status === "reviewing" ? "Being checked" : "New"}
                    </Badge>
                  </div>

                  <p className="numeric mt-1 text-sm text-[var(--text-secondary)]">
                    Invoice {d.reference}
                    {d.documentDate ? ` · dated ${formatDate(d.documentDate)}` : ""}
                  </p>

                  {/* What they typed, where it differs from what we hold.
                      Both are on the record rather than one having
                      quietly overwritten the other. */}
                  {d.submittedCompany && d.submittedCompany !== d.supplierName && (
                    <p className="mt-1 text-xs text-caution">
                      They gave their company as &ldquo;{d.submittedCompany}&rdquo;
                    </p>
                  )}

                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Sent {d.submittedAt ? formatDateTime(d.submittedAt) : "—"}
                    {d.submittedByName ? ` by ${d.submittedByName}` : ""}
                    {" · "}{d.fileName}
                  </p>
                </div>

                <div className="text-right">
                  <p className="numeric text-lg font-semibold text-[var(--text-primary)]">
                    {d.amount === null ? "—" : formatMoney(d.amount)}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-4">
                <OpenDocumentButton documentId={d.id} fileName={d.fileName} />
                {can(user.role, "payments.create") && (
                  <>
                    <ApproveInvoiceButton
                      documentId={d.id}
                      title={`Invoice ${d.reference} from ${d.supplierName}`}
                      amount={d.amount === null ? "No amount given" : formatMoney(d.amount)}
                    />
                    <RejectInvoiceButton
                      documentId={d.id}
                      title={`Invoice ${d.reference} from ${d.supplierName}`}
                      amount={d.amount === null ? "No amount given" : formatMoney(d.amount)}
                    />
                  </>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
