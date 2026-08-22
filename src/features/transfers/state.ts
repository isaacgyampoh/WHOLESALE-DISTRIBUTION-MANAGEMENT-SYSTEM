/**
 * Shapes and initial values for the transfer actions.
 *
 * Kept out of the "use server" module: such a file may export async
 * functions and nothing else.
 */
export interface TransferState {
  status: "idle" | "error" | "done";
  message?: string;
  values?: Record<string, string>;
  fieldErrors?: Record<string, string>;
  createdId?: string;
}

export const INITIAL_TRANSFER_STATE: TransferState = { status: "idle" };
