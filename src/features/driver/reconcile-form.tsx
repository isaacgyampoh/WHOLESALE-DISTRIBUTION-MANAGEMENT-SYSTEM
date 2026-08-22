"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSync } from "./sync-provider";
import { enqueue } from "@/lib/offline/queue";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Card, CardBody } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/states";
import { formatMoney } from "@/lib/utils/format";
import { Scale, Check } from "lucide-react";

/**
 * The end of day count.
 *
 * The driver enters one number: the cash they are handing over.
 * Everything else - what was loaded, what was sold, what came back, and
 * therefore what the cash should be - is computed by the database from
 * the round's own records when the operation is applied. A phone that
 * has been offline all day has no business calculating what the office
 * is owed.
 */
export function ReconcileForm({
  expectedCash,
  reconciliationId,
}: {
  /** From the server when online; null when the device is not. */
  expectedCash: number | null;
  reconciliationId: string | null;
}) {
  const router = useRouter();
  const { snapshot, online, refresh, sync } = useSync();
  const [actualCash, setActualCash] = useState("");
  const [explanation, setExplanation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!snapshot?.load) {
    return (
      <Card>
        <EmptyState
          icon={Scale}
          title="No round to close"
          description="There is no dispatched load on your van."
        />
      </Card>
    );
  }

  const counted = Number((actualCash || "").trim() || 0);
  const variance = expectedCash === null ? null : counted - expectedCash;

  async function submit() {
    setError(null);
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(actualCash.trim())) {
      setError("Enter the cash you are handing in, like 2400 or 2400.50.");
      return;
    }
    // Required whenever the office can already tell it will not balance.
    // When the device is offline the figure is unknown here, and the
    // database applies the same rule when the operation lands.
    if (variance !== null && Math.abs(variance) >= 0.01 && !explanation.trim()) {
      setError("This does not balance. Say what happened before you submit.");
      return;
    }

    setBusy(true);
    try {
      await enqueue(
        "reconciliation",
        {
          load_id: snapshot!.load!.id,
          reconciliation_id: reconciliationId,
          actual_cash: Number(actualCash),
          explanation: explanation.trim() || null,
        },
        `End of day for ${snapshot!.load!.load_number} · ${formatMoney(Number(actualCash))}`,
      );
      setSaved(true);
      await refresh();
      if (online) void sync();
      router.refresh();
    } catch {
      setError("This device could not store the count. Check your browser storage settings.");
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <Card>
        <CardBody className="space-y-4">
          <Alert tone="success" title="End of day submitted">
            A supervisor will check and settle it. You cannot approve your own round.{" "}
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

  return (
    <Card>
      <CardBody className="space-y-5">
        {error && <Alert tone="danger">{error}</Alert>}

        {expectedCash === null ? (
          <Alert tone="warning" title="Working offline">
            What you should be handing in is worked out by the office when
            this sends. Enter what you actually have.
          </Alert>
        ) : (
          <div className="flex items-baseline justify-between rounded-[var(--radius-panel)] bg-[var(--surface-sunken)] px-4 py-3">
            <span className="text-sm font-medium text-[var(--text-secondary)]">Expected</span>
            <span className="numeric text-2xl font-semibold text-[var(--text-primary)]">
              {formatMoney(expectedCash)}
            </span>
          </div>
        )}

        <Field label="Cash you are handing in" htmlFor="actualCash" required hint="Count it twice.">
          <Input
            id="actualCash"
            inputMode="decimal"
            placeholder="0.00"
            value={actualCash}
            onChange={(e) => setActualCash(e.target.value)}
            className="numeric h-16 text-2xl"
          />
        </Field>

        {variance !== null && actualCash && (
          <div
            className={
              "flex items-baseline justify-between rounded-[var(--radius-panel)] px-4 py-3 " +
              (Math.abs(variance) < 0.01
                ? "bg-positive-soft dark:bg-positive/15"
                : variance < 0
                  ? "bg-critical-soft dark:bg-critical/15"
                  : "bg-caution-soft dark:bg-caution/15")
            }
          >
            <span className="text-sm font-medium text-[var(--text-secondary)]">
              {Math.abs(variance) < 0.01 ? "Balanced" : variance < 0 ? "Short by" : "Over by"}
            </span>
            <span className="numeric text-2xl font-semibold text-[var(--text-primary)]">
              {formatMoney(Math.abs(variance))}
            </span>
          </div>
        )}

        <Field
          label="What happened?"
          htmlFor="explanation"
          hint={
            variance !== null && Math.abs(variance) >= 0.01
              ? "Required, because this does not balance."
              : "Only needed if something is off."
          }
        >
          <Textarea
            id="explanation"
            rows={3}
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
          />
        </Field>

        <Button size="touch" onClick={() => void submit()} loading={busy}>
          Submit the end of day
        </Button>
      </CardBody>
    </Card>
  );
}
