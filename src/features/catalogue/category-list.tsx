"use client";

import { useState, useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { saveCategoryAction  } from "./actions";
import { INITIAL_CATALOGUE_STATE } from "@/features/catalogue/state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select, Textarea, Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { formatQuantity, formatMoney } from "@/lib/utils/format";
import type { CategoryRow } from "./queries";
import { Plus, Pencil } from "lucide-react";

/**
 * Categories decide what a scoped manager can reach, so retiring one is
 * offered and deleting one is not: products and their history refer to
 * it, and that history has to stay readable.
 */
export function CategoryList({
  categories,
  canManage,
}: {
  categories: CategoryRow[];
  canManage: boolean;
}) {
  const [editing, setEditing] = useState<CategoryRow | null>(null);

  return (
    <>
      <TableWrap className="hidden pointer-fine:block">
        <Table>
          <thead>
            <tr>
              <Th>Category</Th>
              <Th numeric>Products</Th>
              <Th numeric>Stock</Th>
              <Th numeric>Value</Th>
              <Th>Status</Th>
              {canManage && <Th numeric>Actions</Th>}
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <Tr key={category.id}>
                <Td>
                  {/* The name is the way in. It used to be plain text
                      with only the count beside it linking anywhere,
                      so the obvious thing to click did nothing. */}
                  <Link
                    href={`/products?category=${category.id}`}
                    className="block font-medium text-[var(--text-primary)] hover:text-brand-700 hover:underline dark:hover:text-brand-300"
                  >
                    {category.name}
                  </Link>
                  {category.description && (
                    <span className="text-xs text-[var(--text-muted)]">{category.description}</span>
                  )}
                </Td>
                <Td numeric>
                  {category.productCount > 0 ? (
                    <Link
                      href={`/products?category=${category.id}`}
                      className="numeric text-brand-700 hover:underline dark:text-brand-300"
                    >
                      {formatQuantity(category.productCount)}
                    </Link>
                  ) : (
                    <span className="numeric text-[var(--text-muted)]">0</span>
                  )}
                </Td>
                <Td numeric>
                  <span className={category.stockUnits === 0 ? "text-[var(--text-muted)]" : ""}>
                    {formatQuantity(category.stockUnits)}
                  </span>
                </Td>
                <Td numeric>
                  {/* Null is "not allowed to know", which is a different
                      thing from nothing, and shows as a dash. */}
                  {category.stockValue === null
                    ? <span className="text-[var(--text-muted)]">—</span>
                    : formatMoney(category.stockValue)}
                </Td>
                <Td>
                  {category.isActive
                    ? <Badge tone="neutral">Active</Badge>
                    : <Badge tone="critical">Retired</Badge>}
                </Td>
                {canManage && (
                  <Td numeric>
                    <Button size="sm" variant="outline" onClick={() => setEditing(category)}>
                      <Pencil className="size-3.5" />
                      Edit
                    </Button>
                  </Td>
                )}
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      <ul className="space-y-2 pointer-fine:hidden">
        {categories.map((category) => (
          <li
            key={category.id}
            className="surface rounded-[var(--radius-panel)] border border-[var(--border-subtle)] p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`/products?category=${category.id}`}
                  className="block truncate font-medium text-[var(--text-primary)] hover:text-brand-700 hover:underline dark:hover:text-brand-300"
                >
                  {category.name}
                </Link>
                <p className="numeric mt-0.5 text-xs text-[var(--text-muted)]">
                  {formatQuantity(category.productCount)} product{category.productCount === 1 ? "" : "s"}
                  {" · "}{formatQuantity(category.stockUnits)} in stock
                  {category.stockValue !== null ? ` · ${formatMoney(category.stockValue)}` : ""}
                </p>
              </div>
              {category.isActive
                ? <Badge tone="neutral">Active</Badge>
                : <Badge tone="critical">Retired</Badge>}
            </div>
            {canManage && (
              <Button
                size="sm" variant="outline" className="mt-3 w-full"
                onClick={() => setEditing(category)}
              >
                <Pencil className="size-3.5" />
                Edit
              </Button>
            )}
          </li>
        ))}
      </ul>

      <CategoryDialog
        category={editing}
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

export function CreateCategoryButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Add category
      </Button>
      <CategoryDialog category={null} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function CategoryDialog({
  category, open, onClose,
}: {
  category: CategoryRow | null;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, submit, pending] = useActionState(saveCategoryAction, INITIAL_CATALOGUE_STATE);
  const err = state.fieldErrors ?? {};

  useEffect(() => {
    if (state.status === "done") { router.refresh(); onClose(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={category ? `Edit ${category.name}` : "Add category"}
      description={
        category
          ? "Retiring a category keeps its products and their history."
          : "Categories group products and decide what a scoped manager can reach."
      }
    >
      <form action={submit} className="space-y-4">
        {category && <input type="hidden" name="categoryId" value={category.id} />}
        {state.status === "error" && !Object.keys(err).length && (
          <Alert tone="danger">{state.message}</Alert>
        )}

        <Field label="Category name" htmlFor="name" required error={err.name}>
          <Input
            id="name" name="name" required autoComplete="off"
            defaultValue={state.values?.name ?? category?.name ?? ""}
            aria-invalid={Boolean(err.name)}
            placeholder="Beverages"
          />
        </Field>

        <Field label="Description" htmlFor="description">
          <Textarea
            id="description" name="description"
            defaultValue={state.values?.description ?? category?.description ?? ""}
            placeholder="What belongs in this category."
          />
        </Field>

        <Field
          label="Status" htmlFor="isActive"
          hint={
            category && category.productCount > 0
              ? `${category.productCount} product${category.productCount === 1 ? "" : "s"} use this category. Retiring it leaves them untouched.`
              : undefined
          }
        >
          <Select
            id="isActive" name="isActive"
            defaultValue={state.values?.isActive ?? String(category?.isActive ?? true)}
          >
            <option value="true">Active</option>
            <option value="false">Retired</option>
          </Select>
        </Field>

        <Button type="submit" size="lg" loading={pending} className="w-full">
          {category ? "Save changes" : "Create category"}
        </Button>
      </form>
    </Dialog>
  );
}
