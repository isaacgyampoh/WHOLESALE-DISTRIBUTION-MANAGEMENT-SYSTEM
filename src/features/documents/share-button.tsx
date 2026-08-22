"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Share2, Check } from "lucide-react";

/**
 * Sending a document to somebody.
 *
 * Uses the device's own share sheet where there is one, which on a phone
 * is how a receipt actually reaches a customer - WhatsApp, usually.
 * Where there is not, the link goes to the clipboard instead: a desktop
 * browser has no share sheet and pretending otherwise would leave the
 * button doing nothing.
 *
 * What is shared is the link, not the document. Anybody opening it still
 * has to be signed in, so a receipt forwarded to a customer shows them
 * nothing - which is why the print dialog, not this, is how a customer
 * gets their copy.
 */
export function ShareButton({ title, label = "Share" }: { title: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={async () => {
        const url = window.location.href;
        if (navigator.share) {
          try {
            await navigator.share({ title, url });
            return;
          } catch {
            // Dismissed, or refused. Fall through to the clipboard
            // rather than leaving the button looking broken.
          }
        }
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check className="size-4" aria-hidden /> : <Share2 className="size-4" aria-hidden />}
      {copied ? "Link copied" : label}
    </Button>
  );
}
