"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Dialog } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/utils/format";
import { Search, UserPlus, Check, X } from "lucide-react";
import type { OfflineSnapshot } from "@/lib/offline/queue";

export type CachedCustomer = OfflineSnapshot["customers"][number];

/**
 * Choosing who is buying, without leaving the sale.
 *
 * A driver pulls up at a shop that is not on the round yet. Sending them
 * to the administrator's Customers screen to add it, then back here to
 * start again, is how a sale gets written on the back of a hand instead.
 * So the new-customer form lives in this dialog and hands the sale a
 * customer when it closes.
 *
 * Both paths work with no signal. The list is the cached snapshot, and a
 * customer created offline is queued like any other operation.
 */
export function CustomerPicker({
  customers,
  selectedId,
  onSelect,
  onCreate,
  creating,
}: {
  customers: CachedCustomer[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** Resolves to the id of the customer that was created. */
  onCreate: (fields: {
    name: string; phone: string; city: string; address: string;
  }) => Promise<string | null>;
  creating: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState({ name: "", phone: "", city: "", address: "" });

  const selected = customers.find((c) => c.id === selectedId);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers.slice(0, 50);
    return customers
      .filter((c) =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        (c.phone ?? "").includes(q))
      .slice(0, 50);
  }, [customers, query]);

  async function save() {
    setError(null);
    if (!fields.name.trim()) { setError("Enter the customer's name."); return; }

    const id = await onCreate({
      name: fields.name.trim(),
      phone: fields.phone.trim(),
      city: fields.city.trim(),
      address: fields.address.trim(),
    });

    if (!id) {
      setError("That customer could not be saved. Check the details and try again.");
      return;
    }
    onSelect(id);
    setFields({ name: "", phone: "", city: "", address: "" });
    setNewOpen(false);
    setOpen(false);
  }

  return (
    <>
      {/* The chosen customer, or the prompt to choose one. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-16 w-full items-center justify-between gap-3 rounded-[var(--radius-panel)] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-4 text-left"
      >
        {selected ? (
          <span className="min-w-0">
            <span className="block truncate text-base font-medium text-[var(--text-primary)]">
              {selected.name}
            </span>
            <span className="numeric block truncate text-xs text-[var(--text-secondary)]">
              {selected.code}
              {selected.balance > 0 ? ` · owes ${formatMoney(selected.balance)}` : ""}
            </span>
          </span>
        ) : (
          <span className="flex items-center gap-2 text-base text-[var(--text-muted)]">
            <Search className="size-5" aria-hidden />
            Choose a customer
          </span>
        )}
        <span className="shrink-0 text-xs font-medium text-brand-700 dark:text-brand-300">
          {selected ? "Change" : "Select"}
        </span>
      </button>

      <Dialog
        open={open}
        onClose={() => { setOpen(false); setNewOpen(false); }}
        title={newOpen ? "New customer" : "Who is buying?"}
        description={newOpen ? "Saved and selected for this sale." : undefined}
        className="sm:max-w-md"
      >
        {newOpen ? (
          <div className="space-y-4">
            {error && <Alert tone="danger">{error}</Alert>}

            <Field label="Customer name" htmlFor="ncName" required>
              <Input
                id="ncName" value={fields.name} autoFocus
                onChange={(e) => setFields((f) => ({ ...f, name: e.target.value }))}
                placeholder="ABC Provision Store"
                className="h-14 text-base"
              />
            </Field>

            <Field label="Phone" htmlFor="ncPhone" hint="How you reach them.">
              <Input
                id="ncPhone" value={fields.phone} inputMode="tel"
                onChange={(e) => setFields((f) => ({ ...f, phone: e.target.value }))}
                placeholder="024 000 0000"
                className="numeric h-14 text-base"
              />
            </Field>

            <Field label="Town or area" htmlFor="ncCity">
              <Input
                id="ncCity" value={fields.city}
                onChange={(e) => setFields((f) => ({ ...f, city: e.target.value }))}
                placeholder="Madina"
                className="h-14 text-base"
              />
            </Field>

            <Field label="Where to find them" htmlFor="ncAddress" hint="Optional.">
              <Textarea
                id="ncAddress" rows={2} value={fields.address}
                onChange={(e) => setFields((f) => ({ ...f, address: e.target.value }))}
                placeholder="Opposite the filling station"
              />
            </Field>

            <p className="text-xs text-[var(--text-muted)]">
              New customers start on cash terms. A supervisor sets a credit
              limit later if the business agrees one.
            </p>

            <div className="flex gap-2">
              <Button
                type="button" variant="outline" size="touch"
                onClick={() => { setNewOpen(false); setError(null); }}
                disabled={creating}
              >
                <X className="size-5" aria-hidden />
                Back
              </Button>
              <Button size="touch" onClick={() => void save()} loading={creating}>
                <Check className="size-5" aria-hidden />
                Save customer
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--text-muted)]"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, code or phone"
                aria-label="Search customers"
                className="h-14 pl-9 text-base"
              />
            </div>

            <Button type="button" variant="outline" size="touch" onClick={() => setNewOpen(true)}>
              <UserPlus className="size-5" aria-hidden />
              New customer
            </Button>

            <ul className="-mx-5 max-h-[45dvh] divide-y divide-[var(--border-subtle)] overflow-y-auto">
              {matches.length === 0 ? (
                <li className="px-5 py-6 text-center text-sm text-[var(--text-secondary)]">
                  No customer matches that. Add them with New customer.
                </li>
              ) : (
                matches.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => { onSelect(c.id); setOpen(false); }}
                      className="flex min-h-16 w-full items-center justify-between gap-3 px-5 text-left transition-colors hover:bg-[var(--surface-sunken)]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-[var(--text-primary)]">
                          {c.name}
                        </span>
                        <span className="numeric block truncate text-xs text-[var(--text-muted)]">
                          {c.code}{c.phone ? ` · ${c.phone}` : ""}
                        </span>
                      </span>
                      {c.balance > 0 && (
                        <Badge tone="caution">{formatMoney(c.balance)}</Badge>
                      )}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </Dialog>
    </>
  );
}
