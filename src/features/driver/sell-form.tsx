"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSync } from "./sync-provider";
import { CustomerPicker, type CachedCustomer } from "./customer-picker";
import { createCustomerAtCounterAction } from "./actions";
import { recordVanSaleAction } from "@/features/commercial/actions";
import { enqueue, refreshSnapshotInto } from "@/lib/offline/queue";
import { refreshSnapshot } from "@/lib/offline/sync";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { Card, CardBody } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatQuantity } from "@/lib/utils/format";
import { productImageUrl } from "@/lib/catalogue/image";
import type { OfflineSnapshot } from "@/lib/offline/queue";
import {
  Minus, Plus, PackageX, Search, Check, Banknote, CreditCard, ShoppingCart,
  Smartphone, Split,
} from "lucide-react";

/**
 * Selling from the van.
 *
 * A till, not a form. The driver picks who is buying, taps quantities
 * up and down against what is physically on board, sees the total grow,
 * and chooses cash or credit. Nothing else is on the screen.
 *
 * Everything is drawn from the cached round, so it behaves identically
 * with and without a signal, and the sale is queued either way. What the
 * customer is actually charged is computed by the database from the
 * same lines - the arithmetic here is for the driver's eyes.
 *
 * No cost price appears, and none is fetched: the snapshot the device
 * caches does not contain one.
 */

/**
 * The mobile money networks, for the till.
 *
 * Held here rather than read from the database because the till has to
 * work with no signal, and this list changes about once a decade. The
 * database has the same list and refuses anything not on it, so the two
 * cannot silently disagree.
 */
const MOMO_PROVIDERS = [
  { code: "mtn", short: "MTN" },
  { code: "telecel", short: "Telecel" },
  { code: "airteltigo", short: "AirtelTigo" },
] as const;

type Stage = "cart" | "payment" | "done";
type Tender = "cash" | "momo" | "split" | "credit";

interface Completed {
  customerName: string;
  total: number;
  saleType: "cash" | "credit";
  queuedOffline: boolean;
  saleNumber?: string;
  /** In words, for the confirmation: "₵200 cash, ₵300 mobile money". */
  paidBy?: string;
}

export function SellForm({
  initial,
  /**
   * False where the database cannot record a payment breakdown. The till
   * then offers cash and credit only, as it did before methods existed -
   * rather than offering a button that would fail at the counter.
   */
  canRecordMethods = true,
}: {
  initial?: OfflineSnapshot | null;
  canRecordMethods?: boolean;
}) {
  const router = useRouter();
  const { snapshot: cached, online, refresh, sync } = useSync();

  // The server renders the round, and the cached copy takes over once
  // the device has one. That ordering matters: the till has to work on
  // the first paint, before any caching has happened, and it has to
  // keep working when the network is gone and the server cannot answer.
  const snapshot = cached ?? initial ?? null;

  const [customerId, setCustomerId] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState("");
  const [stage, setStage] = useState<Stage>("cart");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState<Completed | null>(null);
  // The split is held as two figures rather than a list: cash and
  // mobile money are the two a van actually takes, and asking a driver
  // to build a list of payment lines at a counter would be absurd.
  const [cashPart, setCashPart] = useState("");
  // What the customer actually handed over on a cash sale. Only used to
  // work out change: the payment recorded is always the sale total,
  // because the change goes back in their hand.
  const [cashGiven, setCashGiven] = useState("");
  const [momoRef, setMomoRef] = useState("");
  // Which network. MTN, Telecel and AirtelTigo number their transactions
  // independently, so the reference alone cannot be matched against a
  // statement.
  const [momoProvider, setMomoProvider] = useState("");
  // Null until they have chosen how the customer is paying.
  const [tender, setTender] = useState<Exclude<Tender, "credit"> | null>(null);
  const [creatingCustomer, startCreate] = useTransition();

  const stock = useMemo(() => snapshot?.stock ?? [], [snapshot]);
  const customers: CachedCustomer[] = useMemo(() => snapshot?.customers ?? [], [snapshot]);
  const priceBy = useMemo(
    () => new Map((snapshot?.prices ?? []).map((p) => [p.product_id, p])),
    [snapshot],
  );

  const customer = customers.find((c) => c.id === customerId);

  const lines = useMemo(
    () => stock
      .filter((s) => (quantities[s.product_id] ?? 0) > 0)
      .map((s) => ({
        product_id: s.product_id,
        name: s.name,
        quantity: quantities[s.product_id],
        unit_price: priceBy.get(s.product_id)?.unit_price ?? 0,
        tax_rate: priceBy.get(s.product_id)?.tax_rate ?? 0,
      })),
    [stock, quantities, priceBy],
  );

  const total = lines.reduce((sum, l) => sum + l.unit_price * l.quantity, 0);
  const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return stock;
    return stock.filter((s) =>
      s.name.toLowerCase().includes(q) || s.sku.toLowerCase().includes(q));
  }, [stock, query]);

  /**
   * The picture for a line, if the snapshot carried one.
   *
   * Comes from the same price list the till already holds, so it works
   * with no signal - the bucket is public precisely so this URL is
   * stable and cacheable.
   */
  const imageFor = (productId: string) =>
    productImageUrl(priceBy.get(productId)?.image_path ?? null);

  const setQty = (productId: string, next: number, available: number) =>
    setQuantities((current) => ({
      ...current,
      [productId]: Math.max(0, Math.min(next, available)),
    }));

  // ---- no load, nothing to sell -------------------------------------
  if (!snapshot?.load) {
    return (
      <Card>
        <EmptyState
          icon={PackageX}
          title="Nothing loaded on your van"
          description={
            online
              ? "No load has been dispatched to your van, so there is nothing to sell yet."
              : "Your round was not cached before you lost signal. Reconnect once and it will be here."
          }
        />
      </Card>
    );
  }

  // ---- confirmation --------------------------------------------------
  if (stage === "done" && completed) {
    return (
      <Card>
        <CardBody className="space-y-5 text-center">
          <div className="mx-auto grid size-14 place-items-center rounded-full bg-positive-soft dark:bg-positive/15">
            <Check className="size-7 text-positive" aria-hidden />
          </div>
          <div>
            <p className="text-lg font-semibold text-[var(--text-primary)]">Sale completed</p>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{completed.customerName}</p>
            {completed.saleNumber && (
              <p className="numeric mt-1 text-xs text-[var(--text-muted)]">
                {completed.saleNumber}
              </p>
            )}
          </div>

          <div className="rounded-[var(--radius-panel)] bg-[var(--surface-sunken)] px-4 py-4">
            <p className="numeric text-3xl font-semibold text-[var(--text-primary)]">
              {formatMoney(completed.total)}
            </p>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              {completed.paidBy
                ? completed.paidBy.charAt(0).toUpperCase() + completed.paidBy.slice(1)
                : completed.saleType === "cash" ? "Paid in cash" : "On credit"}
            </p>
          </div>

          <Alert tone={completed.queuedOffline ? "warning" : "success"}>
            {completed.queuedOffline
              ? "Saved on this phone. It sends by itself when you have a signal."
              : "The office has it."}
          </Alert>

          <div className="space-y-2">
            <Button size="touch" onClick={() => {
              setCompleted(null); setStage("cart"); setCustomerId("");
              setQuantities({}); setNotes(""); setQuery("");
              setTender(null); setCashPart(""); setMomoRef("");
            }}>
              <ShoppingCart className="size-5" aria-hidden />
              Sell to another customer
            </Button>
            <Button size="touch" variant="outline" onClick={() => router.push("/driver")}>
              Back to my round
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  // ---- take payment --------------------------------------------------
  /**
   * What the driver actually collected, as the database wants it.
   *
   * Cash and mobile money only. A van does not take cheques, and
   * offering methods nobody uses is how a till gets slow.
   */
  function tenderFor(tender: Tender): {
    payment: {
      kind: Tender; cashPart?: number; reference?: string | null; provider?: string | null;
    };
    label: string;
  } | null {
    const reference = momoRef.trim() || null;
    const provider = momoProvider || null;

    if (tender === "cash") return { payment: { kind: "cash" }, label: "cash" };
    if (tender === "momo") {
      return { payment: { kind: "momo", reference, provider }, label: "mobile money" };
    }
    if (tender === "credit") return { payment: { kind: "credit" }, label: "on credit" };

    // A split has to be a split. Nothing in cash is a mobile money sale,
    // and everything in cash is a cash sale - both are a wrong button
    // rather than a payment the office should have to unpick later.
    const cash = Number(cashPart || 0);
    if (!Number.isFinite(cash) || cash <= 0) return null;
    if (cash >= total) return null;
    return {
      payment: { kind: "split", cashPart: cash, reference, provider },
      label: `${formatMoney(cash)} cash and ${formatMoney(total - cash)} on mobile money`,
    };
  }

  /** The two halves of a split, as the driver types the first one. */
  const splitCash = Number(cashPart || 0);
  const splitValid = Number.isFinite(splitCash) && splitCash > 0 && splitCash < total;
  const splitMomo = splitValid ? total - splitCash : 0;

  /** Change on a cash sale. Nothing owed is not change, it is exact. */
  const handedOver = Number(cashGiven || 0);
  const changeDue =
    Number.isFinite(handedOver) && handedOver > total ? handedOver - total : 0;

  async function complete(tender: Tender) {
    const saleType: "cash" | "credit" = tender === "credit" ? "credit" : "cash";
    setError(null);

    if (!customerId) { setError("Choose who is buying."); setStage("cart"); return; }
    if (!lines.length) { setError("Add something to the sale."); setStage("cart"); return; }

    for (const line of lines) {
      const held = stock.find((s) => s.product_id === line.product_id);
      if (!held || line.quantity > held.qty_on_hand) {
        setError(`Only ${held?.qty_on_hand ?? 0} of ${line.name} left on the van.`);
        setStage("cart");
        return;
      }
      if (!line.unit_price) {
        setError(`${line.name} has no price on this load. Ask the depot.`);
        setStage("cart");
        return;
      }
    }

    const tendered = tenderFor(tender);
    if (!tendered) {
      setError("Enter how much of it was paid in cash.");
      return;
    }

    if (saleType === "credit" && customer && total > customer.credit_available) {
      setError(
        `${customer.name} has ${formatMoney(customer.credit_available)} of credit left, ` +
        `and this sale is ${formatMoney(total)}. Take cash, or ask the office to raise their limit.`,
      );
      return;
    }

    const payloadLines = lines.map(({ product_id, quantity, unit_price, tax_rate }) =>
      ({ product_id, quantity, unit_price, tax_rate }));
    const summary =
      `${saleType === "cash" ? "Cash" : "Credit"} sale to ${customer?.name ?? "customer"} · ${formatMoney(total)}`;

    setBusy(true);
    try {
      if (online) {
        // With a signal the sale is made now, so the driver gets a real
        // sale number to read back to the customer rather than a promise
        // that it will go later.
        const result = await recordVanSaleAction({
          loadId: snapshot!.load!.id,
          customerId,
          saleType,
          notes: notes.trim() || null,
          lines: payloadLines,
          payment: tendered.payment,
        });

        if (!result.ok) {
          setError(result.message ?? "The sale could not be completed.");
          setStage("cart");
          return;
        }

        setCompleted({
          customerName: customer?.name ?? "the customer",
          total: result.total ?? total,
          saleType,
          queuedOffline: false,
          saleNumber: result.saleNumber,
          paidBy: result.paidBy ?? tendered.label,
        });
      } else {
        // No signal: queued, and applied exactly once when it uploads.
        await enqueue("van_sale", {
          load_id: snapshot!.load!.id,
          customer_id: customerId,
          sale_type: saleType,
          amount_paid: saleType === "cash" ? null : "0",
          notes: notes.trim() || null,
          lines: payloadLines,
          payment: tendered.payment,
        }, summary);

        setCompleted({
          customerName: customer?.name ?? "the customer",
          total,
          saleType,
          queuedOffline: true,
          paidBy: tendered.label,
        });
      }

      setStage("done");
      await refresh();
      if (online) void sync();
      router.refresh();
    } catch {
      setError("The sale could not be recorded. Try again in a moment.");
      setStage("cart");
    } finally {
      setBusy(false);
    }
  }

  async function addCustomer(fields: {
    name: string; phone: string; city: string; address: string;
  }): Promise<string | null> {
    if (!online) {
      setError("Adding a customer needs a signal. Sell to an existing customer for now.");
      return null;
    }
    return new Promise((resolve) => {
      startCreate(async () => {
        const result = await createCustomerAtCounterAction(fields);
        if (!result.ok || !result.id) {
          setError(result.message ?? "That customer could not be saved.");
          resolve(null);
          return;
        }
        // Pull the new customer into the cached round so the sale can
        // reference them, here and after a reload.
        const fresh = await refreshSnapshot();
        if (fresh) await refreshSnapshotInto(fresh);
        await refresh();
        resolve(result.id);
      });
    });
  }

  return (
    <div className="space-y-4 pb-40">
      {error && <Alert tone="danger">{error}</Alert>}
      {!online && (
        <Alert tone="warning" title="No signal">
          You can keep selling. Sales are saved here and sent when you reconnect.
        </Alert>
      )}

      {/* ---- who is buying --------------------------------------- */}
      <section>
        <h2 className="mb-2 text-[0.6875rem] font-medium tracking-wide text-[var(--text-muted)] uppercase">
          Customer
        </h2>
        <CustomerPicker
          customers={customers}
          selectedId={customerId}
          onSelect={(id) => { setCustomerId(id); setError(null); }}
          onCreate={addCustomer}
          creating={creatingCustomer}
        />
        {customer && (
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tone={customer.balance > 0 ? "caution" : "positive"}>
              Owes {formatMoney(customer.balance)}
            </Badge>
            <Badge tone="info">{formatMoney(customer.credit_available)} credit left</Badge>
          </div>
        )}
      </section>

      {/* ---- what is on the van ----------------------------------- */}
      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-[0.6875rem] font-medium tracking-wide text-[var(--text-muted)] uppercase">
            On my van
          </h2>
          <span className="numeric text-xs text-[var(--text-muted)]">
            {formatQuantity(stock.length)} products
          </span>
        </div>

        <div className="relative mb-3">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--text-muted)]"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a product"
            aria-label="Find a product on the van"
            className="h-14 pl-9 text-base"
          />
        </div>

        <ul className="space-y-2">
          {visible.length === 0 ? (
            <li className="rounded-[var(--radius-panel)] border border-[var(--border-subtle)] px-4 py-6 text-center text-sm text-[var(--text-secondary)]">
              Nothing on the van matches that.
            </li>
          ) : (
            visible.map((s) => {
              const qty = quantities[s.product_id] ?? 0;
              const price = priceBy.get(s.product_id)?.unit_price ?? 0;
              const soldOut = s.qty_on_hand <= 0;
              return (
                <li
                  key={s.product_id}
                  className={
                    "rounded-[var(--radius-panel)] border p-3 " +
                    (qty > 0
                      ? "border-brand-600 bg-brand-50/60 dark:bg-brand-950/40"
                      : "border-[var(--border-subtle)] bg-[var(--surface-raised)]")
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    {/* A picture where there is one. Half a wholesale
                        catalogue is "500ml", "1L", "Crate of 24" of
                        things that read alike and look nothing alike on
                        a shelf, and the wrong line picked in a hurry is
                        an argument at the next delivery. */}
                    {imageFor(s.product_id) && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={imageFor(s.product_id) as string}
                        alt=""
                        loading="lazy"
                        className="size-12 shrink-0 rounded-[var(--radius-panel)] border border-[var(--border-subtle)] object-cover"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                        {s.name}
                      </p>
                      <p className="numeric mt-0.5 text-xs text-[var(--text-secondary)]">
                        {formatMoney(price)} each · {formatQuantity(s.qty_on_hand)} left
                      </p>
                    </div>
                    {qty > 0 && (
                      <span className="numeric shrink-0 text-sm font-semibold text-[var(--text-primary)]">
                        {formatMoney(price * qty)}
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      aria-label={`One fewer ${s.name}`}
                      onClick={() => setQty(s.product_id, qty - 1, s.qty_on_hand)}
                      disabled={qty === 0}
                      className="grid size-14 shrink-0 place-items-center rounded-[var(--radius-panel)] border border-[var(--border-strong)] text-[var(--text-primary)] disabled:opacity-40"
                    >
                      <Minus className="size-5" aria-hidden />
                    </button>
                    <Input
                      aria-label={`Quantity of ${s.name}`}
                      inputMode="numeric"
                      value={qty === 0 ? "" : String(qty)}
                      placeholder="0"
                      onChange={(e) =>
                        setQty(s.product_id, Number(e.target.value.replace(/\D/g, "") || 0), s.qty_on_hand)
                      }
                      disabled={soldOut}
                      className="numeric h-14 flex-1 text-center text-lg"
                    />
                    <button
                      type="button"
                      aria-label={`One more ${s.name}`}
                      onClick={() => setQty(s.product_id, qty + 1, s.qty_on_hand)}
                      disabled={soldOut || qty >= s.qty_on_hand}
                      className="grid size-14 shrink-0 place-items-center rounded-[var(--radius-panel)] border border-[var(--border-strong)] text-[var(--text-primary)] disabled:opacity-40"
                    >
                      <Plus className="size-5" aria-hidden />
                    </button>
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </section>

      {lines.length > 0 && (
        <section>
          <h2 className="mb-2 text-[0.6875rem] font-medium tracking-wide text-[var(--text-muted)] uppercase">
            Note
          </h2>
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything worth recording about this sale"
            aria-label="Note about this sale"
          />
        </section>
      )}

      {/* ---- the running total, always in reach -------------------- */}
      <div className="fixed inset-x-0 bottom-16 z-20 border-t border-[var(--border-subtle)] bg-[var(--surface-raised)] px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:bottom-0">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-[var(--text-secondary)]">
              {itemCount === 0
                ? "Nothing added yet"
                : `${formatQuantity(itemCount)} ${itemCount === 1 ? "item" : "items"}`}
            </span>
            <span className="numeric text-2xl font-semibold text-[var(--text-primary)]">
              {formatMoney(total)}
            </span>
          </div>

          {stage === "cart" ? (
            <Button
              size="touch"
              className="mt-2"
              disabled={!customerId || lines.length === 0}
              onClick={() => { setError(null); setTender(null); setStage("payment"); }}
            >
              {!customerId ? "Choose a customer first"
                : lines.length === 0 ? "Add something to sell"
                : "Take payment"}
            </Button>
          ) : (
            <div className="mt-2 space-y-2">
              {tender === null ? (
                <>
                  {/* How they are paying. Cash and mobile money are what
                      a van actually takes; credit is a different kind of
                      answer and sits apart. */}
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      size="touch"
                      onClick={() => { setTender("cash"); setCashGiven(""); }}
                      disabled={busy}
                    >
                      <Banknote className="size-5" aria-hidden />
                      Cash
                    </Button>
                    {canRecordMethods ? (
                      <Button size="touch" onClick={() => setTender("momo")} disabled={busy}>
                        <Smartphone className="size-5" aria-hidden />
                        Mobile money
                      </Button>
                    ) : (
                      <Button
                        size="touch" variant="outline"
                        onClick={() => void complete("credit")}
                        loading={busy}
                      >
                        <CreditCard className="size-5" aria-hidden />
                        Credit
                      </Button>
                    )}
                  </div>
                  <div className={canRecordMethods ? "grid grid-cols-2 gap-2" : "hidden"}>
                    <Button
                      size="touch" variant="outline"
                      onClick={() => {
                        setTender("split");
                        setCashPart("");
                      }}
                      disabled={busy}
                    >
                      <Split className="size-5" aria-hidden />
                      Split
                    </Button>
                    <Button
                      size="touch" variant="outline"
                      onClick={() => void complete("credit")}
                      loading={busy}
                    >
                      <CreditCard className="size-5" aria-hidden />
                      Credit
                    </Button>
                  </div>
                </>
              ) : tender === "cash" ? (
                <div className="space-y-2">
                  {/* Optional. Most sales are settled with the exact
                      money, and making somebody type it every time would
                      slow the till down for the case that does not need
                      it. */}
                  <Input
                    aria-label="Cash handed over"
                    inputMode="decimal"
                    placeholder="Cash handed over (optional)"
                    value={cashGiven}
                    onChange={(e) => setCashGiven(e.target.value)}
                    className="numeric h-14 text-center text-base"
                  />

                  {changeDue > 0 ? (
                    <div className="rounded-[var(--radius-panel)] border border-positive/30 bg-positive-soft px-4 py-3 text-center dark:bg-positive/10">
                      <p className="text-xs font-medium uppercase tracking-wider text-positive">
                        Change to give back
                      </p>
                      <p className="numeric mt-0.5 text-3xl font-semibold text-positive">
                        {formatMoney(changeDue)}
                      </p>
                    </div>
                  ) : handedOver > 0 && handedOver < total ? (
                    <p className="numeric text-center text-sm text-caution">
                      That is {formatMoney(total - handedOver)} short of {formatMoney(total)}.
                      Take the balance, or record it as a credit sale.
                    </p>
                  ) : (
                    <p className="text-center text-xs text-[var(--text-secondary)]">
                      Leave it blank if they gave the exact money.
                    </p>
                  )}

                  <Button
                    size="touch"
                    onClick={() => void complete("cash")}
                    loading={busy}
                    disabled={handedOver > 0 && handedOver < total}
                  >
                    <Banknote className="size-5" aria-hidden />
                    Take {formatMoney(total)} in cash
                  </Button>
                </div>
              ) : tender === "momo" ? (
                <div className="space-y-2">
                  {/* Which network. Big buttons rather than a dropdown:
                      this is tapped standing up, and there are only
                      ever a handful. */}
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
                  <Input
                    aria-label="Mobile money reference"
                    placeholder="Momo transaction id (optional)"
                    value={momoRef}
                    onChange={(e) => setMomoRef(e.target.value)}
                    className="numeric h-14 text-base"
                  />
                  <Button size="touch" onClick={() => void complete("momo")} loading={busy}>
                    <Smartphone className="size-5" aria-hidden />
                    Take {formatMoney(total)} on mobile money
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Input
                    aria-label="Cash part"
                    inputMode="decimal" placeholder="How much in cash"
                    value={cashPart}
                    onChange={(e) => setCashPart(e.target.value)}
                    className="numeric h-14 text-base"
                  />
                  {/* Which network. Big buttons rather than a dropdown:
                      this is tapped standing up, and there are only
                      ever a handful. */}
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
                  <Input
                    aria-label="Mobile money reference"
                    placeholder="Momo transaction id (optional)"
                    value={momoRef}
                    onChange={(e) => setMomoRef(e.target.value)}
                    className="numeric h-14 text-base"
                  />
                  {/* Both halves, as they type. A driver standing at a
                      counter should not have to do the subtraction, and
                      the number they read out is the one the customer
                      sends. */}
                  {splitValid ? (
                    <div className="rounded-[var(--radius-panel)] bg-[var(--surface-sunken)] px-4 py-3">
                      <div className="flex items-baseline justify-between">
                        <span className="text-sm text-[var(--text-secondary)]">Cash</span>
                        <span className="numeric text-base font-semibold text-[var(--text-primary)]">
                          {formatMoney(splitCash)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-baseline justify-between">
                        <span className="text-sm text-[var(--text-secondary)]">Mobile money</span>
                        <span className="numeric text-base font-semibold text-[var(--text-primary)]">
                          {formatMoney(splitMomo)}
                        </span>
                      </div>
                      <div className="mt-2 flex items-baseline justify-between border-t border-[var(--border-subtle)] pt-2">
                        <span className="text-sm font-medium text-[var(--text-primary)]">Total</span>
                        <span className="numeric text-base font-semibold text-[var(--text-primary)]">
                          {formatMoney(total)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="numeric text-center text-xs text-caution">
                      {splitCash <= 0
                        ? `Enter how much of the ${formatMoney(total)} is being paid in cash.`
                        : `That is the whole ${formatMoney(total)}. Take it as a cash sale instead.`}
                    </p>
                  )}
                  <Button
                    size="touch"
                    onClick={() => void complete("split")}
                    loading={busy}
                    disabled={!splitValid}
                  >
                    Take {splitValid ? formatMoney(total) : "the payment"}
                  </Button>
                </div>
              )}

              <button
                type="button"
                onClick={() => { if (tender) setTender(null); else setStage("cart"); }}
                className="min-h-11 w-full text-sm text-[var(--text-secondary)]"
              >
                {tender ? "Choose another way to pay" : "Back to the cart"}
              </button>
            </div>
          )}
        </div>
      </div>

      <p className="text-center text-xs text-[var(--text-muted)]">
        Something wrong with your load?{" "}
        <Link href="/driver/stock" className="underline">Check your van stock</Link>
      </p>
    </div>
  );
}
