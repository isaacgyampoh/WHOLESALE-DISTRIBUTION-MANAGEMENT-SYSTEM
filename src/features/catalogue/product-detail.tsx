"use client";

import { useState } from "react";
import { useActionState } from "react";
import { adjustStockAction, convertStockUnitsAction } from "./actions";
import { INITIAL_CATALOGUE_STATE } from "@/features/catalogue/state";
import { ProductForm } from "./product-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select, Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import type { ProductRow, CategoryRow, WarehouseOption } from "./queries";
import { formatHolding, formatPackSize, packSize } from "@/lib/catalogue/quantity";
import { Pencil, Scale, PackageOpen } from "lucide-react";

/**
 * The two things an administrator does to a product: change its details,
 * or change how much of it there is. They are deliberately separate, so
 * editing a price can never move stock.
 */
export function ProductActions({
  product, categories, warehouses, canEdit, canAdjust,
  /** False where the database has no batch columns to store the answer. */
  canTrackBatches = true,
}: {
  product: ProductRow;
  categories: CategoryRow[];
  warehouses: WarehouseOption[];
  canEdit: boolean;
  canAdjust: boolean;
  canTrackBatches?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [converting, setConverting] = useState(false);

  // Offered only where it means something. A product nobody has given a
  // pack size to has no pieces to open a unit into, and a button that
  // can only ever refuse is worse than no button.
  const splittable = packSize(product.unitsPerCase) !== null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {canEdit && (
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="size-4" />
            Edit product
          </Button>
        )}
        {canAdjust && splittable && (
          <Button variant="outline" onClick={() => setConverting(true)}>
            <PackageOpen className="size-4" />
            Open or pack up
          </Button>
        )}
        {canAdjust && (
          <Button onClick={() => setAdjusting(true)}>
            <Scale className="size-4" />
            Adjust stock
          </Button>
        )}
      </div>

      <Dialog
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit product"
        description="Changing these details does not move stock."
        className="sm:max-w-lg"
      >
        <ProductForm
          canTrackBatches={canTrackBatches}
          product={product}
          categories={categories}
          onDone={() => setEditing(false)}
        />
      </Dialog>

      <AdjustDialog
        open={adjusting}
        onClose={() => setAdjusting(false)}
        product={product}
        warehouses={warehouses}
      />

      <ConvertDialog
        open={converting}
        onClose={() => setConverting(false)}
        product={product}
        warehouses={warehouses}
      />
    </>
  );
}

/**
 * Opening a carton into pieces, or packing pieces back into a carton.
 *
 * Kept apart from the adjustment dialog on purpose. An adjustment says
 * the shelf held something different from what the system believed; this
 * says somebody physically changed the form the stock is in, and the
 * total is the same either side of it. Mixing them would let a mistake
 * in one be recorded as the other.
 */
function ConvertDialog({
  open, onClose, product, warehouses,
}: {
  open: boolean;
  onClose: () => void;
  product: ProductRow;
  warehouses: WarehouseOption[];
}) {
  const [state, submit, pending] = useActionState(convertStockUnitsAction, INITIAL_CATALOGUE_STATE);
  const [action, setAction] = useState("open");
  const err = state.fieldErrors ?? {};
  const preferred = warehouses.find((w) => w.isDefault) ?? warehouses[0];
  const pack = packSize(product.unitsPerCase) ?? 1;
  const held = { units: product.onHand, pieces: product.onHandPieces };

  if (state.status === "done") {
    return (
      <Dialog open={open} onClose={onClose} title={state.message ?? "Done"}>
        <div className="space-y-4">
          <Alert tone="success">
            Both halves are in the stock ledger, under one reference.
          </Alert>
          <Button variant="outline" className="w-full" onClick={onClose}>Done</Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Open or pack up ${product.name}`}
      description={`One ${product.unit} holds ${pack.toLocaleString()} pieces.`}
    >
      <form action={submit} className="space-y-4">
        <input type="hidden" name="productId" value={product.id} />

        {state.status === "error" && !Object.keys(err).length && (
          <Alert tone="danger">{state.message}</Alert>
        )}

        <div className="rounded-[var(--radius-panel)] bg-[var(--surface-sunken)] p-3 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-[var(--text-muted)]">Currently on hand</span>
            <span className="numeric font-medium text-right">
              {formatHolding(held, product.unit)}
            </span>
          </div>
        </div>

        {warehouses.length === 0 ? (
          <Alert tone="warning">
            There is no warehouse to change stock in. Create one first.
          </Alert>
        ) : (
          <>
            <Field label="Warehouse" htmlFor="convertWarehouseId" required error={err.warehouseId}>
              <Select
                id="convertWarehouseId" name="warehouseId"
                defaultValue={state.values?.warehouseId ?? preferred?.id}
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </Select>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="What is happening" htmlFor="action" required error={err.action}>
                <Select
                  id="action" name="action" value={action}
                  onChange={(e) => setAction(e.target.value)}
                >
                  <option value="open">Open into pieces</option>
                  <option value="pack">Pack pieces back up</option>
                </Select>
              </Field>
              <Field
                label={`How many ${product.unit}s`} htmlFor="units" required error={err.units}
                hint={action === "open"
                  ? `Becomes ${pack.toLocaleString()} pieces each`
                  : `Takes ${pack.toLocaleString()} pieces each`}
              >
                <Input
                  id="units" name="units" inputMode="numeric" required
                  defaultValue={state.values?.units ?? ""}
                  aria-invalid={Boolean(err.units)}
                  placeholder="1"
                />
              </Field>
            </div>

            <Field
              label="Reason" htmlFor="convertReason" required error={err.reason}
              hint="Recorded permanently against both movements."
            >
              <Input
                id="convertReason" name="reason" required autoComplete="off"
                defaultValue={state.values?.reason ?? ""}
                aria-invalid={Boolean(err.reason)}
                placeholder="Customer wants singles"
              />
            </Field>

            <Button type="submit" size="lg" loading={pending} className="w-full">
              {action === "open" ? "Open" : "Pack up"}
            </Button>
          </>
        )}
      </form>
    </Dialog>
  );
}

function AdjustDialog({
  open, onClose, product, warehouses,
}: {
  open: boolean;
  onClose: () => void;
  product: ProductRow;
  warehouses: WarehouseOption[];
}) {
  const [state, submit, pending] = useActionState(adjustStockAction, INITIAL_CATALOGUE_STATE);
  const err = state.fieldErrors ?? {};
  const preferred = warehouses.find((w) => w.isDefault) ?? warehouses[0];
  const pack = packSize(product.unitsPerCase);
  const held = { units: product.onHand, pieces: product.onHandPieces };

  if (state.status === "done") {
    return (
      <Dialog open={open} onClose={onClose} title="Stock adjusted">
        <div className="space-y-4">
          <Alert tone="success">
            The change is recorded in the stock ledger with the reason you gave.
          </Alert>
          <Button variant="outline" className="w-full" onClick={onClose}>Done</Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Adjust stock for ${product.name}`}
      description="Every change is written to the ledger and cannot be edited afterwards."
    >
      <form action={submit} className="space-y-4">
        <input type="hidden" name="productId" value={product.id} />

        {state.status === "error" && !Object.keys(err).length && (
          <Alert tone="danger">{state.message}</Alert>
        )}

        <div className="rounded-[var(--radius-panel)] bg-[var(--surface-sunken)] p-3 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-[var(--text-muted)]">Currently on hand</span>
            <span className="numeric font-medium text-right">
              {formatHolding(held, product.unit)}
            </span>
          </div>
          {product.reserved > 0 && (
            <div className="mt-1 flex justify-between">
              <span className="text-[var(--text-muted)]">Reserved</span>
              <span className="numeric font-medium">{product.reserved}</span>
            </div>
          )}
          {pack !== null && (
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              {formatPackSize(product.unit, product.unitsPerCase)}
            </p>
          )}
        </div>

        {warehouses.length === 0 ? (
          <Alert tone="warning">
            There is no warehouse to adjust stock in. Create one first.
          </Alert>
        ) : (
          <>
            <Field label="Warehouse" htmlFor="warehouseId" required error={err.warehouseId}>
              <Select
                id="warehouseId" name="warehouseId"
                defaultValue={state.values?.warehouseId ?? preferred?.id}
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </Select>
            </Field>

            <Field label="Direction" htmlFor="direction" required>
              <Select id="direction" name="direction" defaultValue={state.values?.direction ?? "in"}>
                <option value="in">Increase</option>
                <option value="out">Decrease</option>
              </Select>
            </Field>

            {/*
              Two boxes, because a shelf holds two things. The loose one
              appears only for products somebody has given a pack size -
              for a bag of rice sold whole there are no pieces to count
              and an empty box would just be a question with no answer.
            */}
            <div className={pack !== null ? "grid gap-4 sm:grid-cols-2" : undefined}>
              <Field
                label={pack !== null ? `Whole ${product.unit}s` : "Quantity"}
                htmlFor="quantity" error={err.quantity}
              >
                <Input
                  id="quantity" name="quantity" inputMode="numeric"
                  defaultValue={state.values?.quantity ?? ""}
                  aria-invalid={Boolean(err.quantity)}
                  placeholder="20"
                />
              </Field>
              {pack !== null && (
                <Field label="Loose pieces" htmlFor="pieces" error={err.pieces}>
                  <Input
                    id="pieces" name="pieces" inputMode="numeric"
                    defaultValue={state.values?.pieces ?? ""}
                    aria-invalid={Boolean(err.pieces)}
                    placeholder="0"
                  />
                </Field>
              )}
            </div>

            <Field
              label="Reason" htmlFor="reason" required error={err.reason}
              hint="Recorded permanently against this movement."
            >
              <Input
                id="reason" name="reason" required autoComplete="off"
                defaultValue={state.values?.reason ?? ""}
                aria-invalid={Boolean(err.reason)}
                placeholder="Stock count correction"
              />
            </Field>

            <Button type="submit" size="lg" loading={pending} className="w-full">
              Save adjustment
            </Button>
          </>
        )}
      </form>
    </Dialog>
  );
}
