/**
 * Shapes and initial values for the commercial actions.
 *
 * Kept out of the "use server" module: such a file may export async
 * functions and nothing else, and a plain object there makes every
 * action in it fail at runtime rather than at build time.
 */
export interface CommercialState {
  status: "idle" | "error" | "done";
  message?: string;
  /** Kept so a rejected form does not lose what was typed. */
  values?: Record<string, string>;
  fieldErrors?: Record<string, string>;
  /** Set when the action created something the screen should link to. */
  createdId?: string;

  /**
   * A recorded credit payment, so the screen can offer its receipt
   * immediately rather than sending the collector to find it again.
   */
  paymentId?: string;
  customerName?: string;
  customerPhone?: string | null;
}

export const INITIAL_COMMERCIAL_STATE: CommercialState = { status: "idle" };
