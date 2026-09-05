"use client";

import { useState } from "react";
import { Input } from "@/components/ui/field";
import { Minus, Plus, Search, ChevronUp, ChevronDown, Trash2 } from "lucide-react";
import { formatMoney } from "@/lib/utils/format";
import { formatHolding, holdsPieces } from "@/lib/catalogue/quantity";

/**
 * The parts both tills are built from.
 *
 * A till is one job done over and over: find the thing, add the thing,
 * see what is in the basket, take the money. Both screens had it laid
 * out as a form - a page title, a customer, a payment method, and only
 * then the goods - so on a phone you reached one product before running
 * out of screen, and the running total floated over the list you were
 * trying to read.
 *
 * The shape here is the other way round. The goods fill the screen, a
 * row stays small until you touch it, and the money lives in one bar at
 * the bottom that opens into the basket when you want to check it.
 */

export interface PosItem {
  id: string;
  name: string;
  sku: string;
  unit: string;
  unitPrice: number;
  /** Null where nobody has priced a single: pieces cannot be sold. */
  piecePrice: number | null;
  onHand: number;
  onHandPieces: number;
  /** Shown where the till has a picture, as the van one does. */
  imageUrl?: string | null;
}

export interface PosQuantities {
  units: Record<string, number>;
  pieces: Record<string, number>;
}

const clamp = (n: number, max: number) => Math.max(0, Math.min(n, max));

/** A search box that fills the top of a till and stays there. */
export function PosSearch({
  value, onChange, count, placeholder = "Find a product",
}: {
  value: string;
  onChange: (v: string) => void;
  /** How many are on the shelf or the van, said once rather than per row. */
  count?: string;
  placeholder?: string;
}) {
  return (
    <div className="sticky top-0 z-20 -mx-5 border-b border-[var(--border-subtle)] bg-[var(--surface-base)]/95 px-5 py-3 backdrop-blur">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--text-muted)]"
          aria-hidden
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-12 pl-9"
        />
      </div>
      {count && (
        <p className="mt-1.5 text-xs text-[var(--text-muted)]">{count}</p>
      )}
    </div>
  );
}

/**
 * One product.
 *
 * Small until it is in the basket. That is the whole trick: a row with
 * a stepper on it is about a hundred and eighty pixels tall, so a
 * phone showed one product and the person serving scrolled past
 * everything they wanted. Collapsed it is sixty, and the screen holds
 * eight.
 */
export function PosRow({
  item, units, pieces, onUnits, onPieces,
}: {
  item: PosItem;
  units: number;
  pieces: number;
  onUnits: (n: number) => void;
  onPieces: (n: number) => void;
}) {
  const chosen = units > 0 || pieces > 0;
  const splittable = holdsPieces(item.unit) && item.onHandPieces > 0;
  const unpriced = splittable && (item.piecePrice ?? 0) <= 0;
  const soldOut = item.onHand <= 0 && item.onHandPieces <= 0;
  const lineTotal = units * item.unitPrice + pieces * (item.piecePrice ?? 0);

  return (
    <li
      className={
        "border-b border-[var(--border-subtle)] last:border-0 " +
        (chosen ? "bg-brand-50/50 dark:bg-brand-950/30" : "")
      }
    >
      {/*
        The whole row adds one. At a counter the common act is "one of
        those", and making it a button the size of a finger rather than
        a plus sign the size of a fingernail is most of what makes a
        till quick.
      */}
      <button
        type="button"
        onClick={() => onUnits(clamp(units + 1, item.onHand))}
        disabled={soldOut || units >= item.onHand}
        className="flex w-full items-center gap-3 px-4 py-3 text-left disabled:opacity-55"
      >
        {item.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imageUrl} alt="" loading="lazy"
               className="size-10 shrink-0 rounded-[var(--radius-panel)] border border-[var(--border-subtle)] object-cover" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-[var(--text-primary)]">
            {item.name}
          </span>
          <span className="numeric mt-0.5 block text-xs text-[var(--text-secondary)]">
            {soldOut
              ? "Sold out"
              : formatHolding(
                  { units: item.onHand, pieces: item.onHandPieces }, item.unit, { empty: "none" },
                )}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="numeric block text-sm font-semibold text-[var(--text-primary)]">
            {formatMoney(item.unitPrice)}
          </span>
          {chosen ? (
            <span className="numeric mt-0.5 block text-xs font-medium text-brand-700 dark:text-brand-300">
              {formatMoney(lineTotal)}
            </span>
          ) : (
            <span className="mt-1 ml-auto grid size-8 place-items-center rounded-full border border-[var(--border-strong)] text-[var(--text-secondary)]">
              <Plus className="size-4" aria-hidden />
            </span>
          )}
        </span>
      </button>

      {/* The controls appear only once this product is in the sale. */}
      {chosen && (
        <div className="space-y-2 px-4 pb-3">
          <Row
            label={`${item.unit}${units === 1 ? "" : "s"}`}
            rate={formatMoney(item.unitPrice)}
            value={units} max={item.onHand}
            onChange={(n) => onUnits(clamp(n, item.onHand))}
            name={`${item.unit}s of ${item.name}`}
          />
          {splittable && !unpriced && (
            <Row
              label={`Piece${pieces === 1 ? "" : "s"}`}
              rate={formatMoney(item.piecePrice ?? 0)}
              value={pieces} max={item.onHandPieces}
              onChange={(n) => onPieces(clamp(n, item.onHandPieces))}
              name={`loose pieces of ${item.name}`}
            />
          )}
          {unpriced && (
            <p className="text-xs text-[var(--text-muted)]">
              {item.onHandPieces} loose {item.onHandPieces === 1 ? "piece" : "pieces"} here,
              but no price is set for one. Ask the office.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/** One quantity: label, rate, and thumbs either side of the number. */
function Row({
  label, rate, value, max, onChange, name,
}: {
  label: string; rate: string; value: number; max: number;
  onChange: (n: number) => void; name: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
          {label}
        </span>
        <span className="numeric block text-xs text-[var(--text-muted)]">{rate} each</span>
      </span>
      <button
        type="button" aria-label={`One fewer ${name}`}
        onClick={() => onChange(value - 1)} disabled={value === 0}
        className="grid size-11 shrink-0 place-items-center rounded-[var(--radius-panel)] border border-[var(--border-strong)] text-[var(--text-primary)] disabled:opacity-40"
      >
        <Minus className="size-4" aria-hidden />
      </button>
      <Input
        aria-label={name} inputMode="numeric"
        value={value === 0 ? "" : String(value)} placeholder="0"
        onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, "") || 0))}
        className="numeric h-11 w-16 shrink-0 text-center text-base"
      />
      <button
        type="button" aria-label={`One more ${name}`}
        onClick={() => onChange(value + 1)} disabled={value >= max}
        className="grid size-11 shrink-0 place-items-center rounded-[var(--radius-panel)] border border-[var(--border-strong)] text-[var(--text-primary)] disabled:opacity-40"
      >
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/**
 * The bar at the bottom of a till.
 *
 * One line of money and one button. Tapping the money opens the basket,
 * because "what have I actually added" is a question people ask before
 * they take payment, and the old screens could only answer it by
 * scrolling the whole catalogue looking for highlighted rows.
 */
export function PosBar({
  lines, total, action, onAction, disabled, pending, children,
}: {
  lines: { id: string; name: string; unit: string; units: number; pieces: number; total: number }[];
  total: number;
  action: string;
  onAction: () => void;
  disabled?: boolean;
  pending?: boolean;
  /** Per-line editing, supplied by the till that owns the quantities. */
  children?: (line: { id: string }) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const count = lines.length;

  return (
    // Pinned to the screen, not to the flow. Sticky left it sitting in
    // the middle of the list with products continuing behind and below
    // it, which reads as the list ending there.
    //
    // The offset is the navigation bar's exact height - h-14 plus the
    // home-indicator inset - because a round number left a strip of the
    // page showing through between the two.
    <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 border-t border-[var(--border-strong)] bg-[var(--surface-raised)] px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.25)] lg:bottom-0">
      <div className="mx-auto max-w-2xl">
      {open && count > 0 && (
        <ul className="mb-3 max-h-64 overflow-y-auto rounded-[var(--radius-panel)] border border-[var(--border-subtle)]">
          {lines.map((l) => (
            <li key={l.id}
                className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-3 py-2 last:border-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-[var(--text-primary)]">{l.name}</span>
                <span className="numeric block text-xs text-[var(--text-muted)]">
                  {formatHolding({ units: l.units, pieces: l.pieces }, l.unit, { empty: "none" })}
                </span>
              </span>
              <span className="numeric shrink-0 text-sm font-medium text-[var(--text-primary)]">
                {formatMoney(l.total)}
              </span>
              {children?.({ id: l.id })}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={count === 0}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-70"
        >
          <span className="min-w-0">
            <span className="block text-xs text-[var(--text-secondary)]">
              {count === 0
                ? "Nothing added yet"
                : `${count} ${count === 1 ? "item" : "items"}${count ? " · tap to check" : ""}`}
            </span>
            <span className="numeric block text-2xl font-semibold text-[var(--text-primary)]">
              {formatMoney(total)}
            </span>
          </span>
          {count > 0 && (open
            ? <ChevronDown className="size-4 shrink-0 text-[var(--text-muted)]" aria-hidden />
            : <ChevronUp className="size-4 shrink-0 text-[var(--text-muted)]" aria-hidden />)}
        </button>

        <button
          type="button"
          onClick={onAction}
          disabled={disabled || pending}
          className="h-14 shrink-0 rounded-[var(--radius-panel)] bg-brand-700 px-5 text-base font-semibold text-white transition-colors hover:bg-brand-800 disabled:opacity-45"
        >
          {pending ? "Working…" : action}
        </button>
      </div>
      </div>
    </div>
  );
}

/**
 * Room for the bar.
 *
 * PosBar is fixed, so without this the last product sits underneath it
 * and the list looks like it stops early - which is what the old
 * screens did.
 */
export function PosBarSpacer() {
  return <div className="h-32" aria-hidden />;
}

/** Clears one line from the basket, from inside the basket. */
export function PosRemove({ onRemove, name }: { onRemove: () => void; name: string }) {
  return (
    <button
      type="button" aria-label={`Remove ${name}`} onClick={onRemove}
      className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-panel)] border border-[var(--border-strong)] text-[var(--text-secondary)]"
    >
      <Trash2 className="size-4" aria-hidden />
    </button>
  );
}
