"use client";

import { useState } from "react";
import { useActionState } from "react";
import { adjustStockAction  } from "./actions";
import { INITIAL_CATALOGUE_STATE } from "@/features/catalogue/state";
import { ProductForm } from "./product-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select, Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import type { ProductRow, CategoryRow, WarehouseOption } from "./queries";
import { Pencil, Scale } from "lucide-react";

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

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {canEdit && (
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="size-4" />
            Edit product
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
    </>
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
          <div className="flex justify-between">
            <span className="text-[var(--text-muted)]">Currently on hand</span>
            <span className="numeric font-medium">{product.onHand}</span>
          </div>
          {product.reserved > 0 && (
            <div className="mt-1 flex justify-between">
              <span className="text-[var(--text-muted)]">Reserved</span>
              <span className="numeric font-medium">{product.reserved}</span>
            </div>
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

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Direction" htmlFor="direction" required>
                <Select id="direction" name="direction" defaultValue={state.values?.direction ?? "in"}>
                  <option value="in">Increase</option>
                  <option value="out">Decrease</option>
                </Select>
              </Field>
              <Field label="Quantity" htmlFor="quantity" required error={err.quantity}>
                <Input
                  id="quantity" name="quantity" inputMode="numeric" required
                  defaultValue={state.values?.quantity ?? ""}
                  aria-invalid={Boolean(err.quantity)}
                  placeholder="20"
                />
              </Field>
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
