"use client";

import { useActionState, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createLoadAction, dispatchLoadAction } from "./actions";
import { INITIAL_DISTRIBUTION_STATE } from "./state";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { formatQuantity, formatMoney } from "@/lib/utils/format";
import { Plus, Trash2, Truck, Send } from "lucide-react";

export interface LoadOption { id: string; label: string }
export interface LoadProduct {
  id: string; name: string; sku: string; listPrice: number;
  /** How many sit in each warehouse, keyed by warehouse id. */
  availableBy: Record<string, number>;
  /** Loose pieces in each warehouse, kept apart from the full units. */
  piecesBy: Record<string, number>;
  /** 1 means this product is never split, and has no loose half. */
  piecesPerUnit: number;
}

interface Line { key: string; productId: string; quantity: string; pieces: string }

/**
 * Building a load.
 *
 * The quantities entered here are a request, not a movement. Saving
 * writes the load and its lines; dispatching is what takes stock off the
 * warehouse, and that is done by the database. Stock available is shown
 * per line so a supervisor is not guessing what the warehouse can spare.
 */
export function CreateLoadButton({
  vans, drivers, warehouses, products,
}: {
  vans: LoadOption[];
  drivers: LoadOption[];
  warehouses: LoadOption[];
  products: LoadProduct[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(createLoadAction, INITIAL_DISTRIBUTION_STATE);
  const [lines, setLines] = useState<Line[]>([
    { key: "l0", productId: "", quantity: "", pieces: "" },
  ]);
  // Availability belongs to a warehouse. The load comes out of one of
  // them, and stock in another is no use to it - so the figures beside
  // each product follow this rather than summing every site.
  const [warehouseId, setWarehouseId] = useState("");
  // Sixty-eight products in a dropdown is a scroll, not a choice. Name
  // or code, the same two things the till searches on, so somebody who
  // uses both screens does not have to learn a second habit.
  const [query, setQuery] = useState("");
  const [nextKey, setNextKey] = useState(1);

  const productBy = new Map(products.map((p) => [p.id, p]));

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
  }, [products, query]);
  const value = lines.reduce((sum, line) => {
    const product = productBy.get(line.productId);
    return sum + (product?.listPrice ?? 0) * Number(line.quantity || 0);
  }, 0);

  const setLine = (key: string, patch: Partial<Line>) =>
    setLines((c) => c.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const close = () => {
    setOpen(false);
    if (state.status === "done") router.refresh();
  };

  const blocked = vans.length === 0 || drivers.length === 0 || products.length === 0;

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={blocked}>
        <Truck className="size-4" aria-hidden />
        Build a load
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title="Build a van load"
        description="Stock leaves the warehouse when the load is dispatched, not now."
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

            <Field label="Van" htmlFor="vanId" required error={state.fieldErrors?.vanId}>
              <Select id="vanId" name="vanId" required defaultValue={state.values?.vanId}>
                <option value="">Choose a van</option>
                {vans.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </Select>
            </Field>

            <Field label="Driver" htmlFor="driverId" required error={state.fieldErrors?.driverId}>
              <Select id="driverId" name="driverId" required defaultValue={state.values?.driverId}>
                <option value="">Choose a driver</option>
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </Select>
            </Field>

            <Field label="Loads from" htmlFor="warehouseId" required
                   error={state.fieldErrors?.warehouseId}>
              <Select id="warehouseId" name="warehouseId" required
                      value={warehouseId || (state.values?.warehouseId ?? "")}
                      onChange={(e) => setWarehouseId(e.target.value)}>
                <option value="">Choose a warehouse</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
              </Select>
            </Field>

            <Field label="Opening float" htmlFor="openingFloat"
                   hint="Change the driver sets off with."
                   error={state.fieldErrors?.openingFloat}>
              <Input id="openingFloat" name="openingFloat" inputMode="decimal"
                     placeholder="0.00" defaultValue={state.values?.openingFloat ?? "0"} />
            </Field>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-[var(--text-primary)]">
                What goes on the van
              </legend>
              {state.fieldErrors?.lines && (
                <p className="text-xs text-critical">{state.fieldErrors.lines}</p>
              )}

              {/*
                Narrows every dropdown below at once. The whole catalogue
                is in them - which is the point, and also why finding one
                line by scrolling is no way to build a load.
              */}
              <Input
                aria-label="Search products by name or code"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${products.length} products by name or code`}
              />
              {query.trim() !== "" && (
                <p className="text-xs text-[var(--text-muted)]">
                  {visible.length === 0
                    ? "Nothing matches that."
                    : `${visible.length} of ${products.length} shown`}
                </p>
              )}
              {lines.map((line, index) => {
                const product = productBy.get(line.productId);
                return (
                  <div key={line.key} className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <Select
                        name="productId"
                        aria-label={`Product ${index + 1}`}
                        value={line.productId}
                        onChange={(e) => setLine(line.key, { productId: e.target.value })}
                      >
                        <option value="">Choose a product</option>
                        {/*
                          Every active product, whether or not it has
                          stock here. The picker used to take page one of
                          the catalogue and then drop anything showing
                          none, so most of it was missing with nothing to
                          say why. A line with none in this warehouse now
                          says so and cannot be given a quantity.
                        */}
                        {/* Whatever the search left, plus whatever this
                            line already holds, so a chosen product never
                            vanishes from its own dropdown mid-edit. */}
                        {((visible.some((v: LoadProduct) => v.id === line.productId)
                          || !line.productId)
                          ? visible
                          : [productBy.get(line.productId)!, ...visible]
                        ).map((p: LoadProduct) => {
                          const here = warehouseId ? (p.availableBy[warehouseId] ?? 0) : null;
                          return (
                            <option key={p.id} value={p.id} disabled={here === 0}>
                              {p.name}
                              {here === null
                                ? ""
                                : here > 0
                                  ? ` (${formatQuantity(here)} available)`
                                  : " (none in this warehouse)"}
                            </option>
                          );
                        })}
                      </Select>
                      {product && (
                        <p className="numeric mt-1 text-xs text-[var(--text-muted)]">
                          {formatMoney(product.listPrice)} each
                          {warehouseId
                            ? ` · ${formatQuantity(product.availableBy[warehouseId] ?? 0)} here`
                            : ""}
                          {/*
                            The loose half, said separately. A depot with
                            forty cartons and no singles cannot fill a
                            request for singles, and the picker should
                            say so before the load is refused.
                          */}
                          {warehouseId && product.piecesPerUnit > 1
                            ? ` · ${formatQuantity(product.piecesBy[warehouseId] ?? 0)} loose`
                            : ""}
                        </p>
                      )}
                    </div>
                    <Input
                      name="qtyLoaded"
                      aria-label={`Whole units for product ${index + 1}`}
                      inputMode="numeric" placeholder="Qty"
                      value={line.quantity}
                      onChange={(e) => setLine(line.key, { quantity: e.target.value.replace(/\D/g, "") })}
                      className="numeric w-24 shrink-0"
                    />
                    {/*
                      The loose half, and only for products somebody has
                      given a pack size. The input is always rendered for
                      those so the parallel arrays the action reads stay
                      lined up with productId - a box hidden on some rows
                      and not others would shift every line below it.
                    */}
                    <Input
                      name="qtyLoadedPieces"
                      aria-label={`Loose pieces for product ${index + 1}`}
                      inputMode="numeric"
                      placeholder={product && product.piecesPerUnit > 1 ? "Pieces" : "—"}
                      disabled={!product || product.piecesPerUnit <= 1}
                      value={line.pieces}
                      onChange={(e) => setLine(line.key, { pieces: e.target.value.replace(/\D/g, "") })}
                      className="numeric w-24 shrink-0 disabled:opacity-40"
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
                );
              })}
              <Button
                type="button" variant="outline" size="sm"
                onClick={() => {
                  setLines((c) => [
                    ...c, { key: `l${nextKey}`, productId: "", quantity: "", pieces: "" },
                  ]);
                  setNextKey((k) => k + 1);
                }}
              >
                <Plus className="size-3.5" aria-hidden />
                Add a product
              </Button>
            </fieldset>

            <div className="flex items-baseline justify-between rounded-[var(--radius-panel)] bg-[var(--surface-sunken)] px-4 py-2.5">
              <span className="text-sm text-[var(--text-secondary)]">Value at selling price</span>
              <span className="numeric font-semibold text-[var(--text-primary)]">
                {formatMoney(value)}
              </span>
            </div>

            <Field label="Note" htmlFor="loadNotes" hint="Optional.">
              <Textarea id="loadNotes" name="notes" rows={2} defaultValue={state.values?.notes} />
            </Field>

            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1"
                      onClick={close} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" loading={pending}>
                Create load
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}

/**
 * Sending a load out.
 *
 * Confirmed rather than done on a single click: this is the point stock
 * leaves the warehouse, and it cannot be undone without a return.
 */
export function DispatchButton({ loadId, loadNumber }: { loadId: string; loadNumber: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(dispatchLoadAction, INITIAL_DISTRIBUTION_STATE);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Send className="size-3.5" aria-hidden />
        Dispatch
      </Button>

      <Dialog
        open={open}
        onClose={() => { setOpen(false); if (state.status === "done") router.refresh(); }}
        title={`Dispatch ${loadNumber}`}
        description="Stock moves from the warehouse onto the van."
      >
        {state.status === "done" ? (
          <div className="space-y-4">
            <Alert tone="success">{state.message}</Alert>
            <Button className="w-full" onClick={() => { setOpen(false); router.refresh(); }}>
              Done
            </Button>
          </div>
        ) : (
          <form action={formAction} className="space-y-4">
            {state.status === "error" && <Alert tone="danger">{state.message}</Alert>}
            <input type="hidden" name="loadId" value={loadId} />
            <Alert tone="warning" title="This moves stock">
              The quantities on this load leave the warehouse now. Bringing
              them back means recording a return.
            </Alert>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1"
                      onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" loading={pending}>
                Dispatch
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
