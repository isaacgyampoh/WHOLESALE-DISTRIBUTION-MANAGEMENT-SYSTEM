"use client";

import { useState, useTransition } from "react";
import { shareReceiptAction, type ShareableReceipt } from "./actions";
import type { ReceiptKind } from "@/lib/receipts/receipt";
import { formatPhone } from "@/lib/receipts/receipt";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { MessageCircle, Download, Link2, Check, Eye } from "lucide-react";

/**
 * Getting a receipt to the customer standing in front of you.
 *
 * The salesperson has no printer, so the whole point is the two taps
 * after a sale: confirm the number, send it. A number already on the
 * customer's record is filled in and needs no thought; a walk-in types
 * one and does not have to be registered first.
 *
 * WhatsApp cannot be handed a generated file through a wa.me address,
 * so what it carries is the link. Nothing here says the PDF was
 * attached, because it was not - the customer taps the link and gets
 * their receipt, and the wording says exactly that.
 */
export function ShareReceipt({
  kind,
  subjectId,
  customerPhone,
  compact = false,
}: {
  kind: ReceiptKind;
  subjectId: string;
  /** From the customer's record, where there is one. */
  customerPhone?: string | null;
  compact?: boolean;
}) {
  const [phone, setPhone] = useState(customerPhone ?? "");
  const [state, setState] = useState<ShareableReceipt | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  const known = Boolean(customerPhone);

  const send = () => {
    start(async () => {
      const result = await shareReceiptAction(kind, subjectId, phone);
      setState(result);

      // Opened straight away on success: the salesperson is standing
      // with the customer and a second tap is a second chance to be
      // interrupted. Popup blockers only intervene without a gesture,
      // and this is inside the click that started it.
      if (result.ok && result.whatsapp) {
        window.open(result.whatsapp, "_blank", "noopener,noreferrer");
      }
    });
  };

  if (state?.ok) {
    return (
      <div className="space-y-3">
        <Alert tone="success" title={`Receipt ${state.receiptNumber} ready`}>
          WhatsApp has been opened with the message and a link to the receipt.
          {customerPhone || phone
            ? ` Sending to ${formatPhone(phone || customerPhone || "")}.`
            : ""}{" "}
          The customer opens the link to see and download it.
        </Alert>

        <div className="grid gap-2 sm:grid-cols-3">
          <Button
            onClick={() => window.open(state.whatsapp, "_blank", "noopener,noreferrer")}
          >
            <MessageCircle className="size-4" aria-hidden />
            Open WhatsApp
          </Button>

          <a
            href={`${state.url}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius-panel)] border border-[var(--border-strong)] px-4 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-sunken)] pointer-fine:h-9.5"
          >
            <Download className="size-4" aria-hidden />
            PDF
          </a>

          <a
            href={state.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius-panel)] border border-[var(--border-strong)] px-4 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-sunken)] pointer-fine:h-9.5"
          >
            <Eye className="size-4" aria-hidden />
            View
          </a>
        </div>

        {/* For a phone with no WhatsApp, and for reading the number out. */}
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(state.text ?? state.url ?? "");
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? <Check className="size-4" aria-hidden /> : <Link2 className="size-4" aria-hidden />}
          {copied ? "Message copied" : "Copy the message instead"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {state && !state.ok && <Alert tone="danger">{state.message}</Alert>}

      {known ? (
        // Already known, so it is shown rather than asked for - but it
        // stays editable, because the person paying is not always the
        // person whose number is on the account.
        <Field label="Send to" htmlFor="receipt-phone" hint="From the customer's record. Change it if the receipt should go elsewhere.">
          <Input
            id="receipt-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
          />
        </Field>
      ) : (
        <Field
          label="Customer's phone number"
          htmlFor="receipt-phone"
          required
          hint="For the receipt only. The customer does not need an account."
        >
          <Input
            id="receipt-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="024 123 4567"
            inputMode="tel"
            autoComplete="tel"
            autoFocus={!compact}
          />
        </Field>
      )}

      <Button
        onClick={send}
        loading={pending}
        disabled={!phone.trim()}
        size={compact ? "md" : "lg"}
        className="w-full"
      >
        <MessageCircle className="size-4" aria-hidden />
        {pending ? "Preparing…" : "Send receipt on WhatsApp"}
      </Button>
    </div>
  );
}
