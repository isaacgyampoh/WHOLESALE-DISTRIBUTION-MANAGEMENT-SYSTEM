/**
 * Shapes and initial values for the document actions.
 *
 * Kept out of the "use server" module: such a file may export async
 * functions and nothing else.
 */
export interface DocumentState {
  status: "idle" | "error" | "done";
  message?: string;
  values?: Record<string, string>;
  fieldErrors?: Record<string, string>;
  /** The waybill just issued, so the screen can link straight to it. */
  createdId?: string;
}

export const INITIAL_DOCUMENT_STATE: DocumentState = { status: "idle" };
