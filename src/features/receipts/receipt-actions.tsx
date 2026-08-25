"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { usePdfShare } from "./use-pdf-share";
import { Download, Link2, Check, Share2 } from "lucide-react";

/**
 * What the customer can do with their own receipt.
 *
 * Download is first because it is the thing they came for and the thing
 * that survives: a file on the phone still opens next month, when the
 * link has expired.
 *
 * Sharing sends the PDF itself where the device can carry one - so a
 * customer forwarding a receipt to whoever pays their bills sends the
 * document, not a link that only works while the token lives. Where
 * files cannot be shared the link goes to the clipboard instead, and no
 * button is offered that would quietly do nothing.
 */
export function ReceiptActions({
  token, receiptNumber,
}: {
  token: string;
  receiptNumber: string;
}) {
  const [copied, setCopied] = useState(false);
  const pdfHref = `/receipt/${token}/pdf`;

  // The file is fetched as soon as the page is up, so the share sheet
  // opens inside the tap rather than after it - which is the only way
  // Safari honours it. See use-pdf-share.
  const { state: share, share: sharePdf, canShareFile } =
    usePdfShare(pdfHref, `receipt-${receiptNumber}.pdf`);

  return (
    <div className="space-y-2.5">
      {/*
        An anchor, not a button that navigates: the PDF opens in the
        phone's own viewer, where "save" and "share" are where people
        already expect them. Styled to match the primary button.
      */}
      <a
        href={pdfHref}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-panel)] bg-brand-700 text-sm font-medium text-white transition-colors hover:bg-brand-800 active:bg-brand-900 focus-visible:ring-2 focus-visible:ring-brand-600/40 focus-visible:outline-none"
      >
        <Download className="size-4" aria-hidden />
        Download PDF
      </a>

      <div className="grid grid-cols-2 gap-2.5">
        {canShareFile && (
          <Button
            variant="outline"
            loading={share.status === "sharing"}
            onClick={() => sharePdf(`Receipt ${receiptNumber}`)}
          >
            <Share2 className="size-4" aria-hidden />
            {share.status === "sharing" ? "Opening…" : "Share PDF"}
          </Button>
        )}

        <Button
          variant="outline"
          className={canShareFile ? "" : "col-span-2"}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(window.location.href);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              // Clipboard access can be refused; the link is in the
              // address bar either way.
              setCopied(false);
            }
          }}
        >
          {copied ? <Check className="size-4" aria-hidden /> : <Link2 className="size-4" aria-hidden />}
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
    </div>
  );
}
