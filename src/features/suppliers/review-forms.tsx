"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { reviewSupplierDocumentAction } from "./actions";
import { INITIAL_SUPPLIER_STATE } from "./state";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { Check, X } from "lucide-react";

/**
 * Accepting an invoice, or sending it back.
 *
 * Two buttons rather than a status dropdown, because these are two
 * different decisions with two different consequences: one commits the
 * business to paying, the other tells a supplier to try again. A select
 * with five options makes them look like the same action.
 *
 * The rejection reason is required and the dialog says why - the
 * supplier reads it, and it is the only part of the review they see.
 */
function ReviewButton({
  documentId,
  title,
  amount,
  status,
  trigger,
  icon,
  variant,
  dialogTitle,
  description,
  confirmLabel,
  requireNote,
}: {
  documentId: string;
  title: string;
  amount: string;
  status: "approved" | "rejected";
  trigger: string;
  icon: React.ReactNode;
  variant: "primary" | "outline";
  dialogTitle: string;
  description: string;
  confirmLabel: string;
  requireNote: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    reviewSupplierDocumentAction, INITIAL_SUPPLIER_STATE);

  const close = () => {
    setOpen(false);
    if (state.status === "done") router.refresh();
  };

  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        {icon}
        {trigger}
      </Button>

      <Dialog open={open} onClose={close} title={dialogTitle} description={description}>
        {state.status === "done" ? (
          <div className="space-y-4">
            <Alert tone="success">{state.message}</Alert>
            <Button className="w-full" onClick={close}>Done</Button>
          </div>
        ) : (
          <form action={formAction} className="space-y-4">
            {state.status === "error" && state.message && (
              <Alert tone="danger">{state.message}</Alert>
            )}

            <input type="hidden" name="documentId" value={documentId} />
            <input type="hidden" name="status" value={status} />

            <div className="rounded-[var(--radius-panel)] bg-[var(--surface-sunken)] px-4 py-3">
              <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
              <p className="numeric mt-0.5 text-sm text-[var(--text-secondary)]">{amount}</p>
            </div>

            <Field
              label={requireNote ? "Why it is going back" : "Note"}
              htmlFor="note"
              required={requireNote}
              hint={
                requireNote
                  ? "The supplier reads this. Tell them what to send instead."
                  : "Optional. Kept internally."
              }
              error={state.fieldErrors?.note}
            >
              <Textarea id="note" name="note" rows={3} defaultValue={state.values?.note} />
            </Field>

            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1"
                      onClick={close} disabled={pending}>
                Not now
              </Button>
              <Button
                type="submit"
                variant={status === "rejected" ? "danger" : "primary"}
                className="flex-1"
                loading={pending}
              >
                {confirmLabel}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}

export function ApproveInvoiceButton(props: {
  documentId: string; title: string; amount: string;
}) {
  return (
    <ReviewButton
      {...props}
      status="approved"
      trigger="Approve"
      icon={<Check className="size-3.5" aria-hidden />}
      variant="primary"
      dialogTitle="Approve for payment"
      description="Agreeing this invoice is correct and can be paid."
      confirmLabel="Approve"
      requireNote={false}
    />
  );
}

export function RejectInvoiceButton(props: {
  documentId: string; title: string; amount: string;
}) {
  return (
    <ReviewButton
      {...props}
      status="rejected"
      trigger="Send back"
      icon={<X className="size-3.5" aria-hidden />}
      variant="outline"
      dialogTitle="Send it back"
      description="The supplier is told, and can send a corrected invoice through the same link."
      confirmLabel="Send back"
      requireNote
    />
  );
}
