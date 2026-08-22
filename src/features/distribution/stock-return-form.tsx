"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { recordStockReturnAction } from "./actions";
import { INITIAL_DISTRIBUTION_STATE, RETURN_REASONS } from "./state";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { Plus, Trash2, Undo2 } from "lucide-react";

interface Line { key: string; productId: string; quantity: string }
type Direction = "customer" | "supplier";

/**
 * Goods coming back from a customer, or going back to a supplier.
 *
 * One form for both, because they are the same act in opposite
 * directions and splitting them into two screens would double the
 * maintenance for no gain. The direction is chosen first, since it
 * changes who the other party is and which way the stock moves - and
 * the form says which way, so nobody has to infer it.
 */
export function RecordStockReturnButton({
  warehouses,
  customers,
  suppliers,
  products,
}: {
  warehouses: { id: string; label: string }[];
  customers: { id: string; label: string }[];
  suppliers: { id: string; label: string }[];
  products: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<Direction>("customer");
  const [state, formAction, pending] = useActionState(
    recordStockReturnAction, INITIAL_DISTRIBUTION_STATE);
  const [lines, setLines] = useState<Line[]>([{ key: "r0", productId: "", quantity: "" }]);
  const [nextKey, setNextKey] = useState(1);

  const setLine = (key: string, patch: Partial<Line>) =>
    setLines((c) => c.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const close = () => {
    setOpen(false);
    if (state.status === "done") router.refresh();
  };

  const parties = direction === "customer" ? customers : suppliers;
  const blocked = warehouses.length === 0 || products.length === 0;

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} disabled={blocked}>
        <Undo2 className="size-4" aria-hidden />
        Record a return
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title="Record a return"
        description="Goods coming back from a customer, or going back to a supplier."
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

            <input type="hidden" name="direction" value={direction} />

            {/* Chosen first: it decides who the other party is and which
                way the stock moves. */}
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-[var(--text-primary)]">
                Which way
              </legend>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={direction === "customer" ? "primary" : "outline"}
                  onClick={() => setDirection("customer")}
                >
                  From a customer
                </Button>
                <Button
                  type="button"
                  variant={direction === "supplier" ? "primary" : "outline"}
                  onClick={() => setDirection("supplier")}
                >
                  To a supplier
                </Button>
              </div>
              <p className="mt-1.5 text-xs text-[var(--text-muted)]">
                {direction === "customer"
                  ? "The stock comes back onto the warehouse."
                  : "The stock leaves the warehouse, so it has to be there to send."}
              </p>
            </fieldset>

            <Field
              label={direction === "customer" ? "Returned by" : "Going back to"}
              htmlFor="partyId"
              required
              error={state.fieldErrors?.partyId}
            >
              <Select id="partyId" name="partyId" required key={direction}>
                <option value="">
                  {direction === "customer" ? "Choose a customer" : "Choose a supplier"}
                </option>
                {parties.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </Select>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Warehouse" htmlFor="warehouseId" required
                     error={state.fieldErrors?.warehouseId}>
                <Select id="warehouseId" name="warehouseId" required
                        defaultValue={state.values?.warehouseId}>
                  <option value="">Choose a warehouse</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
                </Select>
              </Field>

              <Field label="Why" htmlFor="reason" required
                     hint="Chosen from a list so it can be counted later."
                     error={state.fieldErrors?.reason}>
                <Select id="reason" name="reason" required defaultValue={state.values?.reason}>
                  <option value="">Choose a reason</option>
                  {RETURN_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </Select>
              </Field>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-[var(--text-primary)]">
                What is moving
              </legend>
              {state.fieldErrors?.lines && (
                <p className="text-xs text-critical">{state.fieldErrors.lines}</p>
              )}

              {lines.map((line, index) => (
                <div key={line.key} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <Select
                      name="productId"
                      aria-label={`Product ${index + 1}`}
                      value={line.productId}
                      onChange={(e) => setLine(line.key, { productId: e.target.value })}
                    >
                      <option value="">Choose a product</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </Select>
                  </div>
                  <Input
                    name="quantity"
                    aria-label={`Quantity for product ${index + 1}`}
                    inputMode="numeric" placeholder="Qty"
                    value={line.quantity}
                    onChange={(e) =>
                      setLine(line.key, { quantity: e.target.value.replace(/\D/g, "") })}
                    className="numeric w-24 shrink-0"
                  />
                  <button
                    type="button"
                    aria-label={`Remove product ${index + 1}`}
                    onClick={() =>
                      setLines((c) => (c.length === 1 ? c : c.filter((l) => l.key !== line.key)))}
                    className="grid size-11 shrink-0 place-items-center rounded-[var(--radius-panel)] border border-[var(--border-strong)] text-[var(--text-secondary)] pointer-fine:size-9.5"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              ))}

              <Button
                type="button" variant="outline" size="sm"
                onClick={() => {
                  setLines((c) => [...c, { key: `r${nextKey}`, productId: "", quantity: "" }]);
                  setNextKey((k) => k + 1);
                }}
              >
                <Plus className="size-3.5" aria-hidden />
                Add a product
              </Button>
            </fieldset>

            <Field label="Note" htmlFor="returnNotes" hint="What was actually wrong. Optional.">
              <Textarea id="returnNotes" name="notes" rows={2} defaultValue={state.values?.notes} />
            </Field>

            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1"
                      onClick={close} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" loading={pending}>
                Record it
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
