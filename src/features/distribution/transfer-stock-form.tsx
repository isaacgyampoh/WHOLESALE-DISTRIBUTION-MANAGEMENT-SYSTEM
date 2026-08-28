"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { transferVanStockAction } from "./actions";
import type { VanTransferContext } from "./queries";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select, Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { formatHolding } from "@/lib/catalogue/quantity";
import { ArrowLeftRight } from "lucide-react";

/**
 * Moving a broken-down van's stock onto another one.
 *
 * The quantity boxes start empty rather than pre-filled with everything
 * on board: a breakdown is usually a partial move - what fits in the
 * relief vehicle - and a form that assumes otherwise invites somebody to
 * confirm a number they never chose.
 */
export function TransferStockButton({
  vanId,
  vanCode,
  context,
}: {
  vanId: string;
  vanCode: string;
  context: VanTransferContext;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [toVanId, setToVanId] = useState("");
  const [reason, setReason] = useState("Van breakdown");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  // The loose half, held apart from the units the whole way through.
  const [pieceAmounts, setPieceAmounts] = useState<Record<string, string>>({});
  const [result, setResult] =
    useState<{ ok: boolean; message?: string; moved?: number } | null>(null);
  const [pending, start] = useTransition();

  // Built from every product either box mentions, so a line of nothing
  // but singles is not dropped for having no full units.
  const lines = [...new Set([...Object.keys(amounts), ...Object.keys(pieceAmounts)])]
    .map((productId) => ({
      productId,
      quantity: Number(amounts[productId] ?? 0),
      pieces: Number(pieceAmounts[productId] ?? 0),
    }))
    .filter((l) =>
      Number.isInteger(l.quantity) && l.quantity >= 0 &&
      Number.isInteger(l.pieces) && l.pieces >= 0 &&
      (l.quantity > 0 || l.pieces > 0));

  const close = () => {
    setOpen(false);
    setResult(null);
    setAmounts({});
    setPieceAmounts({});
  };

  const submit = () => {
    start(async () => {
      const outcome = await transferVanStockAction({
        fromVanId: vanId, toVanId, reason, lines,
      });
      setResult(outcome);
      if (outcome.ok) {
        setAmounts({});
        setPieceAmounts({});
        router.refresh();
      }
    });
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={context.lines.length === 0 || context.otherVans.length === 0}
      >
        <ArrowLeftRight className="size-3.5" aria-hidden />
        Move stock
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title={`Move stock off ${vanCode}`}
        description="For a van that has broken down. Both vans keep a record of what moved and why."
        className="sm:max-w-lg"
      >
        {result?.ok ? (
          <div className="space-y-4">
            <Alert tone="success">
              {result.moved ?? lines.length} line
              {(result.moved ?? lines.length) === 1 ? "" : "s"} moved. Both vans now show it.
            </Alert>
            <Button className="w-full" onClick={close}>Done</Button>
          </div>
        ) : (
          <div className="space-y-4">
            {result && !result.ok && <Alert tone="danger">{result.message}</Alert>}

            <Field label="Move it to" htmlFor="toVan" required>
              <Select id="toVan" value={toVanId} onChange={(e) => setToVanId(e.target.value)}>
                <option value="" disabled>Choose the van taking over</option>
                {context.otherVans.map((v) => (
                  <option key={v.id} value={v.id}>{v.code}</option>
                ))}
              </Select>
            </Field>

            <Field label="Why" htmlFor="reason" required
                   hint="Recorded against every movement this writes.">
              <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>

            <div>
              <p className="mb-2 text-sm font-medium text-[var(--text-primary)]">
                What to move
              </p>
              <ul className="divide-y divide-[var(--border-subtle)] rounded-[var(--radius-panel)] border border-[var(--border-subtle)]">
                {context.lines.map((line) => (
                  <li key={line.productId} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-[var(--text-primary)]">{line.name}</p>
                      <p className="numeric text-xs text-[var(--text-muted)]">
                        {line.sku} ·{" "}
                        {formatHolding(
                          { units: line.onHand, pieces: line.onHandPieces },
                          line.unit,
                          { empty: "nothing" },
                        )}{" "}
                        on board
                      </p>
                    </div>
                    <Input
                      aria-label={line.onHandPieces > 0
                        ? `Whole ${line.unit}s of ${line.name} to move`
                        : `Quantity of ${line.name} to move`}
                      value={amounts[line.productId] ?? ""}
                      onChange={(e) => {
                        const next = e.target.value.replace(/[^\d]/g, "");
                        setAmounts((prev) => ({ ...prev, [line.productId]: next }));
                      }}
                      inputMode="numeric"
                      placeholder="0"
                      className="numeric w-20 shrink-0 text-center"
                    />
                    {/*
                      The loose half, only where the stranded van is
                      actually carrying singles. Nothing to move means
                      nothing to type.
                    */}
                    {line.onHandPieces > 0 && (
                      <Input
                        aria-label={`Loose pieces of ${line.name} to move`}
                        value={pieceAmounts[line.productId] ?? ""}
                        onChange={(e) => {
                          const next = e.target.value.replace(/[^\d]/g, "");
                          setPieceAmounts((prev) => ({ ...prev, [line.productId]: next }));
                        }}
                        inputMode="numeric"
                        placeholder="0"
                        className="numeric w-20 shrink-0 text-center"
                      />
                    )}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={close} disabled={pending}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={submit}
                loading={pending}
                disabled={!toVanId || lines.length === 0 || !reason.trim()}
              >
                Move {lines.length || ""} line{lines.length === 1 ? "" : "s"}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
