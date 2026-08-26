"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  createProductAction,
  updateProductAction,
  INITIAL_INVENTORY_STATE,
} from "./actions";
import type { CategoryOption, ProductDetail, WarehouseOption } from "./queries";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/states";

/**
 * Add Product, with the quantity on the same form.
 *
 * A new product almost always already exists in the store room, and the
 * only place to say how many there were used to be Stock Count. Stock
 * count means "what is physically here right now"; it is not where an
 * opening balance belongs. So Inventory is a section of this form, and
 * what it writes is an opening_stock movement - the same ledger every
 * other stock change goes through, not a quantity column.
 */
export function ProductForm({
  warehouses,
  categories,
  product,
}: {
  warehouses: WarehouseOption[];
  categories: CategoryOption[];
  product?: ProductDetail;
}) {
  const editing = Boolean(product);
  const [state, submit, pending] = useActionState(
    editing ? updateProductAction : createProductAction,
    INITIAL_INVENTORY_STATE,
  );

  const defaultWarehouse =
    warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id ?? "";

  return (
    <form action={submit} className="space-y-5">
      {product && <input type="hidden" name="productId" value={product.id} />}

      {state.status === "error" && <Alert tone="danger">{state.message}</Alert>}
      {state.status === "done" && <Alert tone="success">{state.message}</Alert>}

      <Card>
        <CardHeader title="Basic information" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Product name" required htmlFor="name">
              <Input
                id="name" name="name" required maxLength={120}
                defaultValue={product?.name}
                placeholder="Tomatoes"
                autoComplete="off"
              />
            </Field>
          </div>

          <Field
            label="SKU"
            required={!editing}
            htmlFor="sku"
            hint={editing ? "An SKU cannot change once stock has moved under it." : "Your own product code."}
          >
            <Input
              id="sku" name="sku" required={!editing} maxLength={40}
              defaultValue={product?.sku}
              disabled={editing}
              placeholder="TOM-001"
              autoComplete="off"
            />
          </Field>

          <Field label="Category" htmlFor="categoryId">
            <Select id="categoryId" name="categoryId" defaultValue={product?.categoryId ?? ""}>
              <option value="">Uncategorised</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>

          <Field label="Unit" htmlFor="unit" hint="What one unit is sold as.">
            <Input
              id="unit" name="unit" maxLength={24}
              defaultValue={product?.unit ?? "each"}
              placeholder="pieces"
            />
          </Field>

          <Field label="Units per case" htmlFor="unitsPerCase" hint="1 if it is not sold by the case.">
            <Input
              id="unitsPerCase" name="unitsPerCase" type="number" min={1} step={1}
              inputMode="numeric"
              defaultValue={product?.unitsPerCase ?? 1}
            />
          </Field>

          <Field label="Barcode" htmlFor="barcode">
            <Input id="barcode" name="barcode" maxLength={64} defaultValue={product?.barcode ?? ""} autoComplete="off" />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Description" htmlFor="description">
              <Textarea id="description" name="description" maxLength={500} defaultValue={product?.description ?? ""} />
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Pricing" description="Amounts in GHS." />
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <Field label="Selling price" htmlFor="listPrice" required>
            <Input
              id="listPrice" name="listPrice" type="number" min={0} step="0.01"
              inputMode="decimal" required
              defaultValue={product?.listPrice ?? ""}
              placeholder="10.00"
            />
          </Field>
          <Field label="Cost price" htmlFor="costPrice" hint="Used to value stock.">
            <Input
              id="costPrice" name="costPrice" type="number" min={0} step="0.01"
              inputMode="decimal"
              defaultValue={product?.costPrice ?? ""}
              placeholder="6.00"
            />
          </Field>
          <Field label="Tax rate %" htmlFor="taxRate">
            <Input
              id="taxRate" name="taxRate" type="number" min={0} max={100} step="0.01"
              inputMode="decimal"
              defaultValue={product?.taxRate ?? 0}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Inventory"
          description={
            editing
              ? "Stock is changed from the product page, so the history stays intact."
              : "How much of this you already have, and where it is."
          }
        />
        <CardBody className="grid gap-4 sm:grid-cols-3">
          {!editing && (
            <>
              <Field label="Warehouse" htmlFor="warehouseId" hint="Where the opening stock is held.">
                <Select id="warehouseId" name="warehouseId" defaultValue={defaultWarehouse}>
                  <option value="">No stock yet</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Initial stock quantity"
                htmlFor="openingQty"
                hint="Recorded as opening stock, not as a correction."
              >
                <Input
                  id="openingQty" name="openingQty" type="number" min={0} step={1}
                  inputMode="numeric" defaultValue={0} placeholder="50"
                />
              </Field>
            </>
          )}

          <Field
            label="Low stock threshold"
            htmlFor="reorderPoint"
            hint="Below this the product joins the reorder queue."
          >
            <Input
              id="reorderPoint" name="reorderPoint" type="number" min={0} step={1}
              inputMode="numeric" defaultValue={product?.reorderPoint ?? 0}
            />
          </Field>

          <Field label="Reorder quantity" htmlFor="reorderQty" hint="Suggested amount to buy.">
            <Input
              id="reorderQty" name="reorderQty" type="number" min={0} step={1}
              inputMode="numeric" defaultValue={product?.reorderQty ?? 0}
            />
          </Field>

          {editing && (
            <div className="flex items-center gap-2 self-end pb-2">
              <input
                id="isActive" name="isActive" type="checkbox"
                defaultChecked={product?.isActive}
                className="size-4 rounded border-[var(--border-strong)]"
              />
              <label htmlFor="isActive" className="text-sm text-[var(--text-primary)]">
                Active in the catalogue
              </label>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="lg" loading={pending}>
          {editing ? "Save changes" : "Create product"}
        </Button>
        <Link
          href={product ? `/products/${product.id}` : "/products"}
          className="inline-flex h-11 items-center rounded-[var(--radius-panel)] px-4 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
