/**
 * The quantity formatter, on its own.
 *
 * This module decides how every stock figure in the system reads, and
 * it had no test of its own. The database suite had a second copy of
 * the plural rule written inside it, which asserted "10 Boxes" and
 * passed - while the application said "26 Boxs" on a screen listing
 * what had gone missing off a van. Two implementations of one rule, and
 * the one nobody could see was the one customers read.
 *
 * Node runs the TypeScript directly, so these test the real module
 * rather than another copy of it.
 *
 *   node tests/unit/test_quantity.mjs
 */
const q = await import("../../src/lib/catalogue/quantity.ts");

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n} ${x}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };
const head = (t) => console.log(`\n=== ${t} ===`);
const is = (name, actual, expected) =>
  ok(name, actual === expected, actual === expected ? "" : `got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`);

// ===================================================================
head("units are spelled the way the business typed them");
{
  const h = (units, unit) => q.formatHolding({ units, pieces: 0 }, unit);
  is("one carton", h(1, "carton"), "1 Carton");
  is("three cartons", h(3, "carton"), "3 Cartons");
  // The one that was wrong on screen.
  is("a box pluralises to boxes", h(26, "box"), "26 Boxes");
  is("and one box stays a box", h(1, "box"), "1 Box");
  is("a case becomes cases", h(4, "case"), "4 Cases");
  is("a bunch becomes bunches", h(2, "bunch"), "2 Bunches");
  is("a dozen becomes dozens", h(5, "dozen"), "5 Dozens");
  // Consonant then y.
  is("a jerry becomes jerries", h(3, "jerry"), "3 Jerries");
  // Vowel then y keeps the y.
  is("a tray stays trays", h(3, "tray"), "3 Trays");
  is("an unnamed unit still reads", h(2, ""), "2 Units");
}

// ===================================================================
head("both halves, and only when both are there");
{
  is("units alone", q.formatHolding({ units: 10, pieces: 0 }, "box"), "10 Boxes");
  is("pieces alone", q.formatHolding({ units: 0, pieces: 5 }, "box"), "5 Pieces");
  is("both", q.formatHolding({ units: 10, pieces: 5 }, "box"), "10 Boxes + 5 Pieces");
  is("one of each", q.formatHolding({ units: 1, pieces: 1 }, "box"), "1 Box + 1 Piece");
  is("nothing says so in words",
     q.formatHolding({ units: 0, pieces: 0 }, "box"), "None");
  is("and takes the caller's word for it",
     q.formatHolding({ units: 0, pieces: 0 }, "box", { empty: "-" }), "-");
}

// ===================================================================
head("a pack size is a fact, not a default");
{
  is("1 is unconfigured, not one per case", q.packSize(1), null);
  is("as is nothing at all", q.packSize(null), null);
  is("12 is twelve", q.packSize(12), 12);
  is("no total without one", q.asPieces({ units: 3, pieces: 2 }, 1), null);
  is("with one, the total", q.asPieces({ units: 3, pieces: 2 }, 12), 38);
}

// ===================================================================
head("what has to be opened to sell a single");
{
  is("nothing, when the loose stock covers it", q.unitsToOpen(3, 5, 24), 0);
  is("nor when it covers it exactly", q.unitsToOpen(5, 5, 24), 0);
  is("one carton for the two beyond it", q.unitsToOpen(7, 5, 24), 1);
  is("twenty-four is one carton", q.unitsToOpen(24, 0, 24), 1);
  is("twenty-five is two", q.unitsToOpen(25, 0, 24), 2);
  // Null is a refusal, not a zero: there is no answer without a pack size.
  is("no pack size, no answer", q.unitsToOpen(3, 0, 1), null);
  is("but none needed when none are wanted", q.unitsToOpen(0, 0, 1), 0);
}

// ===================================================================
head("the two halves of a till share one ceiling");
{
  const held = { units: 4, pieces: 0 };
  is("every carton can be opened", q.sellablePieces(held, 12), 48);
  is("less the ones already being sold whole", q.sellablePieces(held, 12, 2), 24);
  is("none, where no pack size says how many are inside", q.sellablePieces(held, 1), 0);
  is("but the loose ones always count", q.sellablePieces({ units: 4, pieces: 6 }, 1), 6);
  is("whole units, less what the singles cost", q.sellableUnits(held, 13, 12), 2);
  is("and all of them when no singles are wanted", q.sellableUnits(held, 0, 12), 4);
}

// ===================================================================
head("whether a product can be sold by the piece at all");
{
  is("a product sold by the piece has no second half",
     q.singlesReadiness("piece", 5, 12), "not_applicable");
  is("no piece price, no singles", q.singlesReadiness("carton", null, 12), "no_price");
  is("nor at zero", q.singlesReadiness("carton", 0, 12), "no_price");
  is("priced but unmeasured sells only what is already loose",
     q.singlesReadiness("carton", 5, 1), "loose_only");
  is("priced and measured is ready", q.singlesReadiness("carton", 5, 12), "ready");
}

// ===================================================================
head("moving stock about is judged differently from selling it");
{
  // covers() is for a transfer or a count, where nobody is standing
  // over the carton with a knife.
  ok("two cartons do not cover three loose pieces",
     !q.covers({ units: 2, pieces: 0 }, { units: 0, pieces: 3 }));
  ok("but three loose pieces cover three",
     q.covers({ units: 0, pieces: 3 }, { units: 0, pieces: 3 }));
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
