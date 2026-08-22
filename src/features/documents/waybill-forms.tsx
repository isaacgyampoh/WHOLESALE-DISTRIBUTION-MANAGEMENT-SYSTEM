"use client";

import { Fragment, useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { RecordForm } from "@/components/ui/record-form";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { formatQuantity } from "@/lib/utils/format";
import { issueWaybillAction, markWaybillDeliveredAction } from "./actions";
import { INITIAL_DOCUMENT_STATE } from "./state";
import { FileOutput, PenLine } from "lucide-react";

/**
 * Raising a waybill for a load that already went out.
 *
 * The choice is a load rather than a list of products: the lines are
 * copied from the load by the database, so the document cannot claim
 * something different from what was actually put on the van.
 */
export function IssueWaybillButton({
  loads,
}: {
  loads: { id: string; loadNumber: string; vanCode: string; driverName: string; loadDate: string }[];
}) {
  return (
    <RecordForm
      action={issueWaybillAction}
      trigger="Issue waybill"
      icon={<FileOutput className="size-4" aria-hidden />}
      title="Issue a waybill"
      description="The lines are taken from the load itself, so the document matches what went on the van."
      submitLabel="Issue waybill"
      disabled={loads.length === 0}
      fields={[
        {
          name: "loadId",
          label: "Van load",
          type: "select",
          required: true,
          options: loads.map((l) => ({
            value: l.id,
            label: `${l.loadNumber} · ${l.vanCode} · ${l.driverName}`,
          })),
          hint:
            loads.length === 0
              ? "Every dispatched load already has a waybill."
              : undefined,
        },
      ]}
    />
  );
}

/**
 * Signing the goods in at the other end.
 *
 * Every line is present with damaged and missing left blank, because a
 * clean delivery is the common case and should need no typing. Filling
 * one in is how a shortage gets on the record - and a waybill signed
 * without them says the delivery was perfect, which is a claim rather
 * than a record.
 */
export function MarkDeliveredButton({
  waybillId,
  waybillNumber,
  lines,
}: {
  waybillId: string;
  waybillNumber: string;
  lines: { id: string; productName: string; unit: string; quantity: number }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    markWaybillDeliveredAction, INITIAL_DOCUMENT_STATE);
  const [damaged, setDamaged] = useState<Record<string, string>>({});
  const [short, setShort] = useState<Record<string, string>>({});

  const close = () => {
    setOpen(false);
    if (state.status === "done") router.refresh();
  };

  const shortfall = lines.reduce(
    (sum, l) => sum + Number(damaged[l.id] || 0) + Number(short[l.id] || 0), 0);

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <PenLine className="size-4" aria-hidden />
        Sign for delivery
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title={`Sign for ${waybillNumber}`}
        description="Record who took the goods, and anything that did not arrive in good order."
        className="sm:max-w-lg"
      >
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

            <input type="hidden" name="waybillId" value={waybillId} />

            <Field
              label="Received by"
              htmlFor="receivedBy"
              required
              hint="The name of the person who signed."
              error={state.fieldErrors?.receivedBy}
            >
              <Input id="receivedBy" name="receivedBy" required
                     defaultValue={state.values?.receivedBy} />
            </Field>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-[var(--text-primary)]">
                Anything wrong
              </legend>
              <p className="text-xs text-[var(--text-muted)]">
                Leave both blank where the line arrived in full and in good order.
              </p>

              <div className="grid grid-cols-[1fr_auto_auto] items-end gap-2">
                <span className="text-xs text-[var(--text-muted)]">Item</span>
                <span className="w-20 text-center text-xs text-[var(--text-muted)]">Damaged</span>
                <span className="w-20 text-center text-xs text-[var(--text-muted)]">Missing</span>

                {lines.map((line) => (
                  <Fragment key={line.id}>
                    <input type="hidden" name="itemId" value={line.id} />
                    <div className="min-w-0">
                      <p className="truncate text-sm text-[var(--text-primary)]">
                        {line.productName}
                      </p>
                      <p className="numeric text-xs text-[var(--text-muted)]">
                        {formatQuantity(line.quantity)} {line.unit} sent
                      </p>
                    </div>
                    <Input
                      name="damaged"
                      aria-label={`Damaged, ${line.productName}`}
                      inputMode="numeric"
                      value={damaged[line.id] ?? ""}
                      onChange={(e) =>
                        setDamaged((c) => ({ ...c, [line.id]: e.target.value.replace(/\D/g, "") }))}
                      className="numeric w-20"
                    />
                    <Input
                      name="short"
                      aria-label={`Missing, ${line.productName}`}
                      inputMode="numeric"
                      value={short[line.id] ?? ""}
                      onChange={(e) =>
                        setShort((c) => ({ ...c, [line.id]: e.target.value.replace(/\D/g, "") }))}
                      className="numeric w-20"
                    />
                  </Fragment>
                ))}
              </div>
            </fieldset>

            {shortfall > 0 && (
              <Alert tone="warning">
                {formatQuantity(shortfall)} unit{shortfall === 1 ? "" : "s"} damaged or missing.
                That stays on the waybill as a record of what did not arrive.
              </Alert>
            )}

            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1"
                      onClick={close} disabled={pending}>
                Not now
              </Button>
              <Button type="submit" className="flex-1" loading={pending}>
                Record delivery
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
