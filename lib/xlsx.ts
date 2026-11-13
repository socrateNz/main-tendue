import "server-only";

import ExcelJS from "exceljs";

/** Classeur Excel simple (une feuille, en-tête figé et formats numériques par colonne). */
export type XlsxColumn = { label: string; kind?: "text" | "money" | "number" | "percent"; width?: number };
export type XlsxValue = string | number | null | undefined;

const FORMATS: Record<NonNullable<XlsxColumn["kind"]>, string | undefined> = {
  text: undefined,
  money: "# ##0",
  number: "# ##0",
  percent: '0.0" %"',
};

export async function toXlsx(sheetName: string, columns: readonly XlsxColumn[], rows: ReadonlyArray<readonly XlsxValue[]>, options: { title?: string; totalsRow?: boolean } = {}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Main Tendue";
  workbook.created = new Date();
  // Nom de feuille : 31 caractères maximum, sans caractères interdits par Excel.
  const sheet = workbook.addWorksheet(sheetName.replace(/[\/?*[\]:]/g, " ").slice(0, 31) || "Feuille", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columns.map((column) => ({ header: column.label, width: column.width ?? Math.min(Math.max(column.label.length + 4, 12), 40) }));
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
  columns.forEach((column, index) => {
    const format = FORMATS[column.kind ?? "text"];
    if (format) sheet.getColumn(index + 1).numFmt = format;
  });
  for (const row of rows) sheet.addRow(row.map((value) => (value === undefined ? null : value)));
  if (options.totalsRow && rows.length) sheet.lastRow!.font = { bold: true };
  if (options.title) workbook.title = options.title;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
