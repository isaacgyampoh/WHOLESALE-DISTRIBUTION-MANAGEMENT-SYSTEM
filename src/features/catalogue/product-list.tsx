"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { StockBadge } from "./stock-badge";
import { ProductForm } from "./product-form";
import { unitLabel } from "@/lib/catalogue/units";
import { formatMoney, formatQuantity } from "@/lib/utils/format";
import type { ProductRow, CategoryRow } from "./queries";
import { Plus, ChevronRight } from "lucide-react";

/** A table where there is a pointer, cards where there is a finger. */
export function ProductList({ products }: { products: ProductRow[] }) {
  return (
    <>
      <TableWrap className="hidden pointer-fine:block">
        <Table>
          <thead>
            <tr>
              <Th>Product</Th>
              <Th>Category</Th>
              <Th>Unit</Th>
              <Th numeric>Cost</Th>
              <Th numeric>Selling</Th>
              <Th numeric>Available</Th>
              <Th>Stock</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <Tr key={p.id}>
                <Td>
                  <Link
                    href={`/products/${p.id}`}
                    className="font-medium text-[var(--text-primary)] hover:text-brand-700 hover:underline dark:hover:text-brand-300"
                  >
                    {p.name}
                  </Link>
                  <span className="numeric block text-xs text-[var(--text-muted)]">{p.sku}</span>
                </Td>
                <Td>{p.categoryName ?? "-"}</Td>
                <Td>{unitLabel(p.unit)}</Td>
                <Td numeric>
                  {/* Null for a role that may not see cost. The database
                      decides; this only has to render the absence. */}
                  {p.costPrice === null
                    ? <span className="text-[var(--text-muted)]">-</span>
                    : formatMoney(p.costPrice)}
                </Td>
                <Td numeric>{formatMoney(p.listPrice)}</Td>
                <Td numeric>
                  {formatQuantity(p.available)}
                  {p.onHandPieces > 0 && (
                    <span className="ml-1 font-normal text-[var(--text-muted)]">
                      + {formatQuantity(p.onHandPieces)} loose
                    </span>
                  )}
                  {p.reserved > 0 && (
                    <span className="block text-xs text-[var(--text-muted)]">
                      {formatQuantity(p.reserved)} reserved
                    </span>
                  )}
                </Td>
                <Td><StockBadge state={p.state} /></Td>
                <Td>
                  {p.isActive
                    ? <Badge tone="neutral">Active</Badge>
                    : <Badge tone="critical">Inactive</Badge>}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      <ul className="space-y-2 pointer-fine:hidden">
        {products.map((p) => (
          <li key={p.id}>
            <Link
              href={`/products/${p.id}`}
              className="surface flex items-center gap-3 rounded-[var(--radius-panel)] border border-[var(--border-subtle)] p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-[var(--text-primary)]">{p.name}</p>
                <p className="numeric mt-0.5 text-xs text-[var(--text-muted)]">
                  {p.sku} · {p.categoryName ?? "No category"}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <StockBadge state={p.state} />
                  <span className="numeric text-xs text-[var(--text-secondary)]">
                    {formatQuantity(p.available)}
                  {p.onHandPieces > 0 && (
                    <span className="ml-1 font-normal text-[var(--text-muted)]">
                      + {formatQuantity(p.onHandPieces)} loose
                    </span>
                  )} {unitLabel(p.unit).toLowerCase()}
                  </span>
                  <span className="numeric text-xs font-medium text-[var(--text-primary)]">
                    {formatMoney(p.listPrice)}
                  </span>
                  {!p.isActive && <Badge tone="critical">Inactive</Badge>}
                </div>
              </div>
              <ChevronRight className="size-4 shrink-0 text-[var(--text-muted)]" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

export function CreateProductButton({
  categories,
  canTrackBatches = true,
  warehouses = [],
  canEnterStock = false,
}: {
  categories: CategoryRow[];
  canTrackBatches?: boolean;
  warehouses?: { id: string; name: string }[];
  canEnterStock?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Add product
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add product"
        description={canEnterStock && warehouses.length > 0
          ? "Say what is already on the shelf and it is recorded as opening stock."
          : "Stock is added separately, so every quantity has a reason recorded."}
        className="sm:max-w-lg"
      >
        <ProductForm categories={categories} canTrackBatches={canTrackBatches}
                     warehouses={warehouses} canEnterStock={canEnterStock}
                     onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}
