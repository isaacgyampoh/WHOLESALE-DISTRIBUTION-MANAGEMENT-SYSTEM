"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { returnVanStockAction } from "./actions";
import type { LoadLine } from "./queries";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select, Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { Undo2 } from "lucide-react";
import { formatQuantity } from "@/lib/utils/format";
import { formatHolding, holdsPieces } from "@/lib/catalogue/quantity";

/**
 * Sending unsold stock back to a warehouse mid-round.
 *
 * Deliberately worded so nobody mistakes it for the Friday return. That
 * one counts the whole van and closes the week; this moves some of it
 * and changes nothing else. The heading, the description and the button
 * all say so, because the two are one careless click apart.
 *
 * Only what is actually on the van is offered, and only up to what is
 * there - the same figure the salesperson is selling from.
 */
export function SendBackButton({
  loadId, loadNumber, vanCode, lines, warehouses, defaultWarehouseId,
}: {
  loadId: string;
  loadNumber: string;
  vanCode: string;
  lines: LoadLine[];
  warehouses: { id: string; name: string }[];
  defaultWarehouseId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId);
  const [note, setNote] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [pieceAmounts, setPieceAmounts] = useState<Record<string, string>>({});
  const [result, setResult] =
    useState<{ ok: boolean; message?: string; lines?: number } | null>(null);
  const [pending, start] = useTransition();

  // Nothing left on the van is nothing to send back.
  const onBoard = lines.filter((l) => l.remaining > 0 || l.remainingPieces > 0);

  const payload = [...new Set([...Object.keys(amounts), ...Object.keys(pieceAmounts)])]
    .map((productId) => ({
      productId,
      quantity: Number(amounts[productId] ?? 0),
      pieces: Number(pieceAmounts[productId] ?? 0),
    }))
    .filter((l) => l.quantity > 0 || l.pieces > 0);

  const close = () => {
    setOpen(false);
    setResult(null);
    setNote("");
    setAmounts({});
    setPieceAmounts({});
  };

  const submit = () => {
    start(async () => {
      const outcome = await returnVanStockAction({ loadId, warehouseId, note, lines: payload });
      setResult(outcome);
      if (outcome.ok) {
        setAmounts({});
        setPieceAmounts({});
        setNote("");
        router.refresh();
      }
    });
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Undo2 className="size-4" aria-hidden />
        Send stock back
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title={`Send stock back from ${vanCode}`}
        description={`Returns part of what ${vanCode} is carrying to a warehouse now. This does not close the round - ${loadNumber} stays out.`}
        className="sm:max-w-lg"
      >
        {result?.ok ? (
          <div className="space-y-4">
            <Alert tone="success" title="Sent back">
              {formatQuantity(result.lines ?? 0)}{" "}
              {result.lines === 1 ? "product is" : "products are"} back at the warehouse.
              {vanCode} is still out on {loadNumber}.
            </Alert>
            <Button variant="outline" className="w-full" onClick={close}>Done</Button>
          </div>
        ) : (
          <div className="space-y-4">
            {result && !result.ok && <Alert tone="danger">{result.message}</Alert>}

            {onBoard.length === 0 ? (
              <Alert tone="warning">
                There is nothing on {vanCode} to send back.
              </Alert>
            ) : (
              <>
                <Field label="Send it to" htmlFor="sendBackWarehouse" required>
                  <Select
                    id="sendBackWarehouse" value={warehouseId}
                    onChange={(e) => setWarehouseId(e.target.value)}
                  >
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </Select>
                </Field>

                <div>
                  <p className="mb-2 text-sm font-medium text-[var(--text-primary)]">
                    What to send back
                  </p>
                  <ul className="divide-y divide-[var(--border-subtle)] rounded-[var(--radius-panel)] border border-[var(--border-subtle)]">
                    {onBoard.map((line) => {
                      const splittable = holdsPieces(line.unit);
                      return (
                        /* Stacked on a phone: a name and two number boxes
                           do not share a row at 375px. */
                        <li key={line.productId}
                            className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-[var(--text-primary)]">
                              {line.productName}
                            </p>
                            <p className="numeric text-xs text-[var(--text-muted)]">
                              {line.sku} ·{" "}
                              {formatHolding(
                                { units: line.remaining, pieces: line.remainingPieces },
                                line.unit, { empty: "nothing" },
                              )}{" "}
                              on the van
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Input
                              aria-label={`Whole ${line.unit}s of ${line.productName} to send back`}
                              inputMode="numeric" placeholder="0"
                              value={amounts[line.productId] ?? ""}
                              onChange={(e) =>
                                setAmounts((prev) => ({
                                  ...prev,
                                  [line.productId]: e.target.value.replace(/\D/g, ""),
                                }))}
                              className="numeric w-20 shrink-0 text-center"
                            />
                            {splittable && line.remainingPieces > 0 && (
                              <Input
                                aria-label={`Loose pieces of ${line.productName} to send back`}
                                inputMode="numeric" placeholder="0"
                                value={pieceAmounts[line.productId] ?? ""}
                                onChange={(e) =>
                                  setPieceAmounts((prev) => ({
                                    ...prev,
                                    [line.productId]: e.target.value.replace(/\D/g, ""),
                                  }))}
                                className="numeric w-20 shrink-0 text-center"
                              />
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <Field
                  label="Why" htmlFor="sendBackNote"
                  hint="Kept against every movement this writes."
                >
                  <Input
                    id="sendBackNote" value={note} autoComplete="off"
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Over-loaded on Monday"
                  />
                </Field>

                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={close} disabled={pending}>
                    Cancel
                  </Button>
                  <Button
                    className="flex-1" onClick={submit}
                    loading={pending} disabled={payload.length === 0}
                  >
                    Send back
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
