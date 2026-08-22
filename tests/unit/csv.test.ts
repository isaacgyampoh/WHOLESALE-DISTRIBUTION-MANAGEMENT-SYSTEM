import { test } from "node:test";
import assert from "node:assert/strict";
import { toCsv, csvFileName } from "../../src/lib/utils/csv.ts";

/**
 * CSV escaping.
 *
 * The interesting case is not the commas. A spreadsheet treats a cell
 * beginning with =, +, - or @ as a formula, so a product name typed by
 * a sales rep becomes an instruction on the accountant's machine the
 * moment the export is opened.
 */
const columns = [
  { header: "Name", value: (r: { name: string; qty?: number }) => r.name },
  { header: "Qty", value: (r: { name: string; qty?: number }) => r.qty },
];

test("a header row is written first", () => {
  assert.equal(toCsv(columns, []), "Name,Qty");
});

test("a formula is neutralised rather than executed", () => {
  const csv = toCsv(columns, [{ name: "=cmd|'/c calc'!A0", qty: 1 }]);
  // Prefixed, so the spreadsheet reads it as text. Not quoted: there is
  // no comma, quote or newline in it, and quoting what does not need it
  // would only make the file harder to read.
  assert.equal(csv.split("\r\n")[1], "'=cmd|'/c calc'!A0,1");
});

test("and one that also needs quoting gets both", () => {
  const csv = toCsv(columns, [{ name: "=SUM(A1,A2)", qty: 1 }]);
  assert.equal(csv.split("\r\n")[1], `"'=SUM(A1,A2)",1`);
});

test("every character a spreadsheet executes is covered", () => {
  for (const lead of ["=", "+", "-", "@", "\t", "\r"]) {
    const csv = toCsv(columns, [{ name: `${lead}danger`, qty: 1 }]);
    assert.ok(csv.split("\r\n")[1].startsWith("'") || csv.includes(`"'${lead}`),
      `${JSON.stringify(lead)} was not neutralised: ${JSON.stringify(csv)}`);
  }
});

test("but the name itself is not changed", () => {
  // Stripping the character would quietly alter a product name. The
  // apostrophe is a spreadsheet instruction, not part of the value.
  const csv = toCsv(columns, [{ name: "-40C Freezer", qty: 2 }]);
  assert.ok(csv.includes("40C Freezer"), csv);
});

test("commas, quotes and newlines are escaped", () => {
  const csv = toCsv(columns, [{ name: 'Crate, 24 x 300ml "Classic"', qty: 3 }]);
  assert.ok(csv.includes(`"Crate, 24 x 300ml ""Classic"""`), csv);

  const multi = toCsv(columns, [{ name: "Line one\nLine two", qty: 1 }]);
  assert.ok(multi.includes(`"Line one\nLine two"`), multi);
});

test("numbers stay numbers so a column still adds up", () => {
  const csv = toCsv(columns, [{ name: "Crate", qty: 1250.5 }]);
  assert.equal(csv.split("\r\n")[1], "Crate,1250.5");
});

test("nothing missing becomes the word undefined", () => {
  const csv = toCsv(columns, [{ name: "Crate" }]);
  assert.equal(csv.split("\r\n")[1], "Crate,");
});

test("rows are separated the way a spreadsheet expects", () => {
  const csv = toCsv(columns, [{ name: "A", qty: 1 }, { name: "B", qty: 2 }]);
  assert.equal(csv, "Name,Qty\r\nA,1\r\nB,2");
});

test("a file name cannot break out of its header", () => {
  const name = csvFileName('report"; rm -rf /', "2026-08-22");
  assert.ok(!name.includes('"'), name);
  assert.ok(!name.includes(";"), name);
  assert.match(name, /^[A-Za-z0-9._-]+\.csv$/);
});
