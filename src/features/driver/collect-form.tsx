"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSync } from "./sync-provider";
import { enqueue } from "@/lib/offline/queue";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Card, CardBody } from "@/components/ui/card";
import { Alert } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/utils/format";
import { PAYMENT_METHODS } from "@/types/domain";
import { METHOD_LABELS } from "@/features/commercial/payment-list";
import { Check } from "lucide-react";

/**
 * Taking money on the round.
 *
 * The customer's balance comes from the cached snapshot, so it is what
 * it was at the last sync rather than this instant. That is stated on
 * screen: a driver settling an account needs to know the figure might
 * have moved, and a number presented as live when it is not would be
 * worse than one presented honestly as cached.
 */
export function CollectForm() {
  const router = useRouter();
  const { snapshot, online, refresh, sync } = useSync();
  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>("cash");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const customers = snapshot?.customers ?? [];
  const customer = customers.find((c) => c.id === customerId);

  async function submit() {
    setError(null);
    if (!customerId) { setError("Choose a customer."); return; }
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(amount.trim())) {
      setError("Enter an amount, like 250 or 250.50.");
      return;
    }
    if (Number(amount) <= 0) { setError("Enter an amount above zero."); return; }

    setBusy(true);
    try {
      await enqueue(
        "collection",
        {
          customer_id: customerId,
          amount: Number(amount),
          method,
          notes: notes || null,
        },
        `Collected ${formatMoney(Number(amount))} from ${customer?.name ?? "customer"}`,
      );
      setSaved(`${formatMoney(Number(amount))} recorded from ${customer?.name ?? "the customer"}.`);
      setCustomerId(""); setAmount(""); setNotes("");
      await refresh();
      if (online) void sync();
      router.refresh();
    } catch {
      setError("This device could not store the collection. Check your browser storage settings.");
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <Card>
        <CardBody className="space-y-4">
          <Alert tone="success" title="Collection recorded">
            {saved}{" "}
            {online ? "It is on its way to the office." : "It will send when you have a signal."}
          </Alert>

          {/*
            No receipt here, and deliberately not a button that pretends
            otherwise. A collection taken on this phone is queued, not
            yet a ledger entry, so there is nothing to issue a link
            against until it reaches the office.
          */}
          <p className="text-sm text-[var(--text-secondary)]">
            The payment receipt can be sent from Credit once this reaches the
            office.
          </p>
          <Button size="touch" onClick={() => setSaved(null)}>
            <Check className="size-5" aria-hidden />
            Take another payment
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
            The collection is stored on this phone and sent when you reconnect.
          </Alert>
        )}

        <Field label="Customer" htmlFor="collectCustomer" required>
          <Select
            id="collectCustomer"
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
          <div className="space-y-2">
            <div className="flex items-baseline justify-between rounded-[var(--radius-panel)] bg-[var(--surface-sunken)] px-4 py-3">
              <span className="text-sm font-medium text-[var(--text-secondary)]">They owe</span>
              <span className="numeric text-2xl font-semibold text-[var(--text-primary)]">
                {formatMoney(customer.balance)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button" variant="outline" size="sm"
                onClick={() => setAmount(String(Math.max(0, customer.balance)))}
              >
                Pay it all
              </Button>
              {snapshot?.cached_at && (
                <Badge tone="neutral">As at last sync</Badge>
              )}
            </div>
          </div>
        )}

        <Field label="Amount received" htmlFor="collectAmount" required hint="In Ghana Cedis.">
          <Input
            id="collectAmount"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="numeric h-14 text-xl"
          />
        </Field>

        <Field label="How did they pay?" htmlFor="collectMethod" required>
          <Select
            id="collectMethod"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="h-14 text-base"
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>{METHOD_LABELS[m] ?? m}</option>
            ))}
          </Select>
        </Field>

        <Field label="Reference" htmlFor="collectNotes" hint="A momo transaction id, if there is one.">
          <Textarea id="collectNotes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <Button size="touch" onClick={() => void submit()} loading={busy}>
          Record collection
        </Button>
      </CardBody>
    </Card>
  );
}
