"use client";

import { useActionState, useEffect, useState } from "react";
import { Plus, SlidersHorizontal } from "lucide-react";
import { addStockAction, adjustStockAction, INITIAL_INVENTORY_STATE } from "./actions";
import type { LocationStock, WarehouseOption } from "./queries";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { formatQuantity } from "@/lib/utils/format";

/**
 * Add stock and correct stock, for whoever is allowed to.
 *
 * "Edit stock" is what the screen offers, because that is how the job is
 * described. What it writes is a movement: adding posts a receipt,
 * correcting posts the difference as an adjustment carrying its reason.
 * The previous figure is never overwritten, so a correction from 50 to 45
 * can still be explained next month.
 */
export function StockControls({
  productId,
  productLabel,
  warehouses,
  locations,
}: {
  productId: string;
  productLabel: string;
  warehouses: WarehouseOption[];
  locations: LocationStock[];
}) {
  const [open, setOpen] = useState<"add" | "adjust" | null>(null);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => setOpen("add")}>
          <Plus className="size-3.5" />
          Add stock
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setOpen("adjust")}>
          <SlidersHorizontal className="size-3.5" />
          Adjust stock
        </Button>
      </div>

      <AddStockDialog
        open={open === "add"}
        onClose={() => setOpen(null)}
        productId={productId}
        productLabel={productLabel}
        warehouses={warehouses}
      />
      <AdjustStockDialog
        open={open === "adjust"}
        onClose={() => setOpen(null)}
        productId={productId}
        productLabel={productLabel}
        warehouses={warehouses}
        locations={locations}
      />
    </>
  );
}

function AddStockDialog({
  open, onClose, productId, productLabel, warehouses,
}: {
  open: boolean;
  onClose: () => void;
  productId: string;
  productLabel: string;
  warehouses: WarehouseOption[];
}) {
  const [state, submit, pending] = useActionState(addStockAction, INITIAL_INVENTORY_STATE);
  useCloseOnDone(state.status, open, onClose);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add stock"
      description="Goods arriving outside a purchase order."
    >
      <form action={submit} className="space-y-4">
        <input type="hidden" name="productId" value={productId} />
        <input type="hidden" name="productLabel" value={productLabel} />

        {state.status === "error" && <Alert tone="danger">{state.message}</Alert>}

        <Field label="Warehouse" required htmlFor="add-warehouse">
          <Select id="add-warehouse" name="warehouseId" required defaultValue={defaultWarehouseId(warehouses)}>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </Select>
        </Field>

        <Field label="Units to add" required htmlFor="add-qty">
          <Input
            id="add-qty" name="quantity" type="number" min={1} step={1}
            inputMode="numeric" required autoFocus
          />
        </Field>

        <Field label="Reason" htmlFor="add-reason" hint="Kept with the movement in the stock history.">
          <Textarea id="add-reason" name="reason" maxLength={200} placeholder="Delivery from supplier" />
        </Field>

        <div className="flex gap-2">
          <Button type="submit" loading={pending} className="flex-1">Add stock</Button>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}

function AdjustStockDialog({
  open, onClose, productId, productLabel, warehouses, locations,
}: {
  open: boolean;
  onClose: () => void;
  productId: string;
  productLabel: string;
  warehouses: WarehouseOption[];
  locations: LocationStock[];
}) {
  const [state, submit, pending] = useActionState(adjustStockAction, INITIAL_INVENTORY_STATE);
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId(warehouses));
  useCloseOnDone(state.status, open, onClose);

  const current = locations.find((l) => l.warehouseId === warehouseId);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Adjust stock"
      description="Correct the figure to what is actually there."
    >
      <form action={submit} className="space-y-4">
        <input type="hidden" name="productId" value={productId} />
        <input type="hidden" name="productLabel" value={productLabel} />

        {state.status === "error" && <Alert tone="danger">{state.message}</Alert>}

        <Field label="Warehouse" required htmlFor="adj-warehouse">
          <Select
            id="adj-warehouse" name="warehouseId" required
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </Select>
        </Field>

        <Field
          label="Correct quantity to"
          required
          htmlFor="adj-qty"
          hint={`The system currently says ${formatQuantity(current?.qtyOnHand ?? 0)}.`}
        >
          <Input
            id="adj-qty" name="newQuantity" type="number" min={0} step={1}
            inputMode="numeric" required
            defaultValue={current?.qtyOnHand ?? 0}
          />
        </Field>

        <Field
          label="Reason"
          required
          htmlFor="adj-reason"
          hint="An unexplained change to stock is refused, here and in the database."
        >
          <Textarea id="adj-reason" name="reason" required maxLength={200} placeholder="Recount after breakage" />
        </Field>

        <Alert tone="info">
          The old figure is kept. What is recorded is the difference, as an
          adjustment with your reason attached.
        </Alert>

        <div className="flex gap-2">
          <Button type="submit" loading={pending} className="flex-1">Save correction</Button>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}

function defaultWarehouseId(warehouses: WarehouseOption[]): string {
  return warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id ?? "";
}

/** Close once the server has confirmed; the page revalidates behind it. */
function useCloseOnDone(status: string, open: boolean, onClose: () => void) {
  useEffect(() => {
    if (open && status === "done") onClose();
  }, [status, open, onClose]);
}
