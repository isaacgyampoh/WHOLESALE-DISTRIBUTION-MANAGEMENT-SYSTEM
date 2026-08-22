"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSync } from "./sync-provider";
import { enqueue } from "@/lib/offline/queue";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Card, CardBody } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatQuantity } from "@/lib/utils/format";
import { Plus, Trash2, PackageX, Check } from "lucide-react";

/**
 * Selling from the van.
 *
 * Built against the cached snapshot, never a live query, so the form
 * behaves identically with and without a signal. The sale is queued
 * locally in both cases and uploaded by the sync engine; that is what
 * makes "the connection dropped mid-sale" a non-event rather than a
 * lost transaction.
 *
 * The arithmetic here is for the driver's eyes only. What the customer
 * is actually charged is computed by the database from the same lines,
 * so a rounding difference in a phone browser cannot change a total.
 */

interface Line {
  key: string;
  productId: string;
  quantity: string;
}

export function SellForm() {
  const router = useRouter();
  const { snapshot, online, refresh, sync } = useSync();
  const [customerId, setCustomerId] = useState("");
  const [saleType, setSaleType] = useState<"cash" | "credit">("cash");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ key: "l0", productId: "", quantity: "" }]);
  // Row keys come from a counter, not the clock: Date.now() is impure
  // in render, and two rows added in the same millisecond would collide.
  const nextKey = useRef(1);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const stock = useMemo(() => snapshot?.stock ?? [], [snapshot]);
  const customers = snapshot?.customers ?? [];
  const priceBy = useMemo(
    () => new Map((snapshot?.prices ?? []).map((p) => [p.product_id, p])),
    [snapshot],
  );
  const stockBy = useMemo(() => new Map(stock.map((s) => [s.product_id, s])), [stock]);
  const customer = customers.find((c) => c.id === customerId);

  const total = lines.reduce((sum, line) => {
    const price = priceBy.get(line.productId)?.unit_price ?? 0;
    const qty = Number(line.quantity || 0);
    return sum + price * qty;
  }, 0);

  const addLine = () =>
    setLines((current) => [
      ...current,
      { key: `l${nextKey.current++}`, productId: "", quantity: "" },
    ]);
  const setLine = (key: string, patch: Partial<Line>) =>
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const dropLine = (key: string) =>
    setLines((current) => (current.length === 1 ? current : current.filter((l) => l.key !== key)));

  if (!snapshot?.load) {
    return (
      <Card>
        <EmptyState
          icon={PackageX}
          title="No open load"
          description={
            online
              ? "You have no load dispatched to your van, so there is nothing to sell."
              : "No load was cached before you went offline. Reconnect once to load your round."
          }
        />
      </Card>
    );
  }

  async function submit() {
    setError(null);

    if (!customerId) { setError("Choose a customer."); return; }

    const chosen = lines
      .filter((l) => l.productId && Number(l.quantity) > 0)
      .map((l) => ({
        product_id: l.productId,
        quantity: Number(l.quantity),
        unit_price: priceBy.get(l.productId)?.unit_price ?? 0,
        tax_rate: priceBy.get(l.productId)?.tax_rate ?? 0,
      }));

    if (!chosen.length) { setError("Add at least one product."); return; }

    // Checked here so the driver is told at the counter rather than at
    // sync time. The database checks it again against real stock, which
    // is what actually decides.
    for (const line of chosen) {
      const held = stockBy.get(line.product_id);
      if (!held) { setError("One of those products is not on your van."); return; }
      if (line.quantity > held.qty_on_hand) {
        setError(`Only ${held.qty_on_hand} of ${held.name} left on the van.`);
        return;
      }
      if (!line.unit_price) {
        setError(`${held.name} has no price on this load.`);
        return;
      }
    }

    if (saleType === "credit" && customer && total > customer.credit_available) {
      setError(
        `${customer.name} has ${formatMoney(customer.credit_available)} of credit left; ` +
        `this sale is ${formatMoney(total)}.`,
      );
      return;
    }

    setBusy(true);
    try {
      await enqueue(
        "van_sale",
        {
          load_id: snapshot!.load!.id,
          customer_id: customerId,
          sale_type: saleType,
          amount_paid: saleType === "cash" ? null : "0",
          notes: notes || null,
          lines: chosen,
        },
        `${saleType === "cash" ? "Cash" : "Credit"} sale to ${customer?.name ?? "customer"} · ${formatMoney(total)}`,
      );

      setSaved(`${formatMoney(total)} recorded for ${customer?.name ?? "the customer"}.`);
      setCustomerId("");
      setNotes("");
      setLines([{ key: `l${nextKey.current++}`, productId: "", quantity: "" }]);
      await refresh();
      // Straight out if there is a signal; otherwise it waits in the
      // queue and the sync bar says so.
      if (online) void sync();
      router.refresh();
    } catch {
      setError("This device could not store the sale. Check your browser storage settings.");
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <Card>
        <CardBody className="space-y-4">
          <Alert tone="success" title="Sale recorded">
            {saved}{" "}
            {online ? "It is on its way to the office." : "It will send when you have a signal."}
          </Alert>
          <Button size="touch" onClick={() => setSaved(null)}>
            <Check className="size-5" aria-hidden />
            Sell to another customer
          </Button>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody className="space-y-5">
        {error && <Alert tone="danger">{error}</Alert>}
        {!online && (
          <Alert tone="warning" title="No signal">
            The sale is stored on this phone and sent when you reconnect.
          </Alert>
        )}

        <Field label="Customer" htmlFor="customerId" required>
          <Select
            id="customerId"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className="h-14 text-base"
          >
            <option value="">Choose a customer</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>

        {customer && (
          <div className="flex flex-wrap gap-2">
            <Badge tone={customer.balance > 0 ? "caution" : "positive"}>
              Owes {formatMoney(customer.balance)}
            </Badge>
            <Badge tone="info">{formatMoney(customer.credit_available)} credit left</Badge>
          </div>
        )}

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-[var(--text-primary)]">What they are buying</legend>
          {lines.map((line, index) => {
            const held = stockBy.get(line.productId);
            const price = priceBy.get(line.productId)?.unit_price ?? 0;
            return (
              <div key={line.key} className="space-y-2 rounded-[var(--radius-panel)] border border-[var(--border-subtle)] p-3">
                <Select
                  aria-label={`Product ${index + 1}`}
                  value={line.productId}
                  onChange={(e) => setLine(line.key, { productId: e.target.value })}
                  className="h-14 text-base"
                >
                  <option value="">Choose a product</option>
                  {stock.map((s) => (
                    <option key={s.product_id} value={s.product_id}>
                      {s.name} ({formatQuantity(s.qty_on_hand)} left)
                    </option>
                  ))}
                </Select>
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={`Quantity for product ${index + 1}`}
                    inputMode="numeric"
                    placeholder="Quantity"
                    value={line.quantity}
                    onChange={(e) => setLine(line.key, { quantity: e.target.value.replace(/\D/g, "") })}
                    className="h-14 flex-1 text-base"
                  />
                  <span className="numeric w-28 shrink-0 text-right text-sm text-[var(--text-secondary)]">
                    {price ? formatMoney(price * Number(line.quantity || 0)) : "-"}
                  </span>
                  <button
                    type="button"
                    onClick={() => dropLine(line.key)}
                    aria-label={`Remove product ${index + 1}`}
                    className="grid size-14 shrink-0 place-items-center rounded-[var(--radius-panel)] border border-[var(--border-strong)] text-[var(--text-secondary)]"
                  >
                    <Trash2 className="size-5" aria-hidden />
                  </button>
                </div>
                {held && (
                  <p className="numeric text-xs text-[var(--text-muted)]">
                    {formatMoney(price)} each · {formatQuantity(held.qty_on_hand)} on the van
                  </p>
                )}
              </div>
            );
          })}

          <Button type="button" variant="outline" size="touch" onClick={addLine}>
            <Plus className="size-5" aria-hidden />
            Add another product
          </Button>
        </fieldset>

        <div className="flex items-baseline justify-between rounded-[var(--radius-panel)] bg-[var(--surface-sunken)] px-4 py-3">
          <span className="text-sm font-medium text-[var(--text-secondary)]">Total</span>
          <span className="numeric text-2xl font-semibold text-[var(--text-primary)]">
            {formatMoney(total)}
          </span>
        </div>

        <Field label="How are they paying?" htmlFor="saleType" required>
          <div className="grid grid-cols-2 gap-2">
            {(["cash", "credit"] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setSaleType(type)}
                aria-pressed={saleType === type}
                className={
                  "h-14 rounded-[var(--radius-panel)] border text-base font-medium transition-colors " +
                  (saleType === type
                    ? "border-brand-700 bg-brand-50 text-brand-800 dark:bg-brand-950 dark:text-brand-200"
                    : "border-[var(--border-strong)] text-[var(--text-secondary)]")
                }
              >
                {type === "cash" ? "Cash now" : "On credit"}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Note" htmlFor="notes" hint="Optional.">
          <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <Button size="touch" onClick={() => void submit()} loading={busy}>
          Record sale
        </Button>
      </CardBody>
    </Card>
  );
}
