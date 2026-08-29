/**
 * A quantity is two numbers, not one.
 *
 * This business holds ten cartons and five loose pieces. That is not
 * fifteen of anything, and it is not seventy-five: the cartons are
 * sealed and the pieces are not, and the difference is the whole point.
 * Every screen that shows or takes a stock figure goes through here so
 * that the two halves are never quietly added together.
 *
 * WHAT PIECES-PER-UNIT IS FOR
 *
 * products.units_per_case says how many pieces come out of one full
 * unit. It is 1 until somebody configures it, and while it is 1 there is
 * nothing to convert: a piece and a carton are the same size, so the
 * second number is simply unused.
 *
 * Even when it is configured, nothing here converts on its own.
 * Breaking a carton open is a physical act that changes what is on the
 * shelf, and it is recorded as a movement like any other. A screen that
 * silently turned one carton into twelve pieces because the arithmetic
 * worked would be inventing stock that nobody opened.
 */

export interface Quantity {
  /** Full, unopened units - cartons, boxes, bags. */
  units: number;
  /** Loose pieces, outside any full unit. */
  pieces: number;
}

export const NOTHING: Quantity = { units: 0, pieces: 0 };

/** Whether anything is here at all. */
export function isEmpty(q: Quantity): boolean {
  return q.units <= 0 && q.pieces <= 0;
}

export function addQuantity(a: Quantity, b: Quantity): Quantity {
  return { units: a.units + b.units, pieces: a.pieces + b.pieces };
}

export function subtractQuantity(a: Quantity, b: Quantity): Quantity {
  return { units: a.units - b.units, pieces: a.pieces - b.pieces };
}

/**
 * The pack size, or null when there isn't one.
 *
 * 1 means unconfigured rather than "one piece per carton" - the column
 * defaults to 1 for every product, so treating it as a real pack size
 * would claim every carton holds exactly one piece.
 */
/**
 * Whether this product can hold loose pieces at all.
 *
 * It can when it has a parent unit to be loose *from* - a box, a
 * carton, a bag. A product sold by the piece has no second quantity:
 * every one of them is already a piece.
 *
 * Deliberately not a question about pack size. Pack size says how many
 * pieces come out of one box, and it is needed only to open one - the
 * conversion. A business can perfectly well hold three boxes and four
 * loose pieces, and sell either, without ever having told the system
 * how many pieces a box contains. Gating loose pieces on pack size
 * refuses exactly that, which is the common case.
 */
export function holdsPieces(unit: string | null | undefined): boolean {
  const name = (unit ?? "").trim().toLowerCase();
  return name !== "" && name !== "piece";
}

export function packSize(piecesPerUnit: number | null | undefined): number | null {
  const size = Number(piecesPerUnit ?? 1);
  return Number.isFinite(size) && size > 1 ? Math.floor(size) : null;
}

/**
 * The whole holding counted in pieces, for the products where that
 * means something. Null when no pack size is configured, because then
 * the question has no answer - and a caller that gets null must show
 * the two numbers rather than guess.
 */
export function asPieces(q: Quantity, piecesPerUnit: number | null | undefined): number | null {
  const size = packSize(piecesPerUnit);
  if (size === null) return null;
  return q.units * size + q.pieces;
}

/**
 * How many full units are worth of loose pieces - what would be gained
 * by packing the loose ones back up. Only meaningful with a pack size,
 * and only ever offered as a suggestion for someone to act on.
 */
export function loosePacksInto(q: Quantity, piecesPerUnit: number | null | undefined): number {
  const size = packSize(piecesPerUnit);
  if (size === null) return 0;
  return Math.floor(q.pieces / size);
}

function plural(n: number, word: string): string {
  const label = n === 1 ? word : `${word}s`;
  return `${n.toLocaleString()} ${label}`;
}

/** "Carton" from "carton", for use mid-sentence. */
function unitWord(unit: string): string {
  const trimmed = (unit ?? "").trim() || "unit";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * How a holding reads on screen: "10 Cartons + 5 Pieces".
 *
 * Both halves appear only when both are there. Ten cartons and no loose
 * pieces reads "10 Cartons", because "10 Cartons + 0 Pieces" makes a
 * shelf look more complicated than it is. Nothing at all reads "None"
 * rather than "0", which is a quantity somebody has to interpret.
 */
export function formatHolding(
  q: Quantity,
  unit: string,
  options: { empty?: string } = {},
): string {
  const units = Math.trunc(q.units);
  const pieces = Math.trunc(q.pieces);

  if (units === 0 && pieces === 0) return options.empty ?? "None";

  const parts: string[] = [];
  if (units !== 0) parts.push(plural(units, unitWord(unit)));
  // A product sold by the piece has "piece" as its unit already; saying
  // "3 Pieces + 2 Pieces" would be nonsense, so the loose half is only
  // named separately when it is actually a different thing.
  if (pieces !== 0) parts.push(plural(pieces, "Piece"));

  return parts.join(" + ");
}

/**
 * The same, with the pack size spelled out for the products that have
 * one: "10 Cartons + 5 Pieces (125 pieces)". Used where the total is
 * the useful figure - a count sheet, a stock report - and left off
 * everywhere the two numbers are what matter.
 */
export function formatHoldingWithTotal(
  q: Quantity,
  unit: string,
  piecesPerUnit: number | null | undefined,
  options: { empty?: string } = {},
): string {
  const text = formatHolding(q, unit, options);
  const total = asPieces(q, piecesPerUnit);
  // Only worth saying when the two differ - for a piece-only holding the
  // total repeats what is already on screen.
  if (total === null || q.units === 0) return text;
  return `${text} (${total.toLocaleString()} pieces)`;
}

/** How the pack size reads where it is configured: "12 pieces per Carton". */
export function formatPackSize(unit: string, piecesPerUnit: number | null | undefined): string | null {
  const size = packSize(piecesPerUnit);
  if (size === null) return null;
  return `${size.toLocaleString()} pieces per ${unitWord(unit).toLowerCase()}`;
}

/**
 * Reading a quantity off a form.
 *
 * Both fields are optional on their own and at least one must be filled,
 * which is the rule the database enforces too: a movement of nothing is
 * a mistake rather than a record. Blank counts as zero so that somebody
 * entering only cartons need not type a 0 for pieces.
 */
export function readQuantity(
  unitsRaw: unknown,
  piecesRaw: unknown,
): { ok: true; value: Quantity } | { ok: false; field: "units" | "pieces"; message: string } {
  const read = (raw: unknown, field: "units" | "pieces") => {
    const text = String(raw ?? "").trim();
    if (text === "") return { ok: true as const, value: 0 };
    if (!/^\d+$/.test(text)) {
      return {
        ok: false as const,
        field,
        message: "Enter a whole number, zero or more.",
      };
    }
    return { ok: true as const, value: Number(text) };
  };

  const units = read(unitsRaw, "units");
  if (!units.ok) return units;
  const pieces = read(piecesRaw, "pieces");
  if (!pieces.ok) return pieces;

  return { ok: true, value: { units: units.value, pieces: pieces.value } };
}

/**
 * Whether a holding covers what is being asked of it.
 *
 * Independent, and deliberately so: two cartons and no loose pieces
 * does not satisfy a request for three pieces, even where twelve pieces
 * would come out of a carton, because until somebody opens that carton
 * the pieces do not exist. The caller is told what is actually there
 * and can offer to open one.
 */
export function covers(held: Quantity, wanted: Quantity): boolean {
  return held.units >= wanted.units && held.pieces >= wanted.pieces;
}
