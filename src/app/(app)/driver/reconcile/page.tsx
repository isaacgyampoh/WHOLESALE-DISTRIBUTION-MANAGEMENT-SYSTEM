import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { getDriverRound } from "@/features/driver/queries";
import { ReconcileForm } from "@/features/driver/reconcile-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Alert, ErrorState } from "@/components/ui/states";

export const metadata: Metadata = { title: "End of day" };

export default async function DriverReconcilePage() {
  const user = await requireUser();
  const result = await getDriverRound(user.id);

  if (!result.ok) {
    return (
      <>
        <PageHeader title="End of day" />
        <Card><ErrorState title="Your round could not be loaded" message={result.message} /></Card>
      </>
    );
  }

  const { reconciliation, hasSubmittedReturn } = result.data;
  const alreadyIn = reconciliation && reconciliation.status !== "draft";

  return (
    <>
      <PageHeader
        title="End of day"
        description="Hand in the cash and close the round."
        breadcrumbs={[{ label: "My round", href: "/driver" }, { label: "End of day" }]}
      />

      {!hasSubmittedReturn && (
        <div className="mb-4">
          <Alert tone="warning" title="Count the van in first">
            Your stock count decides what the round should have made. Do the
            return before the cash.
          </Alert>
        </div>
      )}

      {alreadyIn ? (
        <Card>
          <div className="p-5">
            <Alert
              tone={reconciliation.status === "rejected" ? "danger" : "info"}
              title={`${reconciliation.reconNumber} is ${reconciliation.status}`}
            >
              {reconciliation.status === "rejected"
                ? "It came back to you. Speak to your supervisor before resubmitting."
                : "A supervisor is checking it. You cannot approve your own round."}
            </Alert>
          </div>
        </Card>
      ) : (
        <ReconcileForm
          expectedCash={reconciliation?.expectedCash ?? null}
          reconciliationId={reconciliation?.id ?? null}
        />
      )}
    </>
  );
}
