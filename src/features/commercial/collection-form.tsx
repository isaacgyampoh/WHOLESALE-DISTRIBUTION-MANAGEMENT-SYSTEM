"use client";

import { useActionState, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { recordCollectionAction } from "./actions";
import { INITIAL_COMMERCIAL_STATE } from "./state";
import { METHOD_LABELS } from "./payment-list";
import { PAYMENT_METHODS } from "@/types/domain";
import { formatMoney } from "@/lib/utils/format";
import { Banknote } from "lucide-react";

export interface CollectionCustomer {
  id: string;
  name: string;
  code: string;
  balance: number;
}

/**
 * Recording money received from a customer.
 *
 * The customer's outstanding balance is shown beside the amount because
 * the commonest collection is "all of it", and a clerk should not have
 * to leave the dialog to find the figure.
 */
export function RecordCollectionButton({ customers }: { customers: CollectionCustomer[] }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    recordCollectionAction,
    INITIAL_COMMERCIAL_STATE,
  );
  const [customerId, setCustomerId] = useState("");

  const chosen = customers.find((c) => c.id === customerId);

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={customers.length === 0}>
        <Banknote className="size-4" aria-hidden />
        Record collection
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Record a collection"
        description="Money received against a customer's account."
      >
        {state.status === "done" ? (
          <div className="space-y-4">
            <Alert tone="success">{state.message}</Alert>
            <Button className="w-full" onClick={() => { setOpen(false); setCustomerId(""); }}>
              Done
            </Button>
          </div>
        ) : (
          <form action={formAction} className="space-y-4">
            {state.status === "error" && state.message && !state.fieldErrors && (
              <Alert tone="danger">{state.message}</Alert>
            )}

            <Field label="Customer" htmlFor="customerId" required
                   error={state.fieldErrors?.customerId}>
              <Select
                id="customerId" name="customerId" required
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">Choose a customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </Select>
            </Field>

            {chosen && (
              <Alert tone="info">
                {chosen.name} currently owes {formatMoney(chosen.balance)}.
              </Alert>
            )}

            <Field label="Amount received" htmlFor="amount" required
                   hint="In Ghana Cedis."
                   error={state.fieldErrors?.amount}>
              <Input
                id="amount" name="amount" required
                inputMode="decimal" placeholder="0.00"
                defaultValue={state.values?.amount}
              />
            </Field>

            <Field label="Method" htmlFor="method" required error={state.fieldErrors?.method}>
              <Select id="method" name="method" defaultValue={state.values?.method ?? "cash"}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>{METHOD_LABELS[m] ?? m}</option>
                ))}
              </Select>
            </Field>

            <Field label="Reference or note" htmlFor="notes"
                   hint="A transfer reference or momo transaction id, if there is one.">
              <Textarea id="notes" name="notes" rows={2} defaultValue={state.values?.notes} />
            </Field>

            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1"
                      onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" loading={pending}>
                Record collection
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
