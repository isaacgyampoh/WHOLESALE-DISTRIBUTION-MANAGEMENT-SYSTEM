"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSync } from "./sync-provider";
import { enqueue } from "@/lib/offline/queue";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Card, CardBody } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/states";
import { formatQuantity } from "@/lib/utils/format";
import { PackageCheck, Check } from "lucide-react";

/**
 * Bringing the van back in.
 *
 * The driver counts what is physically on board against what the
 * system thinks is there. Anything unaccounted for is left as a
 * shortage rather than quietly balanced: a return that always adds up
 * would tell the office nothing.
 */
export function ReturnForm() {
  const router = useRouter();
  const { snapshot, online, refresh, sync } = useSync();
  const [good, setGood] = useState<Record<string, string>>({});
  const [damaged, setDamaged] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const stock = snapshot?.stock ?? [];

  if (!snapshot?.load) {
    return (
      <Card>
        <EmptyState
          icon={PackageCheck}
          title="No open load"
          description="There is no dispatched load on your van to return."
        />
      </Card>
    );
  }

  if (stock.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={PackageCheck}
          title="The van is empty"
          description="Everything on this load has been sold. Go straight to the end of day count."
        />
      </Card>
    );
  }

  const number = (value: string | undefined) => Number((value ?? "").trim() || 0);

  async function submit() {
    setError(null);

    const lines = stock.map((s) => {
      const g = number(good[s.product_id]);
      const d = number(damaged[s.product_id]);
      return {
        product_id: s.product_id,
        qty_expected: s.qty_on_hand,
        qty_returned_good: g,
        qty_damaged: d,
        damage_reason: d > 0 ? (reasons[s.product_id] ?? "").trim() || "Not stated" : null,
        name: s.name,
      };
    });

    for (const line of lines) {
      if (line.qty_returned_good + line.qty_damaged > line.qty_expected) {
        setError(
          `More ${line.name} was counted than the van is carrying ` +
          `(${line.qty_returned_good + line.qty_damaged} against ${line.qty_expected}).`,
        );
        return;
      }
    }

    setBusy(true);
    try {
      const missing = lines.reduce(
        (s, l) => s + (l.qty_expected - l.qty_returned_good - l.qty_damaged), 0);
      await enqueue(
        "van_return",
        {
          load_id: snapshot!.load!.id,
          notes: notes || null,
          // The product name is carried for the error messages above;
          // the server does not want it.
          lines: lines.map((l) => ({
            product_id: l.product_id,
            qty_expected: l.qty_expected,
            qty_returned_good: l.qty_returned_good,
            qty_damaged: l.qty_damaged,
            damage_reason: l.damage_reason,
          })),
        },
        `Return for ${snapshot!.load!.load_number}` +
        (missing > 0 ? ` · ${formatQuantity(missing)} unaccounted` : ""),
      );
      setSaved(true);
      await refresh();
      if (online) void sync();
      router.refresh();
    } catch {
      setError("This device could not store the return. Check your browser storage settings.");
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <Card>
        <CardBody className="space-y-4">
          <Alert tone="success" title="Return recorded">
            It goes to the warehouse for approval.{" "}
            {online ? "It is on its way." : "It will send when you have a signal."}
          </Alert>
          <Button size="touch" onClick={() => router.push("/driver")}>
            <Check className="size-5" aria-hidden />
            Back to my round
          </Button>
        </CardBody>
      </Card>
    );
  }

  const outstanding = stock.reduce(
    (sum, s) =>
      sum + (s.qty_on_hand - number(good[s.product_id]) - number(damaged[s.product_id])),
    0,
  );

  return (
    <Card>
      <CardBody className="space-y-5">
        {error && <Alert tone="danger">{error}</Alert>}
        {!online && (
          <Alert tone="warning" title="No signal">
            The count is stored on this phone and sent when you reconnect.
          </Alert>
        )}

        <p className="text-sm text-[var(--text-secondary)]">
          Count what is actually on the van. Anything you do not enter is
          recorded as missing.
        </p>

        <div className="space-y-3">
          {stock.map((s) => (
            <div
              key={s.product_id}
              className="space-y-3 rounded-[var(--radius-panel)] border border-[var(--border-subtle)] p-3"
            >
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">{s.name}</p>
                <p className="numeric text-xs text-[var(--text-muted)]">
                  {s.sku} · {formatQuantity(s.qty_on_hand)} should be on board
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Good" htmlFor={`good-${s.product_id}`}>
                  <Input
                    id={`good-${s.product_id}`}
                    inputMode="numeric"
                    placeholder="0"
                    value={good[s.product_id] ?? ""}
                    onChange={(e) =>
                      setGood((c) => ({ ...c, [s.product_id]: e.target.value.replace(/\D/g, "") }))
                    }
                    className="numeric h-14 text-base"
                  />
                </Field>
                <Field label="Damaged" htmlFor={`damaged-${s.product_id}`}>
                  <Input
                    id={`damaged-${s.product_id}`}
                    inputMode="numeric"
                    placeholder="0"
                    value={damaged[s.product_id] ?? ""}
                    onChange={(e) =>
                      setDamaged((c) => ({ ...c, [s.product_id]: e.target.value.replace(/\D/g, "") }))
                    }
                    className="numeric h-14 text-base"
                  />
                </Field>
              </div>
              {number(damaged[s.product_id]) > 0 && (
                <Field label="What happened to it?" htmlFor={`reason-${s.product_id}`}>
                  <Input
                    id={`reason-${s.product_id}`}
                    placeholder="Crushed in transit"
                    value={reasons[s.product_id] ?? ""}
                    onChange={(e) => setReasons((c) => ({ ...c, [s.product_id]: e.target.value }))}
                    className="h-14 text-base"
                  />
                </Field>
              )}
              <Button
                type="button" variant="outline" size="sm"
                onClick={() =>
                  setGood((c) => ({ ...c, [s.product_id]: String(s.qty_on_hand) }))
                }
              >
                All {formatQuantity(s.qty_on_hand)} are good
              </Button>
            </div>
          ))}
        </div>

        <div className="flex items-baseline justify-between rounded-[var(--radius-panel)] bg-[var(--surface-sunken)] px-4 py-3">
          <span className="text-sm font-medium text-[var(--text-secondary)]">Unaccounted for</span>
          <span
            className={
              "numeric text-2xl font-semibold " +
              (outstanding > 0 ? "text-critical" : "text-positive")
            }
          >
            {formatQuantity(outstanding)}
          </span>
        </div>

        <Field label="Note" htmlFor="returnNotes" hint="Optional.">
          <Textarea id="returnNotes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <Button size="touch" onClick={() => void submit()} loading={busy}>
          Submit the count
        </Button>
      </CardBody>
    </Card>
  );
}
