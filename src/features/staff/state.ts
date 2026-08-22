/**
 * Shapes and initial values for the staff actions.
 *
 * Kept out of the "use server" module: such a file may export async
 * functions and nothing else, and a plain object there makes every
 * action in it fail at runtime rather than at build time.
 */
export interface StaffActionState {
  status: "idle" | "error" | "done";
  message?: string;
  /** Shown once after creation or reset, never retrievable later. */
  revealedPin?: string;
  staffName?: string;
}

export const INITIAL_STAFF_STATE: StaffActionState = { status: "idle" };
