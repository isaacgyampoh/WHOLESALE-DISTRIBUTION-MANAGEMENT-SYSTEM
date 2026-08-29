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
import { formatHolding, holdsPieces } from "@/lib/catalogue/quantity";

export interface CountableProduct {
  id: string;
  sku: string;
  name: string;
  unit: string;
  /** What the system currently believes, at the chosen warehouse. */
  onHand: number;
  /** Loose pieces the system believes are there, counted separately. */
  onHandPieces: number;
  /** How many pieces come out of one unit. 1 means it is never split. */
  piecesPerUnit: number;
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
/**
 * One line of the sheet, as it will be submitted - or null when nobody
 * has counted it.
 *
 * A line counts when either half has been typed. The other half is then
 * taken as zero, which is what a count means: the person walked up to
 * the shelf and this is what was on it. Leaving both blank leaves the
 * product alone entirely.
 *
 * Used by both the running preview and the submit, so what the counter
 * is promised and what is written can never drift apart.
 */
function readLine(
  entry: { units: string; pieces: string } | undefined,
  product: CountableProduct,
): { productId: string; counted: number; countedPieces?: number } | null {
  if (!entry) return null;

  const units = entry.units.trim();
  const pieces = entry.pieces.trim();
  if (units === "" && pieces === "") return null;

  const splittable = holdsPieces(product.unit);
  const counted = units === "" ? 0 : Number(units);
  if (!Number.isInteger(counted) || counted < 0) return null;

  if (!splittable) return { productId: product.id, counted };

  const countedPieces = pieces === "" ? 0 : Number(pieces);
  if (!Number.isInteger(countedPieces) || countedPieces < 0) return null;

  return { productId: product.id, counted, countedPieces };
}

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
  // Two figures per line, held as typed. A blank is not a zero: it
  // means nobody has counted that half yet, and the distinction has to
  // survive all the way to the submit.
  const [counts, setCounts] = useState<Record<string, { units: string; pieces: string }>>({});
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
      const line = readLine(counts[product.id], product);
      if (!line) continue;
      const unitDelta = line.counted - product.onHand;
      const pieceDelta = line.countedPieces === undefined
        ? 0 : line.countedPieces - product.onHandPieces;
      if (unitDelta === 0 && pieceDelta === 0) continue;
      changed++;
      if (unitDelta + pieceDelta > 0) up++; else down++;
    }
    return { changed, up, down };
  }, [counts, products]);

  const countedLines = products
    .map((product) => readLine(counts[product.id], product))
    .filter((line): line is NonNullable<typeof line> => line !== null);

  const submit = () => {
    start(async () => {
      const outcome = await applyStockCountAction({
        warehouseId,
        reason,
        lines: countedLines,
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
                const entry = counts[product.id] ?? { units: "", pieces: "" };
                const splittable = holdsPieces(product.unit);
                const line = readLine(entry, product);

                const unitDelta = line ? line.counted - product.onHand : 0;
                const pieceDelta = line && line.countedPieces !== undefined
                  ? line.countedPieces - product.onHandPieces
                  : 0;

                const type = (half: "units" | "pieces") => (value: string) =>
                  setCounts((prev) => ({
                    ...prev,
                    [product.id]: {
                      ...(prev[product.id] ?? { units: "", pieces: "" }),
                      [half]: value.replace(/[^\d]/g, ""),
                    },
                  }));

                return (
                  /*
                    Stacked on a phone, one row from sm up.
                    
                    Two count boxes, two delta badges and a product name
                    do not fit across 375px - the name is what gives way,
                    and a count sheet whose product names are three
                    characters wide is useless to the person holding it.
                  */
                  <li key={product.id}
                      className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                        {product.name}
                      </p>
                      <p className="numeric text-xs text-[var(--text-muted)]">
                        {product.sku} · system holds{" "}
                        {formatHolding(
                          { units: product.onHand, pieces: product.onHandPieces },
                          product.unit,
                          { empty: "none" },
                        )}
                      </p>
                    </div>

                    {/*
                      The consequence, beside the numbers that cause it,
                      and one badge per half. A shelf can be a carton
                      short and three pieces over at the same time -
                      somebody opened one - and a single combined figure
                      would hide exactly the discrepancy worth seeing.
                    */}
                    <div className="flex items-center gap-2 sm:gap-3">
                    <div className="flex flex-1 shrink-0 flex-col items-end gap-1 sm:flex-none">
                      {unitDelta !== 0 && (
                        <Badge tone={unitDelta > 0 ? "positive" : "caution"}>
                          {unitDelta > 0 ? `+${unitDelta}` : unitDelta} {product.unit}
                        </Badge>
                      )}
                      {pieceDelta !== 0 && (
                        <Badge tone={pieceDelta > 0 ? "positive" : "caution"}>
                          {pieceDelta > 0 ? `+${pieceDelta}` : pieceDelta} loose
                        </Badge>
                      )}
                    </div>

                    <Input
                      aria-label={splittable
                        ? `Whole ${product.unit}s counted for ${product.name}`
                        : `Counted quantity for ${product.name}`}
                      value={entry.units}
                      onChange={(e) => type("units")(e.target.value)}
                      inputMode="numeric"
                      placeholder="—"
                      className="numeric w-20 shrink-0 text-center"
                    />

                    {/*
                      Only for products somebody has given a pack size.
                      A second box on a bag of rice would be a question
                      with no possible answer.
                    */}
                    {splittable && (
                      <Input
                        aria-label={`Loose pieces counted for ${product.name}`}
                        value={entry.pieces}
                        onChange={(e) => type("pieces")(e.target.value)}
                        inputMode="numeric"
                        placeholder="—"
                        className="numeric w-20 shrink-0 text-center"
                      />
                    )}
                    </div>
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
