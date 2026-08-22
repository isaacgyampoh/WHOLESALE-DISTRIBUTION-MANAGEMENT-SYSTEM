"use client";

import { useActionState } from "react";
import { submitSupplierInvoiceAction } from "./portal-actions";
import { INITIAL_SUPPLIER_STATE } from "./state";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/states";
import { Upload, CheckCircle2 } from "lucide-react";

/**
 * A supplier sending their invoice.
 *
 * Written for somebody who does not work here and will use it perhaps
 * once a month: every field says what it wants in plain words, the
 * accepted formats are stated rather than discovered by being refused,
 * and nothing on the form assumes they know what a purchase order
 * number is.
 *
 * It is a plain form rather than a dialog. The person filling it in is
 * on a phone, on someone else's network, possibly with the invoice
 * photographed a moment ago - a modal that could be dismissed by a
 * stray tap is the wrong shape for that.
 */
export function PortalUploadForm({
  token,
  supplierName,
  companyName,
}: {
  token: string;
  supplierName: string;
  companyName: string;
}) {
  const [state, formAction, pending] = useActionState(
    submitSupplierInvoiceAction, INITIAL_SUPPLIER_STATE);

  if (state.status === "done") {
    return (
      <div className="rounded-lg border border-positive/30 bg-positive-soft p-6 text-center dark:bg-positive/10">
        <CheckCircle2 className="mx-auto size-8 text-positive" aria-hidden />
        <h3 className="mt-3 text-base font-semibold text-[var(--text-primary)]">
          Invoice received
        </h3>
        <p className="mt-1.5 text-sm text-[var(--text-secondary)]">{state.message}</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => window.location.reload()}
        >
          Send another
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {state.status === "error" && state.message && (
        <Alert tone="danger">{state.message}</Alert>
      )}

      <input type="hidden" name="token" value={token} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your company" htmlFor="company" required
               hint="As it appears on the invoice."
               error={state.fieldErrors?.company}>
          <Input id="company" name="company" required
                 defaultValue={state.values?.company ?? supplierName} />
        </Field>

        <Field label="Your name" htmlFor="contact"
               hint="So we know who to come back to." >
          <Input id="contact" name="contact" defaultValue={state.values?.contact} />
        </Field>

        <Field label="Invoice number" htmlFor="reference" required
               error={state.fieldErrors?.reference}>
          <Input id="reference" name="reference" required placeholder="INV-4471"
                 defaultValue={state.values?.reference} />
        </Field>

        <Field label="Invoice date" htmlFor="documentDate" required
               error={state.fieldErrors?.documentDate}>
          <Input id="documentDate" name="documentDate" type="date" required
                 defaultValue={state.values?.documentDate} />
        </Field>

        <Field label="Amount" htmlFor="amount" required
               hint={`In cedi, for example 4500.00`}
               error={state.fieldErrors?.amount}>
          <Input id="amount" name="amount" inputMode="decimal" required placeholder="0.00"
                 defaultValue={state.values?.amount} />
        </Field>
      </div>

      <Field label="The invoice itself" htmlFor="file" required
             hint="A PDF or a clear photograph, up to 20 MB."
             error={state.fieldErrors?.file}>
        <input
          id="file"
          name="file"
          type="file"
          required
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic"
          className="block w-full text-sm text-[var(--text-secondary)] file:mr-3 file:rounded-md file:border file:border-[var(--border-strong)] file:bg-[var(--surface-sunken)] file:px-3 file:py-2.5 file:text-sm file:text-[var(--text-primary)]"
        />
      </Field>

      <Field label="Anything we should know" htmlFor="notes" hint="Optional.">
        <Textarea id="notes" name="notes" rows={2} defaultValue={state.values?.notes} />
      </Field>

      <Button type="submit" size="lg" className="w-full" loading={pending}>
        <Upload className="size-4" aria-hidden />
        Send this invoice to {companyName}
      </Button>

      <p className="text-center text-xs text-[var(--text-muted)]">
        It goes straight to the accounts team. You will see it listed above once it arrives.
      </p>
    </form>
  );
}
