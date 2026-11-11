/**
 * Export CSV compatible Excel (France) : séparateur « ; », BOM UTF-8 (accents corrects à
 * l'ouverture), montants en entiers sans séparateur de milliers (recalculables dans Excel).
 * Protection contre l'injection de formules : une cellule commençant par = + - @ est préfixée.
 */

export type CsvValue = string | number | null | undefined;

function cell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: ReadonlyArray<readonly CsvValue[]>): string {
  return "﻿" + [header, ...rows].map((row) => row.map(cell).join(";")).join("\r\n") + "\r\n";
}
