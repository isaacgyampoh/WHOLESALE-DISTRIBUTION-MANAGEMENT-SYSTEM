"use client";

import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

/**
 * Opens the browser's print dialog, which is also how a PDF is produced
 * on every platform this business uses.
 *
 * A client component only because window.print() needs one; nothing
 * about the document itself is rendered here.
 */
export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <Button type="button" variant="secondary" size="sm" onClick={() => window.print()}>
      <Printer className="size-4" aria-hidden />
      {label}
    </Button>
  );
}
