"use client";

import { useState, useTransition } from "react";
import { shareReceiptAction, type ShareableReceipt } from "./actions";
import type { ReceiptKind } from "@/lib/receipts/receipt";
import { formatPhone } from "@/lib/receipts/receipt";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { usePdfShare } from "./use-pdf-share";
import { MessageCircle, Download, Link2, Check, Eye, Share2 } from "lucide-react";

/**
 * Getting a receipt to the customer standing in front of you.
 *
 * The salesperson has no printer, so the whole point is the two taps
 * after a sale: confirm the number, send it. A number already on the
 * customer's record is filled in and needs no thought; a walk-in types
 * one and does not have to be registered first.
 *
 * How the receipt travels depends on what the device can do, and the
 * wording changes with it rather than overstating either.
 *
 * On a phone, the share sheet takes the actual PDF: the customer gets a
 * file in their WhatsApp that opens with no signal and no link to
 * follow. That is the first button, because it is the better outcome.
 *
 * Where files cannot be shared - desktop Firefox has no sheet at all -
 * WhatsApp is opened with the message and a link instead. A wa.me
 * address cannot carry a generated file, and nothing here claims it
 * does: the button says what it will do before it is pressed.
 */
/**
 * Can this device put a file into the share sheet at all?
 *
 * Answered with a real, tiny PDF rather than an empty object, because
 * canShare inspects what it is given. Synchronous on purpose: it is
 * consulted while deciding whether to open WhatsApp, before any fetch.
 */
function deviceSharesFiles(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") {
    return false;
  }
  try {
    const probe = new File([new Uint8Array([37, 80, 68, 70])], "probe.pdf", {
      type: "application/pdf",
    });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

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

      // On a device that cannot carry a file, WhatsApp is opened here
      // and now with the link: the salesperson is standing with the
      // customer, and a second tap is a second chance to be interrupted.
      //
      // Where files CAN be shared this deliberately does not fire. The
      // better outcome is one tap away on the panel that follows, and
      // opening a link first would send the customer the worse one.
      if (result.ok && result.whatsapp && !deviceSharesFiles()) {
        window.open(result.whatsapp, "_blank", "noopener,noreferrer");
      }
    });
  };

  if (state?.ok) {
    return (
      <SentPanel
        state={state}
        phone={phone || customerPhone || ""}
        copied={copied}
        setCopied={setCopied}
      />
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

/**
 * What to do with a receipt that now exists.
 *
 * Split out because it needs the PDF in hand before anything is
 * pressed, and a hook cannot run behind an early return.
 */
function SentPanel({
  state, phone, copied, setCopied,
}: {
  state: ShareableReceipt;
  phone: string;
  copied: boolean;
  setCopied: (v: boolean) => void;
}) {
  const pdfUrl = state.url ? `${state.url}/pdf` : undefined;
  const fileName = `receipt-${state.receiptNumber ?? "gab"}.pdf`;
  const { state: share, share: sharePdf, canShareFile } = usePdfShare(pdfUrl, fileName);

  return (
    <div className="space-y-3">
      <Alert tone="success" title={`Receipt ${state.receiptNumber} ready`}>
        {canShareFile
          ? "Share the PDF straight into WhatsApp, or send the link instead."
          : "WhatsApp has been opened with the message and a link to the receipt."}
        {phone ? ` Sending to ${formatPhone(phone)}.` : ""}
      </Alert>

      {/*
        The file, first, wherever the device can carry one: the customer
        ends up with a PDF rather than a link to follow.
      */}
      {canShareFile && (
        <Button
          size="lg"
          className="w-full"
          loading={share.status === "sharing"}
          onClick={() => sharePdf(
            `Receipt ${state.receiptNumber}`,
            "Your receipt from GAB Premium Ent.",
          )}
        >
          <Share2 className="size-4" aria-hidden />
          {share.status === "sharing" ? "Opening…" : "Share the PDF"}
        </Button>
      )}

      {share.status === "failed" && <Alert tone="warning">{share.message}</Alert>}

      <div className="grid gap-2 sm:grid-cols-3">
        <Button
          variant={canShareFile ? "outline" : "primary"}
          onClick={() => window.open(state.whatsapp, "_blank", "noopener,noreferrer")}
        >
          <MessageCircle className="size-4" aria-hidden />
          {canShareFile ? "Send a link" : "Open WhatsApp"}
        </Button>

        <a
          href={pdfUrl}
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
