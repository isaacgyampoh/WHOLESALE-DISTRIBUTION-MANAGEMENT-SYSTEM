/**
 * Shapes and initial values for the distribution actions.
 *
 * Kept out of the "use server" module: such a file may export async
 * functions and nothing else, and a plain object there makes every
 * action in it fail at runtime rather than at build time.
 */
export interface DistributionState {
  status: "idle" | "error" | "done";
  message?: string;
  /** Kept so a rejected form does not lose what was typed. */
  values?: Record<string, string>;
  fieldErrors?: Record<string, string>;
  /** Set when the action created something the screen should link to. */
  createdId?: string;
  createdNumber?: string;
}

export const INITIAL_DISTRIBUTION_STATE: DistributionState = { status: "idle" };


/**
 * Why goods came back.
 *
 * Here rather than in queries.ts because the form that offers these is a
 * client component, and queries.ts is server-only - importing it from
 * the browser drags the Supabase server client into the bundle.
 */
export const RETURN_REASONS = [
  { value: "damaged", label: "Damaged" },
  { value: "expired", label: "Expired" },
  { value: "wrong_item", label: "Wrong item" },
  { value: "customer_return", label: "Customer changed their mind" },
  { value: "unsold", label: "Unsold stock" },
  { value: "other", label: "Other" },
] as const;

export const REASON_LABELS: Record<string, string> =
  Object.fromEntries(RETURN_REASONS.map((r) => [r.value, r.label]));
