"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordVanSaleAction } from "./actions";
import type { CounterProduct } from "./queries";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select, Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { Check, Receipt } from "lucide-react";
import { formatMoney } from "@/lib/utils/format";
import { Dialog } from "@/components/ui/dialog";
import { PosSearch, PosRow, PosBar, PosRemove } from "./pos";
import { MOMO_PROVIDERS } from "@/lib/commercial/momo";

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
  // How they are paying, which is a different question from whether
  // this is a credit sale. Cash, mobile money, or some of each.
  const [tender, setTender] = useState<"cash" | "momo" | "split" | "credit">("cash");
  const [cashPart, setCashPart] = useState("");
  const [momoProvider, setMomoProvider] = useState("");
  const [momoRef, setMomoRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ saleNumber: string; total: number; saleId: string } | null>(null);
  const [settling, setSettling] = useState(false);
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

  const saleType: "cash" | "credit" = tender === "credit" ? "credit" : "cash";
  const takesMomo = tender === "momo" || tender === "split";
  const cashGiven = Number(cashPart || 0);

  const submit = () => {
    setError(null);
    if (!lines.length) { setError("Add something to the sale."); return; }
    if (saleType === "credit" && !customerId) {
      setError("A credit sale needs a customer. Choose one, or take cash.");
      return;
    }
    // A reference nobody can match against a statement is not a record
    // of anything, and the network is half of what makes it matchable:
    // the three of them number their transactions independently.
    if (takesMomo && !momoProvider) {
      setError("Which network was the mobile money on?");
      return;
    }
    if (tender === "split" && !(cashGiven > 0 && cashGiven < total)) {
      setError(
        `Enter how much of the ${formatMoney(total)} came in as cash - ` +
        `the rest is taken as mobile money.`);
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
        payment: {
          kind: tender,
          cashPart: tender === "split" ? cashGiven : undefined,
          provider: takesMomo ? momoProvider : null,
          reference: takesMomo ? (momoRef.trim() || null) : null,
        },
      });

      if (!outcome.ok) { setError(outcome.message ?? "The sale could not be recorded."); return; }
      setDone({
        saleNumber: outcome.saleNumber ?? "",
        total: outcome.total ?? total,
        saleId: outcome.saleId ?? "",
      });
      setUnits({}); setPieces({}); setCustomerId(""); setQuery("");
      setTender("cash"); setCashPart(""); setMomoProvider(""); setMomoRef("");
      setSettling(false);
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

      <Card className="p-0">
        <div className="px-5">
          <PosSearch
            value={query} onChange={setQuery}
            count={`${products.length} on the shelf`}
          />
        </div>
        {visible.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-[var(--text-secondary)]">
            {products.length === 0
              ? "There is nothing on this shelf to sell."
              : `Nothing matches “${query}”.`}
          </p>
        ) : (
          <ul>
            {visible.map((p) => (
              <PosRow
                key={p.id}
                item={{
                  id: p.id, name: p.name, sku: p.sku, unit: p.unit,
                  unitPrice: p.listPrice, piecePrice: p.piecePrice,
                  onHand: p.onHand, onHandPieces: p.onHandPieces,
                }}
                units={units[p.id] ?? 0}
                pieces={pieces[p.id] ?? 0}
                onUnits={(n) => setUnits((s) => ({ ...s, [p.id]: n }))}
                onPieces={(n) => setPieces((s) => ({ ...s, [p.id]: n }))}
              />
            ))}
          </ul>
        )}
      </Card>

      {/*
        The money, in one bar, with the basket folded into it.
        
        Payment lives in a sheet rather than beside the goods: at a
        counter you build the sale first and settle it once, and the two
        were competing for the same screen.
      */}
      <PosBar
        lines={lines.map((l) => ({
          id: l.product.id, name: l.product.name, unit: l.product.unit,
          units: l.units, pieces: l.pieces, total: l.total,
        }))}
        total={total}
        action={settling ? "Back" : "Charge"}
        onAction={() => setSettling((v) => !v)}
        disabled={lines.length === 0}
      >
        {(line) => (
          <PosRemove
            name={products.find((p) => p.id === line.id)?.name ?? "line"}
            onRemove={() => {
              setUnits((s) => ({ ...s, [line.id]: 0 }));
              setPieces((s) => ({ ...s, [line.id]: 0 }));
            }}
          />
        )}
      </PosBar>

      {/* Settling up. One question at a time, once the goods are in. */}
      <Dialog
        open={settling}
        onClose={() => setSettling(false)}
        title={`Take ${formatMoney(total)}`}
        description={`${lines.length} ${lines.length === 1 ? "item" : "items"} from ${
          warehouses.find((w) => w.id === warehouseId)?.name ?? "the shelf"}.`}
      >
        <div className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}

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
            <Select id="counterType" value={tender}
                    onChange={(e) => setTender(e.target.value as typeof tender)}>
              <option value="cash">Cash</option>
              <option value="momo">Mobile money</option>
              <option value="split">Part cash, part mobile money</option>
              {canSellOnCredit && <option value="credit">On credit</option>}
            </Select>
          </Field>

          {takesMomo && (
            <div className="space-y-3">
              {/*
                Which network. Buttons rather than a dropdown: this is
                tapped standing at a counter, and there are only ever a
                handful. The same three the van till offers.
              */}
              <div className="grid grid-cols-3 gap-2">
                {MOMO_PROVIDERS.map((p) => (
                  <button
                    key={p.code}
                    type="button"
                    onClick={() => setMomoProvider(p.code === momoProvider ? "" : p.code)}
                    aria-pressed={momoProvider === p.code}
                    className={`h-14 rounded-[var(--radius-panel)] border px-2 text-sm font-medium ${
                      momoProvider === p.code
                        ? "border-brand-700 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300"
                        : "border-[var(--border-strong)] text-[var(--text-secondary)]"
                    }`}
                  >
                    {p.short}
                  </button>
                ))}
              </div>

              {tender === "split" && (
                <Field label="Of that, taken in cash" htmlFor="counterCash"
                       hint={`The rest of ${formatMoney(total)} is the mobile money.`}>
                  <Input
                    id="counterCash" inputMode="decimal" value={cashPart}
                    onChange={(e) => setCashPart(e.target.value.replace(/[^\d.]/g, ""))}
                    placeholder="0.00" className="numeric h-14 text-lg"
                  />
                </Field>
              )}

              <Field label="Transaction reference" htmlFor="counterRef"
                     hint="Optional, but it is what matches this against the statement.">
                <Input
                  id="counterRef" value={momoRef} autoComplete="off"
                  onChange={(e) => setMomoRef(e.target.value)}
                  placeholder="e.g. 0123456789"
                />
              </Field>
            </div>
          )}

          <Button size="touch" className="w-full" onClick={submit} loading={pending}>
            {pending
              ? "Recording…"
              : tender === "credit"
                ? `Put ${formatMoney(total)} on account`
                : `Take ${formatMoney(total)}`}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
