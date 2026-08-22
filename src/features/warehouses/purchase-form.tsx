"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createPurchaseOrderAction, submitPurchaseOrderAction,
  cancelPurchaseOrderAction, receivePurchaseOrderAction,
} from "./actions";
import { INITIAL_WAREHOUSE_STATE } from "./state";
import { ActionButton } from "@/components/ui/action-button";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { formatMoney, formatQuantity } from "@/lib/utils/format";
import { Plus, Trash2, Send, PackageCheck, X } from "lucide-react";
import type { PurchaseOrderRow } from "./queries";

export interface PurchaseOption { id: string; label: string }
export interface PurchaseProduct { id: string; name: string; sku: string; costPrice: number | null }

interface Line { key: string; productId: string; quantity: string; unitCost: string }

/**
 * Raising an order with a supplier.
 *
 * Nothing here touches stock. An order is a statement of what has been
 * asked for; the warehouse only gains anything when the goods are
 * received against it, and that is a separate, deliberate act.
 */
export function CreatePurchaseOrderButton({
  suppliers, warehouses, products,
}: {
  suppliers: PurchaseOption[];
  warehouses: PurchaseOption[];
  products: PurchaseProduct[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    createPurchaseOrderAction, INITIAL_WAREHOUSE_STATE,
  );
  const [lines, setLines] = useState<Line[]>([{ key: "l0", productId: "", quantity: "", unitCost: "" }]);
  const [nextKey, setNextKey] = useState(1);

  const productBy = new Map(products.map((p) => [p.id, p]));
  const total = lines.reduce((sum, line) => {
    const cost = Number(line.unitCost || productBy.get(line.productId)?.costPrice || 0);
    return sum + cost * Number(line.quantity || 0);
  }, 0);

  const setLine = (key: string, patch: Partial<Line>) =>
    setLines((c) => c.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const close = () => {
    setOpen(false);
    if (state.status === "done") router.refresh();
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={suppliers.length === 0 || products.length === 0}>
        <Plus className="size-4" aria-hidden />
        New order
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title="Raise a purchase order"
        description="Stock arrives when the goods are received, not now."
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

            <Field label="Supplier" htmlFor="supplierId" required
                   error={state.fieldErrors?.supplierId}>
              <Select id="supplierId" name="supplierId" required
                      defaultValue={state.values?.supplierId}>
                <option value="">Choose a supplier</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </Select>
            </Field>

            <Field label="Deliver to" htmlFor="warehouseId" required
                   error={state.fieldErrors?.warehouseId}>
              <Select id="warehouseId" name="warehouseId" required
                      defaultValue={state.values?.warehouseId}>
                <option value="">Choose a warehouse</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
              </Select>
            </Field>

            <Field label="Expected" htmlFor="expectedDate" hint="When it should arrive.">
              <Input id="expectedDate" name="expectedDate" type="date"
                     defaultValue={state.values?.expectedDate} />
            </Field>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-[var(--text-primary)]">
                What is being ordered
              </legend>
              {state.fieldErrors?.lines && (
                <p className="text-xs text-critical">{state.fieldErrors.lines}</p>
              )}
              {lines.map((line, index) => (
                <div key={line.key} className="flex items-start gap-2">
                  <Select
                    name="productId"
                    aria-label={`Product ${index + 1}`}
                    value={line.productId}
                    onChange={(e) => setLine(line.key, { productId: e.target.value })}
                    className="min-w-0 flex-1"
                  >
                    <option value="">Choose a product</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </Select>
                  <Input
                    name="quantity"
                    aria-label={`Quantity for product ${index + 1}`}
                    inputMode="numeric" placeholder="Qty"
                    value={line.quantity}
                    onChange={(e) => setLine(line.key, { quantity: e.target.value.replace(/\D/g, "") })}
                    className="numeric w-20 shrink-0"
                  />
                  <Input
                    name="unitCost"
                    aria-label={`Unit cost for product ${index + 1}`}
                    inputMode="decimal"
                    placeholder={
                      productBy.get(line.productId)
                        ? String(productBy.get(line.productId)!.costPrice ?? "")
                        : "Cost"
                    }
                    value={line.unitCost}
                    onChange={(e) => setLine(line.key, { unitCost: e.target.value })}
                    className="numeric w-24 shrink-0"
                  />
                  <button
                    type="button"
                    aria-label={`Remove product ${index + 1}`}
                    onClick={() => setLines((c) => (c.length === 1 ? c : c.filter((l) => l.key !== line.key)))}
                    className="grid size-11 shrink-0 place-items-center rounded-[var(--radius-panel)] border border-[var(--border-strong)] text-[var(--text-secondary)] pointer-fine:size-9.5"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              ))}
              <p className="text-xs text-[var(--text-muted)]">
                Leave the cost blank to use the product&rsquo;s own cost price.
              </p>
              <Button
                type="button" variant="outline" size="sm"
                onClick={() => {
                  setLines((c) => [...c, { key: `l${nextKey}`, productId: "", quantity: "", unitCost: "" }]);
                  setNextKey((k) => k + 1);
                }}
              >
                <Plus className="size-3.5" aria-hidden />
                Add a line
              </Button>
            </fieldset>

            <div className="flex items-baseline justify-between rounded-[var(--radius-panel)] bg-[var(--surface-sunken)] px-4 py-2.5">
              <span className="text-sm text-[var(--text-secondary)]">Order value</span>
              <span className="numeric font-semibold text-[var(--text-primary)]">
                {formatMoney(total)}
              </span>
            </div>

            <Field label="Note" htmlFor="poNotes" hint="Optional.">
              <Textarea id="poNotes" name="notes" rows={2} defaultValue={state.values?.notes} />
            </Field>

            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1"
                      onClick={close} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" loading={pending}>
                Create order
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}

export interface ReceivableLine {
  id: string;
  productName: string;
  sku: string;
  ordered: number;
  received: number;
}

/**
 * Booking goods in.
 *
 * Each line goes through the database function that posts the stock
 * movement, so a partial delivery is ordinary rather than a special
 * case: enter what actually turned up and the order stays open for the
 * rest.
 */
export function ReceiveButton({
  order, lines,
}: {
  order: PurchaseOrderRow;
  lines: ReceivableLine[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    receivePurchaseOrderAction, INITIAL_WAREHOUSE_STATE,
  );
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  const outstanding = lines.filter((l) => l.ordered > l.received);

  const close = () => {
    setOpen(false);
    if (state.status === "done") router.refresh();
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} disabled={outstanding.length === 0}>
        <PackageCheck className="size-3.5" aria-hidden />
        Receive
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title={`Receive against ${order.poNumber}`}
        description="Enter what actually arrived. Stock goes in through the ledger."
        className="sm:max-w-lg"
      >
        {state.status === "done" ? (
          <div className="space-y-4">
            <Alert tone="success">{state.message}</Alert>
            <Button className="w-full" onClick={close}>Done</Button>
          </div>
        ) : (
          <form action={formAction} className="space-y-4">
            {state.status === "error" && <Alert tone="danger">{state.message}</Alert>}
            <input type="hidden" name="id" value={order.id} />

            <div className="space-y-3">
              {outstanding.map((line) => (
                <div key={line.id}
                     className="space-y-2 rounded-[var(--radius-panel)] border border-[var(--border-subtle)] p-3">
                  <div>
                    <p className="text-sm font-medium text-[var(--text-primary)]">
                      {line.productName}
                    </p>
                    <p className="numeric text-xs text-[var(--text-muted)]">
                      {line.sku} · {formatQuantity(line.received)} of{" "}
                      {formatQuantity(line.ordered)} received
                    </p>
                  </div>
                  <input type="hidden" name="itemId" value={line.id} />
                  <div className="flex items-center gap-2">
                    <Input
                      name="qtyReceiving"
                      aria-label={`Quantity arriving for ${line.productName}`}
                      inputMode="numeric"
                      placeholder="0"
                      value={amounts[line.id] ?? ""}
                      onChange={(e) =>
                        setAmounts((c) => ({ ...c, [line.id]: e.target.value.replace(/\D/g, "") }))
                      }
                      className="numeric flex-1"
                    />
                    <Button
                      type="button" variant="outline" size="sm"
                      onClick={() =>
                        setAmounts((c) => ({ ...c, [line.id]: String(line.ordered - line.received) }))
                      }
                    >
                      All {formatQuantity(line.ordered - line.received)}
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1"
                      onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" loading={pending}>
                Receive into stock
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}

export function PurchaseOrderActions({
  order, lines,
}: {
  order: PurchaseOrderRow;
  lines: ReceivableLine[];
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {order.status === "draft" && (
        <ActionButton
          action={submitPurchaseOrderAction}
          fields={{ id: order.id }}
          label="Submit"
          title={`Submit ${order.poNumber}`}
          description="Marks it as sent to the supplier."
          icon={<Send className="size-3.5" aria-hidden />}
        />
      )}

      {order.status !== "received" && order.status !== "cancelled" && (
        <ReceiveButton order={order} lines={lines} />
      )}

      {order.status !== "received" && order.status !== "cancelled" && order.qtyReceived === 0 && (
        <ActionButton
          action={cancelPurchaseOrderAction}
          fields={{ id: order.id }}
          label="Cancel"
          title={`Cancel ${order.poNumber}`}
          description="Only possible while nothing has been received against it."
          variant="outline"
          icon={<X className="size-3.5" aria-hidden />}
        />
      )}
    </div>
  );
}
