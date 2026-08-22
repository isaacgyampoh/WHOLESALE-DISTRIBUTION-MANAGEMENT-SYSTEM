/**
 * What a query hands back.
 *
 * Reads never throw at the caller. A failure carries a message already
 * safe to show, because the technical detail was logged at the point it
 * happened and deliberately left there. A page can therefore render a
 * partial screen - a working table beside a panel that could not load -
 * instead of collapsing to an error boundary.
 */
export type Result<T> = { ok: true; data: T } | { ok: false; message: string };

/** Log the cause, return the sentence the user sees. */
export function failed(scope: string, error: unknown, message: string): { ok: false; message: string } {
  console.error(`[${scope}]`, error);
  return { ok: false, message };
}
