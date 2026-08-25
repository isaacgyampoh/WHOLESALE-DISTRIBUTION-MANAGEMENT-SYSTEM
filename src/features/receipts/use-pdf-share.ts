"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Handing over the receipt as a file, not a link.
 *
 * The share sheet can carry an actual PDF - navigator.share accepts
 * files - and that is what a customer wants: something in their
 * WhatsApp, on their phone, that still opens when the signal does not.
 *
 * TWO THINGS MAKE THIS AWKWARD, AND BOTH ARE HANDLED HERE.
 *
 * The file has to exist before the tap. Safari on iOS only honours
 * navigator.share when it is called during the gesture that triggered
 * it, and awaiting a fetch first spends that gesture: by the time the
 * PDF arrives the browser has stopped listening and the sheet never
 * opens. So the PDF is fetched as soon as the receipt exists and held
 * ready, and the handler shares something it already has.
 *
 * Not every browser can share files. Desktop Firefox has no share sheet
 * at all, and some that do refuse files. canShare({ files }) is the only
 * honest test, and where it says no the caller falls back to a download
 * and a link rather than offering a button that quietly does nothing.
 */

export type ShareState =
  | { status: "unsupported" }        // No file sharing here; download instead.
  | { status: "loading" }            // Fetching the PDF.
  | { status: "ready" }              // A file is in hand; the sheet will open.
  | { status: "sharing" }
  | { status: "failed"; message: string };

export function usePdfShare(pdfUrl: string | undefined, fileName: string) {
  const [state, setState] = useState<ShareState>({ status: "loading" });
  const file = useRef<File | null>(null);

  // Fetched the moment there is something to fetch, so the file is
  // already in hand when the button is pressed.
  useEffect(() => {
    if (!pdfUrl) return;

    let cancelled = false;
    // The ref is cleared rather than the state set: a synchronous
    // setState here would re-render before the effect has done
    // anything, and "loading" is already where this starts. Clearing
    // the file is what actually matters - it stops a stale PDF being
    // shared if the receipt changes underneath.
    file.current = null;

    (async () => {
      try {
        const response = await fetch(pdfUrl);
        if (!response.ok) throw new Error(`status ${response.status}`);

        const blob = await response.blob();
        if (cancelled) return;

        const pdf = new File([blob], fileName, { type: "application/pdf" });

        // Asked about this actual file rather than a stand-in: some
        // browsers accept the call and refuse the payload.
        const supported =
          typeof navigator !== "undefined" &&
          typeof navigator.canShare === "function" &&
          navigator.canShare({ files: [pdf] });

        file.current = pdf;
        setState(supported ? { status: "ready" } : { status: "unsupported" });
      } catch {
        if (!cancelled) setState({ status: "unsupported" });
      }
    })();

    return () => { cancelled = true; };
  }, [pdfUrl, fileName]);

  const share = useCallback(async (title: string, text?: string) => {
    if (!file.current) return false;

    setState({ status: "sharing" });
    try {
      await navigator.share({ files: [file.current], title, text });
      setState({ status: "ready" });
      return true;
    } catch (error) {
      // A dismissed sheet is not a failure - the person closed
      // something they opened - and must not be reported as one.
      const aborted = error instanceof DOMException && error.name === "AbortError";
      setState(aborted
        ? { status: "ready" }
        : { status: "failed", message: "The share sheet could not be opened." });
      return false;
    }
  }, []);

  return {
    state,
    share,
    canShareFile: state.status === "ready" || state.status === "sharing",
  };
}
