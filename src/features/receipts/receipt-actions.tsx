"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Link2, Check, Share2 } from "lucide-react";

/**
 * What the customer can do with their own receipt.
 *
 * Download is first because it is the thing they came for and the thing
 * that survives: a file on the phone still opens next month when the
 * link has expired. Sharing is offered where the device has a share
 * sheet, and the link goes to the clipboard where it does not - a
 * desktop browser has no share sheet and a button that does nothing is
 * worse than one that is not there.
 */
export function ReceiptActions({
  token, receiptNumber,
}: {
  token: string;
  receiptNumber: string;
}) {
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState<boolean | null>(null);

  // Read on first paint rather than during render: navigator does not
  // exist on the server and the answer must not differ between the two.
  if (canShare === null && typeof navigator !== "undefined") {
    setCanShare(typeof navigator.share === "function");
  }

  const pdfHref = `/receipt/${token}/pdf`;

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
        {canShare && (
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await navigator.share({
                  title: `Receipt ${receiptNumber}`,
                  url: window.location.href,
                });
              } catch {
                // Dismissed. Nothing to report: the customer closed a
                // sheet they opened.
              }
            }}
          >
            <Share2 className="size-4" aria-hidden />
            Share
          </Button>
        )}

        <Button
          variant="outline"
          className={canShare ? "" : "col-span-2"}
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
