/**
 * Shapes and initial values for the supplier actions.
 *
 * Kept out of the "use server" module: such a file may export async
 * functions and nothing else.
 */
export interface SupplierState {
  status: "idle" | "error" | "done";
  message?: string;
  values?: Record<string, string>;
  fieldErrors?: Record<string, string>;
  /**
   * A newly issued portal link, in full and for the only time it will
   * ever be shown. It is not stored anywhere in this form.
   */
  issuedLink?: string;
}

export const INITIAL_SUPPLIER_STATE: SupplierState = { status: "idle" };
