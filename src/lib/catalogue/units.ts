/**
 * Units of measure.
 *
 * The schema stores this as free text on the product, which keeps the
 * door open for anything a supplier uses. This list is what the
 * interface offers, held in one place so a unit typed on one screen
 * matches a unit chosen on another.
 */
export const UNITS = [
  "piece", "pack", "box", "carton", "case", "dozen",
  "bottle", "bag", "crate", "sachet", "kilogram", "litre",
] as const;

export type Unit = (typeof UNITS)[number];

export function unitLabel(unit: string): string {
  return unit.charAt(0).toUpperCase() + unit.slice(1);
}

export type StockState = "in_stock" | "low_stock" | "out_of_stock";

/**
 * Stock health from the quantity actually available to sell, not what
 * is physically present: reserved units are already promised.
 */
export function stockState(available: number, reorderPoint: number): StockState {
  if (available <= 0) return "out_of_stock";
  if (available <= reorderPoint) return "low_stock";
  return "in_stock";
}

export const STOCK_LABELS: Record<StockState, string> = {
  in_stock: "In stock",
  low_stock: "Low stock",
  out_of_stock: "Out of stock",
};

/** Movement types, worded for people rather than for the database. */
export const MOVEMENT_LABELS: Record<string, string> = {
  receipt: "Received",
  issue: "Issued",
  adjustment_in: "Adjusted up",
  adjustment_out: "Adjusted down",
  transfer_in: "Transferred in",
  transfer_out: "Transferred out",
  customer_return: "Customer return",
  supplier_return: "Returned to supplier",
  damage: "Damaged",
  shortage: "Shortage",
};

/** Which way a movement moves stock. Mirrors movement_direction() in SQL. */
export function movementDirection(type: string): 1 | -1 {
  return ["receipt", "transfer_in", "customer_return", "adjustment_in"].includes(type) ? 1 : -1;
}
