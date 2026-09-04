"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { topUpVanAction } from "./actions";
import type { LoadProduct } from "./load-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select, Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { PackagePlus, Plus, Trash2, Search } from "lucide-react";
import { formatQuantity, formatMoney } from "@/lib/utils/format";
import { holdsPieces } from "@/lib/catalogue/quantity";

interface Line { key: string; productId: string; quantity: string; pieces: string }

/**
 * Sending more stock to a van that is already out.
 *
 * The van keeps one open load for the week, so this adds to that load
 * rather than starting another - which is why there is no van or
 * warehouse to choose here. Both are already decided by the round in
 * progress, and offering them again would be two answers to a settled
 * question.
 */
export function TopUpVanButton({
  loadId, loadNumber, vanCode, warehouseId, warehouseName, products,
}: {
  loadId: string;
  loadNumber: string;
  vanCode: string;
  warehouseId: string;
  warehouseName: string | null;
  products: LoadProduct[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [nextKey, setNextKey] = useState(1);
  const [lines, setLines] = useState<Line[]>([
    { key: "t0", productId: "", quantity: "", pieces: "" },
  ]);
  const [result, setResult] =
    useState<{ ok: boolean; message?: string; lines?: number } | null>(null);
  const [pending, start] = useTransition();

  const productBy = useMemo(
    () => new Map(products.map((p) => [p.id, p])), [products]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
  }, [products, query]);

  const setLine = (key: string, patch: Partial<Line>) =>
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const payload = lines
    .filter((l) => l.productId && (Number(l.quantity || 0) > 0 || Number(l.pieces || 0) > 0))
    .map((l) => ({
      productId: l.productId,
      quantity: Number(l.quantity || 0),
      pieces: Number(l.pieces || 0),
    }));

  const close = () => {
    setOpen(false);
    setResult(null);
    setQuery("");
    setNote("");
    setLines([{ key: "t0", productId: "", quantity: "", pieces: "" }]);
  };

  const submit = () => {
    start(async () => {
      const outcome = await topUpVanAction({ loadId, note, lines: payload });
      setResult(outcome);
      if (outcome.ok) {
        setLines([{ key: "t0", productId: "", quantity: "", pieces: "" }]);
        setNote("");
        router.refresh();
      }
    });
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PackagePlus className="size-4" aria-hidden />
        Top up van
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title={`Send more stock to ${vanCode}`}
        description={`Added to ${loadNumber}, the round already out${
          warehouseName ? `, from ${warehouseName}` : ""}.`}
        className="sm:max-w-lg"
      >
        {result?.ok ? (
          <div className="space-y-4">
            <Alert tone="success" title="Sent">
              {formatQuantity(result.lines ?? 0)}{" "}
              {result.lines === 1 ? "product is" : "products are"} on their way to {vanCode}.
              The salesperson sees them as soon as their round syncs.
            </Alert>
            <Button variant="outline" className="w-full" onClick={close}>Done</Button>
          </div>
        ) : (
          <div className="space-y-4">
            {result && !result.ok && <Alert tone="danger">{result.message}</Alert>}

            <Field label="Find a product" htmlFor="topUpFind">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--text-muted)]"
                  aria-hidden
                />
                <Input
                  id="topUpFind" value={query} placeholder="Name or SKU"
                  onChange={(e) => setQuery(e.target.value)} className="pl-9"
                />
              </div>
            </Field>

            <div className="space-y-2">
              {lines.map((line, index) => {
                const product = productBy.get(line.productId);
                const here = product ? (product.availableBy[warehouseId] ?? 0) : null;
                const loose = product ? (product.piecesBy[warehouseId] ?? 0) : 0;
                const splittable = product ? holdsPieces(product.unit) : false;

                return (
                  /* Stacked on a phone: a picker and two number boxes do
                     not share a row at 375px. Same as the load form. */
                  <div key={line.key} className="flex flex-col gap-2 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1">
                      <Select
                        aria-label={`Product ${index + 1}`}
                        value={line.productId}
                        onChange={(e) => setLine(line.key, { productId: e.target.value })}
                      >
                        <option value="">Choose a product</option>
                        {((visible.some((v) => v.id === line.productId) || !line.productId)
                          ? visible
                          : [productBy.get(line.productId)!, ...visible]
                        ).map((p) => {
                          const stock = p.availableBy[warehouseId] ?? 0;
                          return (
                            <option key={p.id} value={p.id} disabled={stock === 0 && !(p.piecesBy[warehouseId] ?? 0)}>
                              {p.name}
                              {stock > 0 || (p.piecesBy[warehouseId] ?? 0) > 0
                                ? ` (${formatQuantity(stock)} available)`
                                : " (none at this warehouse)"}
                            </option>
                          );
                        })}
                      </Select>
                      {product && (
                        <p className="numeric mt-1 text-xs text-[var(--text-muted)]">
                          {formatMoney(product.listPrice)} each · {formatQuantity(here ?? 0)} here
                          {splittable ? ` · ${formatQuantity(loose)} loose` : ""}
                        </p>
                      )}
                    </div>
                    <div className="flex items-start gap-2">
                      <Input
                        aria-label={`Whole units for product ${index + 1}`}
                        inputMode="numeric" placeholder="Qty"
                        value={line.quantity}
                        onChange={(e) =>
                          setLine(line.key, { quantity: e.target.value.replace(/\D/g, "") })}
                        className="numeric w-24 shrink-0"
                      />
                      <Input
                        aria-label={`Loose pieces for product ${index + 1}`}
                        inputMode="numeric"
                        placeholder={splittable ? "Pieces" : "—"}
                        disabled={!splittable}
                        value={line.pieces}
                        onChange={(e) =>
                          setLine(line.key, { pieces: e.target.value.replace(/\D/g, "") })}
                        className="numeric w-24 shrink-0 disabled:opacity-40"
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
                  </div>
                );
              })}
              <Button
                type="button" variant="outline" size="sm"
                onClick={() => {
                  setLines((c) => [
                    ...c, { key: `t${nextKey}`, productId: "", quantity: "", pieces: "" },
                  ]);
                  setNextKey((k) => k + 1);
                }}
              >
                <Plus className="size-3.5" aria-hidden />
                Add a product
              </Button>
            </div>

            <Field
              label="Note" htmlFor="topUpNote" hint="Optional. Kept against every movement this writes."
            >
              <Input
                id="topUpNote" value={note} autoComplete="off"
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ran out of soap on the Kaneshie round"
              />
            </Field>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={close} disabled={pending}>
                Cancel
              </Button>
              <Button
                className="flex-1" onClick={submit}
                loading={pending} disabled={payload.length === 0}
              >
                Send to {vanCode}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
