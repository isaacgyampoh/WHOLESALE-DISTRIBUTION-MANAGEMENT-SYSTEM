"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createProductAction, updateProductAction  } from "./actions";
import { INITIAL_CATALOGUE_STATE } from "@/features/catalogue/state";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea, Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { UNITS, unitLabel } from "@/lib/catalogue/units";
import type { ProductRow, CategoryRow } from "./queries";

/**
 * One form for creating and editing.
 *
 * Values typed by the person are echoed back when the server rejects
 * something, so a validation error never costs them the work. Stock is
 * absent on purpose: quantities move through an adjustment, which
 * records why.
 */
export function ProductForm({
  product,
  categories,
  onDone,
  /** False where the database has no batch columns to store the answer. */
  canTrackBatches = true,
  warehouses = [],
  canEnterStock = false,
}: {
  product?: ProductRow;
  categories: CategoryRow[];
  onDone?: () => void;
  canTrackBatches?: boolean;
  /** Somewhere to put the opening stock. Empty on the edit form. */
  warehouses?: { id: string; name: string }[];
  /** Whether this person may move stock, not merely add a product. */
  canEnterStock?: boolean;
}) {
  const router = useRouter();
  const [state, submit, pending] = useActionState(
    product ? updateProductAction : createProductAction,
    INITIAL_CATALOGUE_STATE,
  );

  // The chosen unit, held in state so every label that names it moves
  // with the dropdown: "Pieces per Carton", "Carton price". A form that
  // says "unit" throughout makes whoever is filling it in translate,
  // and the field they get wrong is the pack size.
  const [unit, setUnit] = useState(
    state.values?.unit ?? product?.unit ?? "piece",
  );
  const unitName = unit.charAt(0).toUpperCase() + unit.slice(1);
  // A product sold by the piece has no second unit to split into, so
  // the pack size and piece price have nothing to describe.
  const splittable = unit !== "piece";

  useEffect(() => {
    if (state.status !== "done") return;
    if (state.createdId) router.push(`/products/${state.createdId}`);
    else { router.refresh(); onDone?.(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, state.createdId]);

  const v = state.values;
  const err = state.fieldErrors ?? {};
  const active = categories.filter((c) => c.isActive || c.id === product?.categoryId);

  return (
    <form action={submit} className="space-y-4">
      {product && <input type="hidden" name="productId" value={product.id} />}
      {state.status === "error" && !Object.keys(err).length && (
        <Alert tone="danger">{state.message}</Alert>
      )}

      <Field label="Product name" htmlFor="name" required error={err.name}>
        <Input
          id="name" name="name" required autoComplete="off"
          defaultValue={v?.name ?? product?.name ?? ""}
          aria-invalid={Boolean(err.name)}
          placeholder="Sparkling Water 500ml"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Product code" htmlFor="sku" required error={err.sku}
          hint={product ? "A code cannot be changed once history refers to it." : undefined}
        >
          <Input
            id="sku" name="sku" required autoComplete="off"
            defaultValue={v?.sku ?? product?.sku ?? ""}
            readOnly={Boolean(product)}
            aria-invalid={Boolean(err.sku)}
            className={product ? "opacity-60" : undefined}
            placeholder="SKU-1001"
          />
        </Field>

        <Field label="Selling unit" htmlFor="unit" required error={err.unit}>
          <Select
            id="unit" name="unit" value={unit}
            onChange={(e) => setUnit(e.target.value)}
          >
            {UNITS.map((unit) => (
              <option key={unit} value={unit}>{unitLabel(unit)}</option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" htmlFor="categoryId" error={err.categoryId}>
          <Select
            id="categoryId" name="categoryId"
            defaultValue={v?.categoryId ?? product?.categoryId ?? ""}
          >
            <option value="">No category</option>
            {active.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.isActive ? "" : " (retired)"}
              </option>
            ))}
          </Select>
        </Field>

        {/*
          The pack size, and the only thing that makes loose pieces
          possible for this product.

          Left at 1, the product is only ever counted whole and the
          second quantity never appears on any screen for it - which is
          right for a bag of rice sold by the bag. Set to 12, a carton
          can be opened into twelve pieces and both can be sold.

          Nothing converts on this number alone: it is what an opening
          is measured in, not permission to treat a sealed carton as
          twelve loose pieces.
        */}
        {splittable && (
        <Field
          label={`Pieces per ${unit}`}
          htmlFor="piecesPerUnit" error={err.piecesPerUnit}
          hint={splittable
            ? `How many single pieces come out of one ${unit}. Leave at 1 if it is never split.`
            : "This product is sold by the piece, so there is nothing to split."}
        >
          <Input
            id="piecesPerUnit" name="piecesPerUnit" inputMode="numeric"
            defaultValue={v?.piecesPerUnit ?? String(product?.unitsPerCase ?? 1)}
            aria-invalid={Boolean(err.piecesPerUnit)}
            placeholder="1"
          />
        </Field>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Cost price" htmlFor="costPrice" required error={err.costPrice} hint="In cedis">
          <Input
            id="costPrice" name="costPrice" required inputMode="decimal"
            defaultValue={v?.costPrice ?? product?.costPrice?.toFixed(2) ?? ""}
            aria-invalid={Boolean(err.costPrice)}
            placeholder="42.00"
          />
        </Field>
        <Field
          label={`${unitName} price`} htmlFor="listPrice" required error={err.listPrice}
          hint={`In cedis, for one whole ${unit}`}
        >
          <Input
            id="listPrice" name="listPrice" required inputMode="decimal"
            defaultValue={v?.listPrice ?? product?.listPrice?.toFixed(2) ?? ""}
            aria-invalid={Boolean(err.listPrice)}
            placeholder="58.00"
          />
        </Field>
      </div>

      {/*
        What one loose piece sells for.
        
        Nothing derives this from the selling price. Dividing a carton by
        its pack size is always too low - wholesale exists because the
        carton is cheaper per piece than singles are - and a figure that
        looks like a price gets charged. Left blank, the product simply
        cannot be sold by the piece, and the till says so rather than
        inventing one.
      */}
      {splittable && (
      <Field
        label="Piece price" htmlFor="piecePrice" error={err.piecePrice}
        hint="In cedis. Leave blank and this product cannot be sold by the piece - nothing is worked out from the selling price."
      >
        <Input
          id="piecePrice" name="piecePrice" inputMode="decimal"
          defaultValue={v?.piecePrice ?? product?.piecePrice?.toFixed(2) ?? ""}
          aria-invalid={Boolean(err.piecePrice)}
          placeholder="6.00"
        />
      </Field>
      )}

      {/*
        Opening stock, on creation only.
        
        A business writing down a product it already has on the shelf
        should say how much in the same breath. Sending them to the
        stock count for it is asking them to reconcile a figure they
        have not entered yet - the count answers "what is actually
        there", which is a different question from "this is what we
        have".

        Absent when editing: changing stock later is an adjustment with
        a reason, which is the product page's job, not this form's.
      */}
      {!product && canEnterStock && warehouses.length > 0 && (
        <div className="rounded-[var(--radius-panel)] border border-[var(--border-subtle)] p-4">
          <p className="mb-3 text-sm font-medium text-[var(--text-primary)]">
            Opening stock
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label={splittable ? `${unitName}s` : "Pieces"}
              htmlFor="openingQty" error={err.openingQty}
              hint={splittable
                ? `Whole, unopened ${unit}s. Leave blank if none yet.`
                : "What is already on the shelf. Leave blank if none yet."}
            >
              <Input
                id="openingQty" name="openingQty" inputMode="numeric" placeholder="0"
                defaultValue={v?.openingQty ?? ""}
                aria-invalid={Boolean(err.openingQty)}
              />
            </Field>
            {/*
              Counted separately because it is separate. A shelf holding
              ten cartons and five loose pieces has both, and asking for
              one number forces whoever is standing there to either
              round or invent a conversion.
            */}
            {splittable && (
            <Field
              label="Loose pieces" htmlFor="openingPieces" error={err.openingPieces}
              hint="Singles already out of a carton. Leave blank if none."
            >
              <Input
                id="openingPieces" name="openingPieces" inputMode="numeric" placeholder="0"
                defaultValue={v?.openingPieces ?? ""}
                aria-invalid={Boolean(err.openingPieces)}
              />
            </Field>
            )}
            <Field
              label="Held at" htmlFor="openingWarehouseId" error={err.openingWarehouseId}
            >
              <Select
                id="openingWarehouseId" name="openingWarehouseId"
                defaultValue={v?.openingWarehouseId ?? warehouses[0]?.id ?? ""}
                aria-invalid={Boolean(err.openingWarehouseId)}
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Low stock threshold" htmlFor="reorderPoint" error={err.reorderPoint}
          hint="Flagged when available stock falls to this"
        >
          <Input
            id="reorderPoint" name="reorderPoint" inputMode="numeric"
            defaultValue={v?.reorderPoint ?? String(product?.reorderPoint ?? 0)}
            aria-invalid={Boolean(err.reorderPoint)}
          />
        </Field>
        <Field
          label="Suggested reorder quantity" htmlFor="reorderQty" error={err.reorderQty}
        >
          <Input
            id="reorderQty" name="reorderQty" inputMode="numeric"
            defaultValue={v?.reorderQty ?? String(product?.reorderQty ?? 0)}
            aria-invalid={Boolean(err.reorderQty)}
          />
        </Field>

        {/* Not everything expires. A crate does not, and forcing a date
            onto one would put a meaningless number in the warehouse's
            way at every delivery.

            Hidden entirely where the database cannot store the answer:
            a control that silently does nothing is worse than none. */}
        {canTrackBatches && <fieldset className="space-y-2 rounded-[var(--radius-panel)] border border-[var(--border-subtle)] p-3">
          <legend className="px-1 text-sm font-medium text-[var(--text-primary)]">
            Batches and shelf life
          </legend>

          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm">
            <input
              type="checkbox" name="trackBatches"
              defaultChecked={v?.trackBatches === "on" || product?.trackBatches}
              className="size-4 accent-[var(--color-brand-700)]"
            />
            <span>
              Track batch numbers
              <span className="block text-xs text-[var(--text-secondary)]">
                Recorded when goods are received.
              </span>
            </span>
          </label>

          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm">
            <input
              type="checkbox" name="trackExpiry"
              defaultChecked={v?.trackExpiry === "on" || product?.trackExpiry}
              className="size-4 accent-[var(--color-brand-700)]"
            />
            <span>
              This product expires
              <span className="block text-xs text-[var(--text-secondary)]">
                An expiry date is required at receiving, and a van will not
                be dispatched carrying it out of date.
              </span>
            </span>
          </label>

          <Field
            label="Shelf life in days" htmlFor="shelfLifeDays" error={err.shelfLifeDays}
            hint="Optional. Used to work out an expiry date when a delivery gives only a manufacture date."
          >
            <Input
              id="shelfLifeDays" name="shelfLifeDays" inputMode="numeric"
              defaultValue={v?.shelfLifeDays ?? (product?.shelfLifeDays ?? "")}
              aria-invalid={Boolean(err.shelfLifeDays)}
              className="numeric"
            />
          </Field>
        </fieldset>}
      </div>

      <Field label="Description" htmlFor="description">
        <Textarea
          id="description" name="description"
          defaultValue={v?.description ?? product?.description ?? ""}
          placeholder="Anything worth knowing when picking or selling this."
        />
      </Field>

      <Field label="Status" htmlFor="isActive">
        <Select
          id="isActive" name="isActive"
          defaultValue={v?.isActive ?? String(product?.isActive ?? true)}
        >
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </Select>
      </Field>

      <Button type="submit" size="lg" loading={pending} className="w-full">
        {product ? "Save changes" : "Create product"}
      </Button>
    </form>
  );
}
