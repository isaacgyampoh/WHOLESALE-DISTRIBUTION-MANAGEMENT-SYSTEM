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
