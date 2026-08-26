"use client";

import { useActionState, useMemo, useState } from "react";
import { Minus, Plus, Search } from "lucide-react";
import { recordSaleAction, INITIAL_SALE_STATE } from "./actions";
import type { CustomerOption, SalesContext, SellableProduct } from "./queries";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Alert, EmptyState } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatQuantity } from "@/lib/utils/format";

/**
 * The sell screen.
 *
 * The list is what is physically at the seller's own location: their van
 * if they are crew on one, their shop counter otherwise. There is no van
 * picker, because choosing is not theirs to do - the server decides and
 * decides again when the sale is submitted.
 *
 * Quantities are capped at what is there. That cap is a courtesy: the
 * database refuses an oversell whatever this form sends.
 */
export function SellScreen({
  context,
  products,
  customers,
}: {
  context: SalesContext;
  products: SellableProduct[];
  customers: CustomerOption[];
}) {
  const [state, submit, pending] = useActionState(recordSaleAction, INITIAL_SALE_STATE);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [saleType, setSaleType] = useState<"cash" | "credit">("cash");
  const [customerId, setCustomerId] = useState("");

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return products;
    return products.filter(
      (p) => p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term),
    );
  }, [products, search]);

  const lines = useMemo(
    () =>
      Object.entries(cart)
        .filter(([, qty]) => qty > 0)
        .map(([productId, qty]) => {
          const product = products.find((p) => p.productId === productId)!;
          return { product, qty, total: product.unitPrice * qty * (1 + product.taxRate / 100) };
        }),
    [cart, products],
  );

  const total = lines.reduce((sum, l) => sum + l.total, 0);
  const customer = customers.find((c) => c.id === customerId);
  const overCredit =
    saleType === "credit" && customer !== undefined && total > customer.creditAvailable;

  const setQty = (product: SellableProduct, next: number) => {
    const clamped = Math.max(0, Math.min(next, product.available));
    setCart((c) => ({ ...c, [product.productId]: clamped }));
  };

  return (
    <form action={submit} className="grid gap-5 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-4">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--text-muted)]"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search what is on ${context.kind === "van" ? "the van" : "the counter"}`}
            aria-label="Search products"
            className="pl-9"
          />
        </div>

        {visible.length === 0 ? (
          <Card>
            <EmptyState
              title={products.length === 0 ? "Nothing to sell yet" : "Nothing matched that search"}
              description={
                products.length === 0
                  ? context.kind === "van"
                    ? "There is no stock on your van. A manager loads the van before the round."
                    : "There is no stock at your location yet."
                  : "Try a different name or code."
              }
            />
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {visible.map((p) => {
              const qty = cart[p.productId] ?? 0;
              return (
                <Card key={p.productId} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--text-primary)]">{p.name}</p>
                      <p className="text-xs text-[var(--text-muted)]">{p.sku}</p>
                    </div>
                    <Badge tone={p.available <= 5 ? "caution" : "neutral"}>
                      {formatQuantity(p.available)} left
                    </Badge>
                  </div>

                  <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">
                    {formatMoney(p.unitPrice)}
                    <span className="ml-1 text-xs font-normal text-[var(--text-muted)]">
                      per {p.unit}
                    </span>
                  </p>

                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      type="button" variant="outline" size="sm"
                      aria-label={`One fewer ${p.name}`}
                      onClick={() => setQty(p, qty - 1)}
                      disabled={qty === 0}
                    >
                      <Minus className="size-3.5" />
                    </Button>
                    <Input
                      name={`qty.${p.productId}`}
                      value={qty === 0 ? "" : String(qty)}
                      onChange={(e) => setQty(p, Math.trunc(Number(e.target.value || 0)))}
                      inputMode="numeric"
                      placeholder="0"
                      aria-label={`Quantity of ${p.name}`}
                      className="h-9 w-16 text-center"
                    />
                    <Button
                      type="button" variant="outline" size="sm"
                      aria-label={`One more ${p.name}`}
                      onClick={() => setQty(p, qty + 1)}
                      disabled={qty >= p.available}
                    >
                      <Plus className="size-3.5" />
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <Card>
          <CardHeader title="This sale" description={`Selling from ${context.locationName}.`} />
          <CardBody className="space-y-4">
            {state.status === "error" && <Alert tone="danger">{state.message}</Alert>}

            <Field label="Customer" required htmlFor="customerId">
              <Select
                id="customerId" name="customerId" required
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">Choose a customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>

            <Field label="Payment" htmlFor="saleType">
              <Select
                id="saleType" name="saleType"
                value={saleType}
                onChange={(e) => setSaleType(e.target.value === "credit" ? "credit" : "cash")}
              >
                <option value="cash">Cash or mobile money, paid now</option>
                <option value="credit">On credit</option>
              </Select>
            </Field>

            {saleType === "credit" && customer && (
              <Alert tone={overCredit ? "danger" : "info"}>
                {customer.name} owes {formatMoney(customer.outstanding)} of a{" "}
                {formatMoney(customer.creditLimit)} limit.{" "}
                {overCredit
                  ? "This sale is more than the credit left, and will be refused."
                  : `${formatMoney(customer.creditAvailable)} of credit remains.`}
              </Alert>
            )}

            {saleType === "credit" && (
              <Field label="Paid now" htmlFor="amountPaid" hint="Leave at zero for a full credit sale.">
                <Input
                  id="amountPaid" name="amountPaid" type="number" min={0} step="0.01"
                  inputMode="decimal" defaultValue={0}
                />
              </Field>
            )}

            {lines.length > 0 && (
              <ul className="space-y-1 border-t border-[var(--border-subtle)] pt-3 text-sm">
                {lines.map(({ product, qty, total: lineTotal }) => (
                  <li key={product.productId} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate text-[var(--text-secondary)]">
                      {qty} x {product.name}
                    </span>
                    <span className="numeric shrink-0">{formatMoney(lineTotal)}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-baseline justify-between border-t border-[var(--border-subtle)] pt-3">
              <span className="text-sm text-[var(--text-secondary)]">Total</span>
              <span className="numeric text-lg font-semibold text-[var(--text-primary)]">
                {formatMoney(total)}
              </span>
            </div>

            <Field label="Note" htmlFor="notes">
              <Textarea id="notes" name="notes" maxLength={200} rows={2} />
            </Field>

            <Button
              type="submit"
              size="touch"
              loading={pending}
              disabled={lines.length === 0 || !customerId}
            >
              Complete sale
            </Button>

            <p className="text-xs text-[var(--text-muted)]">
              The stock leaves {context.kind === "van" ? "your van" : "your counter"} and the
              receipt is produced as one step. If anything is refused, nothing is recorded.
            </p>
          </CardBody>
        </Card>
      </div>
    </form>
  );
}
