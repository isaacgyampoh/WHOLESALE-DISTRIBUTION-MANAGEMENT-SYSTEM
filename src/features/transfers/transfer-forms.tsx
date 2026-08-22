"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createTransferAction, approveTransferAction, dispatchTransferAction,
  receiveTransferAction, cancelTransferAction,
} from "./actions";
import { INITIAL_TRANSFER_STATE } from "./state";
import type { TransferLine } from "./queries";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { formatQuantity } from "@/lib/utils/format";
import { Plus, Trash2, ArrowLeftRight, Check, Send, PackageCheck, X } from "lucide-react";

interface Line { key: string; productId: string; quantity: string }

/**
 * Raising a transfer.
 *
 * Nothing here moves stock. Saving writes the request; a manager agrees
 * to it, and dispatching is what takes the goods off the source
 * warehouse. Keeping the three apart is the whole point of the feature.
 */
export function CreateTransferButton({
  warehouses,
  products,
}: {
  warehouses: { id: string; label: string }[];
  products: { id: string; name: string; sku: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(createTransferAction, INITIAL_TRANSFER_STATE);
  const [lines, setLines] = useState<Line[]>([{ key: "t0", productId: "", quantity: "" }]);
  const [nextKey, setNextKey] = useState(1);

  const setLine = (key: string, patch: Partial<Line>) =>
    setLines((c) => c.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const close = () => {
    setOpen(false);
    if (state.status === "done") router.refresh();
  };

  // Two depots are the minimum for the idea to mean anything.
  const blocked = warehouses.length < 2 || products.length === 0;

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={blocked}>
        <ArrowLeftRight className="size-4" aria-hidden />
        Raise a transfer
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title="Move stock between warehouses"
        description="The goods stay where they are until a manager approves this and it is dispatched."
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
            {blocked && (
              <Alert tone="warning">
                A transfer needs two warehouses and something to move between them.
              </Alert>
            )}

            <Field label="Leaves from" htmlFor="fromWarehouseId" required
                   error={state.fieldErrors?.fromWarehouseId}>
              <Select id="fromWarehouseId" name="fromWarehouseId" required
                      defaultValue={state.values?.fromWarehouseId}>
                <option value="">Choose a warehouse</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
              </Select>
            </Field>

            <Field label="Goes to" htmlFor="toWarehouseId" required
                   error={state.fieldErrors?.toWarehouseId}>
              <Select id="toWarehouseId" name="toWarehouseId" required
                      defaultValue={state.values?.toWarehouseId}>
                <option value="">Choose a warehouse</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
              </Select>
            </Field>

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
                        <option key={p.id} value={p.id}>{p.name}</option>
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
                  setLines((c) => [...c, { key: `t${nextKey}`, productId: "", quantity: "" }]);
                  setNextKey((k) => k + 1);
                }}
              >
                <Plus className="size-3.5" aria-hidden />
                Add a product
              </Button>
            </fieldset>

            <Field label="Note" htmlFor="transferNotes" hint="Optional.">
              <Textarea id="transferNotes" name="notes" rows={2}
                        defaultValue={state.values?.notes} />
            </Field>

            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1"
                      onClick={close} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" loading={pending}>
                Raise transfer
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}

/**
 * One dialog for the three steps that need nothing typed.
 *
 * Approving, dispatching and cancelling differ only in what they say and
 * which function they call, so they share a shape. Each is confirmed
 * rather than done on a single click: two of them move stock, and the
 * third cannot be undone.
 */
function ConfirmStep({
  transferId, transferNumber, action, trigger, icon, title, description,
  confirmLabel, variant = "primary", reason,
}: {
  transferId: string;
  transferNumber: string;
  action: (state: typeof INITIAL_TRANSFER_STATE, formData: FormData) => Promise<typeof INITIAL_TRANSFER_STATE>;
  trigger: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  variant?: "primary" | "secondary" | "danger" | "outline";
  /** Shown when the step needs a written explanation. */
  reason?: { label: string; hint: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, INITIAL_TRANSFER_STATE);

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

      <Dialog open={open} onClose={close} title={`${title} ${transferNumber}`}
              description={description}>
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
            <input type="hidden" name="transferId" value={transferId} />

            {reason && (
              <Field label={reason.label} htmlFor="reason" required hint={reason.hint}
                     error={state.fieldErrors?.reason}>
                <Input id="reason" name="reason" defaultValue={state.values?.reason} />
              </Field>
            )}

            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1"
                      onClick={close} disabled={pending}>
                Not now
              </Button>
              <Button type="submit" variant={variant} className="flex-1" loading={pending}>
                {confirmLabel}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}

export function ApproveTransferButton(props: { transferId: string; transferNumber: string }) {
  return (
    <ConfirmStep
      {...props}
      action={approveTransferAction}
      trigger="Approve"
      icon={<Check className="size-3.5" aria-hidden />}
      title="Approve"
      description="Agreeing the goods should move. The warehouse dispatches them after this."
      confirmLabel="Approve transfer"
    />
  );
}

export function DispatchTransferButton(props: { transferId: string; transferNumber: string }) {
  return (
    <ConfirmStep
      {...props}
      action={dispatchTransferAction}
      trigger="Dispatch"
      icon={<Send className="size-3.5" aria-hidden />}
      title="Dispatch"
      description="The stock leaves the source warehouse now and is in transit until it is received."
      confirmLabel="Dispatch transfer"
    />
  );
}

export function CancelTransferButton(props: { transferId: string; transferNumber: string }) {
  return (
    <ConfirmStep
      {...props}
      action={cancelTransferAction}
      trigger="Cancel"
      variant="outline"
      icon={<X className="size-3.5" aria-hidden />}
      title="Cancel"
      description="Only possible while the goods are still in the warehouse they started in."
      confirmLabel="Cancel transfer"
      reason={{
        label: "Why",
        hint: "A cancelled transfer with no reason is one nobody can explain later.",
      }}
    />
  );
}

/**
 * Booking a transfer in.
 *
 * Each line is pre-filled with what was sent, because that is usually
 * what turned up. Changing a figure is how a shortage gets recorded, and
 * the difference stays on the document rather than being absorbed into
 * the stock ledger as an unexplained correction.
 */
export function ReceiveTransferButton({
  transferId,
  transferNumber,
  lines,
}: {
  transferId: string;
  transferNumber: string;
  lines: TransferLine[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(receiveTransferAction, INITIAL_TRANSFER_STATE);
  const [counts, setCounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, String(l.quantity)])));

  const close = () => {
    setOpen(false);
    if (state.status === "done") router.refresh();
  };

  const short = lines.reduce(
    (sum, l) => sum + Math.max(0, l.quantity - Number(counts[l.id] || 0)), 0);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <PackageCheck className="size-3.5" aria-hidden />
        Receive
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title={`Receive ${transferNumber}`}
        description="Enter what you counted. Anything short stays on the transfer."
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
            <input type="hidden" name="transferId" value={transferId} />

            <ul className="space-y-2">
              {lines.map((line) => (
                <li key={line.id} className="flex items-center gap-3">
                  <input type="hidden" name="itemId" value={line.id} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-[var(--text-primary)]">
                      {line.productName}
                    </p>
                    <p className="numeric text-xs text-[var(--text-muted)]">
                      {formatQuantity(line.quantity)} {line.unit} sent
                    </p>
                  </div>
                  <Input
                    name="qtyReceived"
                    aria-label={`Counted for ${line.productName}`}
                    inputMode="numeric"
                    value={counts[line.id] ?? ""}
                    onChange={(e) =>
                      setCounts((c) => ({ ...c, [line.id]: e.target.value.replace(/\D/g, "") }))}
                    className="numeric w-24 shrink-0"
                  />
                </li>
              ))}
            </ul>

            {short > 0 && (
              <Alert tone="warning">
                {formatQuantity(short)} short of what was sent. That gap will stay on the
                transfer as a record of what never arrived.
              </Alert>
            )}

            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1"
                      onClick={close} disabled={pending}>
                Not now
              </Button>
              <Button type="submit" className="flex-1" loading={pending}>
                Book it in
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
