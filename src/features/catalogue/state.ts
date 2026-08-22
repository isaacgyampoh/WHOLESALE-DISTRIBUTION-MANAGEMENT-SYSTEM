/**
 * Shapes and initial values for the catalogue actions.
 *
 * Kept out of the "use server" module: such a file may export async
 * functions and nothing else, and a plain object there makes every
 * action in it fail at runtime rather than at build time.
 */
export interface CatalogueState {
  status: "idle" | "error" | "done";
  message?: string;
  /** Kept so a rejected form does not lose what was typed. */
  values?: Record<string, string>;
  fieldErrors?: Record<string, string>;
  createdId?: string;
}

export const INITIAL_CATALOGUE_STATE: CatalogueState = { status: "idle" };
