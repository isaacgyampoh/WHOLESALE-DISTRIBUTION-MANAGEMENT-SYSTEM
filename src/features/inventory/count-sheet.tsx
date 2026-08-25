"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyStockCountAction, type CountResult } from "./count-actions";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select, Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { Search, ClipboardCheck, Check } from "lucide-react";

export interface CountableProduct {
  id: string;
  sku: string;
  name: string;
  unit: string;
  /** What the system currently believes, at the chosen warehouse. */
  onHand: number;
}

export interface CountWarehouse {
  id: string;
  name: string;
}

/**
 * A counting sheet, as a person with a clipboard uses one.
 *
 * They walk the aisle and type what is on the shelf. Nothing is a
 * difference and nothing is a sign: the arithmetic is the system's job,
 * and doing it in your head beside a pallet is where miscounts come
 * from.
 *
 * Blank means "not counted" and is left alone. That distinction matters
 * more than it looks: a blank line and a zero are opposite claims - one
 * says "I did not get to this", the other says "there are none" - and
 * treating the first as the second would write off every product the
 * counter had not reached.
 */
export function CountSheet({
  warehouses,
  products,
  warehouseId,
}: {
  warehouses: CountWarehouse[];
  products: CountableProduct[];
  warehouseId: string;
}) {
  const router = useRouter();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("Stock count");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<CountResult | null>(null);
  const [pending, start] = useTransition();

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q),
    );
  }, [products, query]);

  // What will actually change, shown before anything is submitted: the
  // counter should see the consequence of the sheet while they can still
  // fix a fat-fingered digit.
  const pendingChanges = useMemo(() => {
    let changed = 0, up = 0, down = 0;
    for (const product of products) {
      const raw = counts[product.id];
      if (raw === undefined || raw.trim() === "") continue;
      const counted = Number(raw);
      if (!Number.isInteger(counted) || counted < 0) continue;
      const delta = counted - product.onHand;
      if (delta === 0) continue;
      changed++;
      if (delta > 0) up++; else down++;
    }
    return { changed, up, down };
  }, [counts, products]);

  const countedLines = Object.entries(counts)
    .filter(([, v]) => v.trim() !== "")
    .map(([productId, v]) => ({ productId, counted: Number(v) }));

  const submit = () => {
    start(async () => {
      const outcome = await applyStockCountAction({
        warehouseId,
        reason,
        lines: countedLines.filter((l) => Number.isInteger(l.counted) && l.counted >= 0),
      });
      setResult(outcome);
      if (outcome.ok) {
        setCounts({});
        router.refresh();
      }
    });
  };

  if (result?.ok) {
    return (
      <Card>
        <CardBody className="space-y-5 text-center">
          <div className="mx-auto grid size-14 place-items-center rounded-full bg-positive-soft dark:bg-positive/15">
            <Check className="size-7 text-positive" aria-hidden />
          </div>
          <div>
            <p className="text-lg font-semibold text-[var(--text-primary)]">
              {result.applied ? "Stock updated" : "Nothing to change"}
            </p>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              {result.applied
                ? `${result.applied} line${result.applied === 1 ? "" : "s"} adjusted` +
                  `${result.increased ? `, ${result.increased} up` : ""}` +
                  `${result.decreased ? `, ${result.decreased} down` : ""}` +
                  `${result.unchanged ? `, ${result.unchanged} already correct` : ""}.`
                : result.message}
            </p>
          </div>
          <div className="space-y-2">
            <Button size="lg" className="w-full" onClick={() => setResult(null)}>
              Count something else
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="w-full"
              onClick={() => router.push("/inventory")}
            >
              Back to inventory
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {result && !result.ok && <Alert tone="danger">{result.message}</Alert>}

      <Card>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Warehouse" htmlFor="warehouse">
            <Select
              id="warehouse"
              value={warehouseId}
              onChange={(e) => {
                // The levels shown belong to a warehouse, so changing it
                // reloads them rather than counting against the wrong
                // shelf.
                router.push(`/inventory/count?warehouse=${e.target.value}`);
              }}
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </Select>
          </Field>

          <Field
            label="Why"
            htmlFor="reason"
            required
            hint="Recorded against every line this changes."
          >
            <Input
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Opening stock, monthly count, damage…"
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-4">
          <Field label="Find a product" htmlFor="find">
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--text-muted)]"
                aria-hidden
              />
              <Input
                id="find"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name or SKU"
                className="pl-9"
              />
            </div>
          </Field>

          {visible.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--text-secondary)]">
              Nothing matches “{query}”.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {visible.map((product) => {
                const raw = counts[product.id] ?? "";
                const counted = raw.trim() === "" ? null : Number(raw);
                const delta =
                  counted !== null && Number.isInteger(counted) && counted >= 0
                    ? counted - product.onHand
                    : null;

                return (
                  <li key={product.id} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                        {product.name}
                      </p>
                      <p className="numeric text-xs text-[var(--text-muted)]">
                        {product.sku} · system holds {product.onHand} {product.unit}
                      </p>
                    </div>

                    {/* The consequence, beside the number that causes it. */}
                    {delta !== null && delta !== 0 && (
                      <Badge tone={delta > 0 ? "positive" : "caution"}>
                        {delta > 0 ? `+${delta}` : delta}
                      </Badge>
                    )}

                    <Input
                      aria-label={`Counted quantity for ${product.name}`}
                      value={raw}
                      onChange={(e) => {
                        const next = e.target.value.replace(/[^\d]/g, "");
                        setCounts((prev) => ({ ...prev, [product.id]: next }));
                      }}
                      inputMode="numeric"
                      placeholder="—"
                      className="numeric w-20 shrink-0 text-center"
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {/*
        Sticky, because the sheet is long and the person finishing an
        aisle should not have to scroll to the bottom to save what they
        counted.

        Held clear of the mobile navigation bar, which is fixed to the
        bottom of the screen on the same phone this is used on - at
        bottom-4 the save button sat underneath it and could not be
        pressed at all.
      */}
      <div className="sticky bottom-24 z-30 lg:bottom-4">
        <Card>
          <CardBody className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-[var(--text-secondary)]">
              {countedLines.length === 0
                ? "Type what is on the shelf. Blank lines are left alone."
                : `${countedLines.length} counted · ${pendingChanges.changed} will change` +
                  `${pendingChanges.up ? `, ${pendingChanges.up} up` : ""}` +
                  `${pendingChanges.down ? `, ${pendingChanges.down} down` : ""}`}
            </p>
            <Button
              onClick={submit}
              loading={pending}
              disabled={countedLines.length === 0 || !reason.trim()}
            >
              <ClipboardCheck className="size-4" aria-hidden />
              {pending ? "Saving…" : "Save the count"}
            </Button>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
