/**
 * Turning rows into a CSV somebody opens in Excel.
 *
 * The part that matters is not the commas. A spreadsheet treats a cell
 * beginning with =, +, - or @ as a formula, so a product named
 * `=cmd|'/c calc'!A0` becomes an instruction the moment the file is
 * opened - and the person opening it is an accountant on an office
 * machine, not the person who typed the name.
 *
 * Every text cell is therefore neutralised before it is quoted. Numbers
 * are written as numbers, because quoting them would turn a column of
 * money into text that will not sum.
 */

/** Anything a spreadsheet might execute. */
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";

  // A number is written bare so the column still adds up. It cannot
  // carry a formula: it is not text by the time it gets here.
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (typeof value === "boolean") return value ? "yes" : "no";

  let text = String(value);

  // A leading apostrophe is how a spreadsheet is told "this is text".
  // The alternative - stripping the character - would quietly change a
  // product name or a note.
  if (FORMULA_START.test(text)) text = `'${text}`;

  // Quotes are doubled, and anything containing a comma, a quote or a
  // newline is wrapped.
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines = [columns.map((c) => cell(c.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => cell(c.value(row))).join(","));
  }
  // CRLF, because that is what Excel on Windows expects and what every
  // other reader tolerates.
  return lines.join("\r\n");
}

/**
 * A file name safe to put in a Content-Disposition header.
 *
 * Quotes, semicolons and control characters are removed rather than
 * escaped: a header a caller can influence is a header a caller can
 * split.
 */
export function csvFileName(...parts: (string | number)[]): string {
  const base = parts
    .map((p) => String(p))
    .join("-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
  return `${base || "report"}.csv`;
}

/** The response, with the header that makes a browser save rather than show it. */
export function csvResponse(body: string, fileName: string): Response {
  return new Response(
    // A byte order mark, so Excel reads it as UTF-8 rather than as the
    // local codepage. Without it a cedi sign arrives as mojibake.
    "﻿" + body,
    {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${fileName}"`,
        // A report is a snapshot of the moment it was asked for, and
        // these carry trading figures. Neither a browser nor anything in
        // between should keep a copy.
        "cache-control": "no-store, private",
      },
    },
  );
}
