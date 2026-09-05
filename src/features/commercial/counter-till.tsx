"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordVanSaleAction } from "./actions";
import type { CounterProduct } from "./queries";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select, Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { Search, Check, Minus, Plus, Receipt } from "lucide-react";
import { formatMoney, formatQuantity } from "@/lib/utils/format";
import { formatHolding, holdsPieces } from "@/lib/catalogue/quantity";

export interface CounterCustomer { id: string; name: string; creditAvailable: number }

/**
 * The shop counter.
 *
 * Deliberately not the van till. That one caches a round so it can sell
 * with no signal; this one stands at a counter with the warehouse
 * behind it, so it reads the shelf and sells from it directly.
 *
 * What it shares is everything that decides money: a carton is charged
 * at the carton price and a single at the piece price, and a product
 * nobody has priced a single of cannot be sold by the piece at all.
 */
export function CounterTill({
  warehouses, warehouseId, products, customers, canSellOnCredit,
}: {
  warehouses: { id: string; name: string }[];
  warehouseId: string;
  products: CounterProduct[];
  customers: CounterCustomer[];
  canSellOnCredit: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [units, setUnits] = useState<Record<string, number>>({});
  const [pieces, setPieces] = useState<Record<string, number>>({});
  const [customerId, setCustomerId] = useState("");
  const [saleType, setSaleType] = useState<"cash" | "credit">("cash");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ saleNumber: string; total: number; saleId: string } | null>(null);
  const [pending, start] = useTransition();

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
  }, [products, query]);

  const lines = useMemo(() => products
    .filter((p) => (units[p.id] ?? 0) > 0 || (pieces[p.id] ?? 0) > 0)
    .map((p) => ({
      product: p,
      units: units[p.id] ?? 0,
      pieces: pieces[p.id] ?? 0,
      total: (units[p.id] ?? 0) * p.listPrice + (pieces[p.id] ?? 0) * (p.piecePrice ?? 0),
    })), [products, units, pieces]);

  const total = lines.reduce((s, l) => s + l.total, 0);
  const customer = customers.find((c) => c.id === customerId);

  const clamp = (n: number, max: number) => Math.max(0, Math.min(n, max));

  const submit = () => {
    setError(null);
    if (!lines.length) { setError("Add something to the sale."); return; }
    if (saleType === "credit" && !customerId) {
      setError("A credit sale needs a customer. Choose one, or take cash.");
      return;
    }
    if (saleType === "credit" && customer && total > customer.creditAvailable) {
      setError(
        `${customer.name} has ${formatMoney(customer.creditAvailable)} of credit left, ` +
        `and this sale is ${formatMoney(total)}.`);
      return;
    }

    start(async () => {
      const outcome = await recordVanSaleAction({
        warehouseId,
        customerId: customerId || null,
        saleType,
        lines: lines.map((l) => ({
          product_id: l.product.id,
          quantity: l.units,
          pieces: l.pieces,
          unit_price: l.product.listPrice,
          piece_price: l.product.piecePrice ?? 0,
          tax_rate: l.product.taxRate,
        })),
        payment: { kind: saleType === "credit" ? "credit" : "cash" },
      });

      if (!outcome.ok) { setError(outcome.message ?? "The sale could not be recorded."); return; }
      setDone({
        saleNumber: outcome.saleNumber ?? "",
        total: outcome.total ?? total,
        saleId: outcome.saleId ?? "",
      });
      setUnits({}); setPieces({}); setCustomerId(""); setSaleType("cash"); setQuery("");
      router.refresh();
    });
  };

  if (done) {
    return (
      <Card>
        <CardBody className="space-y-5 text-center">
          <div className="mx-auto grid size-14 place-items-center rounded-full bg-positive-soft dark:bg-positive/15">
            <Check className="size-7 text-positive" aria-hidden />
          </div>
          <div>
            <p className="text-lg font-semibold text-[var(--text-primary)]">{done.saleNumber}</p>
            <p className="numeric mt-1 text-2xl font-semibold text-[var(--text-primary)]">
              {formatMoney(done.total)}
            </p>
          </div>
          <div className="space-y-2">
            <Button size="touch" className="w-full" onClick={() => setDone(null)}>
              <Receipt className="size-5" aria-hidden />
              Serve the next customer
            </Button>
            {done.saleId && (
              <Button size="touch" variant="outline" className="w-full"
                      onClick={() => router.push(`/sales/${done.saleId}`)}>
                Open this sale
              </Button>
            )}
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}

      <Card>
        <CardBody className="space-y-4">
          {warehouses.length > 1 && (
            <Field label="Selling from" htmlFor="counterWarehouse">
              <Select
                id="counterWarehouse" value={warehouseId}
                onChange={(e) => router.push(`/sales/counter?warehouse=${e.target.value}`)}
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </Select>
            </Field>
          )}

          <Field label="Find a product" htmlFor="counterFind">
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--text-muted)]"
                aria-hidden
              />
              <Input
                id="counterFind" value={query} placeholder="Name or SKU"
                onChange={(e) => setQuery(e.target.value)} className="pl-9"
              />
            </div>
          </Field>

          {visible.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--text-secondary)]">
              {products.length === 0
                ? "There is nothing on this shelf to sell."
                : `Nothing matches “${query}”.`}
            </p>
          ) : (
            <ul className="space-y-2">
              {visible.map((p) => {
                const u = units[p.id] ?? 0;
                const pc = pieces[p.id] ?? 0;
                const splittable = holdsPieces(p.unit);
                // Nobody has priced a single, so there is no honest
                // figure to charge for one.
                const noPiecePrice = splittable && (p.piecePrice ?? 0) <= 0;
                const lineTotal = u * p.listPrice + pc * (p.piecePrice ?? 0);

                return (
                  <li key={p.id}
                      className={"rounded-[var(--radius-panel)] border p-3 " + (
                        u > 0 || pc > 0
                          ? "border-brand-600 bg-brand-50/60 dark:bg-brand-950/40"
                          : "border-[var(--border-subtle)] bg-[var(--surface-raised)]")}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                          {p.name}
                        </p>
                        <p className="numeric mt-0.5 text-xs text-[var(--text-secondary)]">
                          {p.sku} · {formatHolding(
                            { units: p.onHand, pieces: p.onHandPieces }, p.unit, { empty: "none" },
                          )} on the shelf
                        </p>
                      </div>
                      {lineTotal > 0 && (
                        <span className="numeric shrink-0 text-sm font-semibold text-[var(--text-primary)]">
                          {formatMoney(lineTotal)}
                        </span>
                      )}
                    </div>

                    <p className="mt-3 flex items-baseline justify-between text-xs font-medium text-[var(--text-secondary)]">
                      <span className="uppercase tracking-wide">{p.unit}{u === 1 ? "" : "s"}</span>
                      <span className="numeric">{formatMoney(p.listPrice)} each</span>
                    </p>
                    <Stepper
                      label={`${p.unit}s of ${p.name}`}
                      value={u} max={p.onHand}
                      onChange={(n) => setUnits((s) => ({ ...s, [p.id]: clamp(n, p.onHand) }))}
                    />

                    {splittable && (
                      <>
                        <p className="mt-3 flex items-baseline justify-between text-xs font-medium text-[var(--text-secondary)]">
                          <span className="uppercase tracking-wide">Piece{pc === 1 ? "" : "s"}</span>
                          <span className="numeric">
                            {noPiecePrice
                              ? "No price set - ask the office"
                              : `${formatMoney(p.piecePrice ?? 0)} each`}
                          </span>
                        </p>
                        {!noPiecePrice && (
                          <Stepper
                            label={`loose pieces of ${p.name}`}
                            value={pc} max={p.onHandPieces}
                            onChange={(n) =>
                              setPieces((s) => ({ ...s, [p.id]: clamp(n, p.onHandPieces) }))}
                          />
                        )}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {/*
        Sticky, because the list is long and whoever is serving should
        not scroll to the bottom to take the money. Held clear of the
        mobile navigation bar, as the stock count sheet is.
      */}
      <div className="sticky bottom-24 z-30 lg:bottom-4">
        <Card>
          <CardBody className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-[var(--text-secondary)]">
                {lines.length === 0
                  ? "Nothing added yet"
                  : `${formatQuantity(lines.length)} ${lines.length === 1 ? "line" : "lines"}`}
              </span>
              <span className="numeric text-2xl font-semibold text-[var(--text-primary)]">
                {formatMoney(total)}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Customer" htmlFor="counterCustomer"
                     hint={saleType === "credit" ? "Required for credit" : "Optional for cash"}>
                <Select id="counterCustomer" value={customerId}
                        onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">Walk-in customer</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Paying" htmlFor="counterType">
                <Select id="counterType" value={saleType}
                        onChange={(e) => setSaleType(e.target.value as "cash" | "credit")}>
                  <option value="cash">Cash now</option>
                  {canSellOnCredit && <option value="credit">On credit</option>}
                </Select>
              </Field>
            </div>

            <Button size="touch" className="w-full" onClick={submit}
                    loading={pending} disabled={lines.length === 0}>
              {pending ? "Recording…" : `Take ${formatMoney(total)}`}
            </Button>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

/** One quantity, with the thumbs a counter needs. */
function Stepper({
  label, value, max, onChange,
}: { label: string; value: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="mt-1 flex items-center gap-2">
      <button
        type="button" aria-label={`One fewer ${label}`}
        onClick={() => onChange(value - 1)} disabled={value === 0}
        className="grid size-14 shrink-0 place-items-center rounded-[var(--radius-panel)] border border-[var(--border-strong)] text-[var(--text-primary)] disabled:opacity-40"
      >
        <Minus className="size-5" aria-hidden />
      </button>
      <Input
        aria-label={label} inputMode="numeric" placeholder="0"
        value={value === 0 ? "" : String(value)}
        onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, "") || 0))}
        disabled={max <= 0}
        className="numeric h-14 flex-1 text-center text-lg"
      />
      <button
        type="button" aria-label={`One more ${label}`}
        onClick={() => onChange(value + 1)} disabled={value >= max}
        className="grid size-14 shrink-0 place-items-center rounded-[var(--radius-panel)] border border-[var(--border-strong)] text-[var(--text-primary)] disabled:opacity-40"
      >
        <Plus className="size-5" aria-hidden />
      </button>
    </div>
  );
}
