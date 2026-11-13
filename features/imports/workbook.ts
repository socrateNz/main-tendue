import "server-only";

import ExcelJS from "exceljs";

import { COUNTRY_CODES, countryName } from "@/lib/countries";
import { normalizeSearch } from "@/lib/text";

import { IMPORT_MAX_ROWS, IMPORT_SHEETS, LIST_VALUES, type ImportColumn, type ImportSheetKey } from "./spec";

/* ------------------------------------------------------------------ Modèle téléchargeable */

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
const REQUIRED_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4ED8" } };

/** `Worksheet.dataValidations.add(plage, …)` existe dans ExcelJS 4 mais n'est pas déclaré dans ses types. */
type RangeValidations = { add: (address: string, validation: ExcelJS.DataValidation) => void };
function rangeValidations(sheet: ExcelJS.Worksheet): RangeValidations {
  return (sheet as unknown as { dataValidations: RangeValidations }).dataValidations;
}

function columnLetter(index: number): string {
  let n = index;
  let letters = "";
  while (n > 0) {
    const rest = (n - 1) % 26;
    letters = String.fromCharCode(65 + rest) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** Génère le modèle d'import : feuille d'instructions, 4 feuilles de saisie, listes déroulantes. */
export async function buildImportTemplate(yearLabels: string[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Main Tendue";
  workbook.created = new Date();

  // Instructions
  const help = workbook.addWorksheet("Instructions", { properties: { tabColor: { argb: "FFF59E0B" } } });
  help.columns = [{ width: 28 }, { width: 16 }, { width: 90 }];
  help.addRow(["Modèle d'import — Main Tendue"]).font = { bold: true, size: 14 };
  help.addRow([
    "Remplissez les feuilles dans l'ordre : Établissements, Enfants, Sponsors, Parrainages. Les colonnes en bleu foncé sont obligatoires. " +
      "Ne renommez ni les feuilles ni les colonnes. L'import est refusé dans sa totalité tant qu'une ligne contient une erreur ; " +
      "les lignes déjà présentes dans l'application sont ignorées. Aucun versement ni dépense n'est importé.",
  ]);
  help.getCell("A2").alignment = { wrapText: true, vertical: "top" };
  help.mergeCells("A2:C2");
  help.getRow(2).height = 60;
  for (const sheet of IMPORT_SHEETS) {
    help.addRow([]);
    help.addRow([sheet.name, "", sheet.description]).font = { bold: true };
    for (const column of sheet.columns) help.addRow([column.header, column.required ? "Obligatoire" : "", column.help]);
  }

  // Listes (feuille masquée) : valeurs des listes déroulantes.
  const lists = workbook.addWorksheet("Listes", { state: "veryHidden" });
  const listData: Record<NonNullable<ImportColumn["list"]>, string[]> = {
    schoolTypes: [...LIST_VALUES.schoolTypes],
    sexes: [...LIST_VALUES.sexes],
    relationships: [...LIST_VALUES.relationships],
    sponsorKinds: [...LIST_VALUES.sponsorKinds],
    countries: COUNTRY_CODES.map((code) => countryName(code)).sort((a, b) => a.localeCompare(b, "fr")),
    years: yearLabels.length ? yearLabels : ["2025-2026"],
  };
  const listRanges = {} as Record<keyof typeof listData, string>;
  Object.entries(listData).forEach(([key, values], index) => {
    const letter = columnLetter(index + 1);
    values.forEach((value, row) => (lists.getCell(`${letter}${row + 1}`).value = value));
    listRanges[key as keyof typeof listData] = `Listes!$${letter}$1:$${letter}$${values.length}`;
  });

  // Feuilles de saisie
  for (const definition of IMPORT_SHEETS) {
    const sheet = workbook.addWorksheet(definition.name, { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = definition.columns.map((column) => ({ header: column.required ? `${column.header} *` : column.header, key: column.key, width: column.width ?? 18 }));
    const header = sheet.getRow(1);
    header.height = 22;
    definition.columns.forEach((column, index) => {
      const cell = header.getCell(index + 1);
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = column.required ? REQUIRED_FILL : HEADER_FILL;
      cell.alignment = { vertical: "middle" };
      if (column.help) cell.note = column.help;
      const range = `${columnLetter(index + 1)}2:${columnLetter(index + 1)}${IMPORT_MAX_ROWS + 1}`;
      if (column.list) {
        rangeValidations(sheet).add(range, {
          type: "list",
          allowBlank: !column.required,
          formulae: [listRanges[column.list]],
          showErrorMessage: column.list !== "countries",
          errorTitle: "Valeur non reconnue",
          error: "Choisissez une valeur dans la liste.",
        });
      }
      if (column.kind === "date") sheet.getColumn(index + 1).numFmt = "dd/mm/yyyy";
      if (column.kind === "amount") sheet.getColumn(index + 1).numFmt = "# ##0";
    });
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/* ------------------------------------------------------------------ Lecture d'un fichier reçu */

export type RawRow = { row: number; values: Record<string, string | number | Date | null> };
export type ReadResult = { sheets: Partial<Record<ImportSheetKey, RawRow[]>>; errors: string[]; totalRows: number };

const normalizeHeader = (value: string) => normalizeSearch(value.replace(/\*/g, ""));

/** Valeur exploitable d'une cellule ExcelJS (texte enrichi, lien, formule, date, nombre). */
function cellValue(value: ExcelJS.CellValue): string | number | Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") return value;
  if (typeof value === "string") return value.trim() === "" ? null : value.trim();
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("").trim() || null;
    if ("text" in value && typeof value.text === "string") return value.text.trim() || null;
    if ("result" in value) return cellValue(value.result as ExcelJS.CellValue);
    if ("error" in value) return null;
  }
  return null;
}

/** Lit le classeur : feuilles reconnues par leur nom, colonnes par leur en-tête. */
export async function readImportWorkbook(buffer: Buffer): Promise<ReadResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    return { sheets: {}, errors: ["Le fichier n'est pas un classeur Excel (.xlsx) lisible."], totalRows: 0 };
  }

  const errors: string[] = [];
  const sheets: ReadResult["sheets"] = {};
  let totalRows = 0;

  for (const definition of IMPORT_SHEETS) {
    const sheet = workbook.worksheets.find((ws) => normalizeSearch(ws.name) === normalizeSearch(definition.name));
    if (!sheet) continue; // feuille absente : rien à importer pour ce type

    const headerRow = sheet.getRow(1);
    const positions = new Map<string, number>();
    headerRow.eachCell((cell, col) => {
      const text = cellValue(cell.value);
      if (typeof text !== "string") return;
      const column = definition.columns.find((c) => normalizeHeader(c.header) === normalizeHeader(text));
      if (column) positions.set(column.key, col);
    });
    const missing = definition.columns.filter((c) => c.required && !positions.has(c.key)).map((c) => c.header);
    if (missing.length) {
      errors.push(`Feuille « ${definition.name} » : colonne(s) obligatoire(s) introuvable(s) : ${missing.join(", ")}.`);
      continue;
    }

    const rows: RawRow[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, number) => {
      if (number === 1) return;
      const values: RawRow["values"] = {};
      let filled = false;
      for (const column of definition.columns) {
        const position = positions.get(column.key);
        const value = position ? cellValue(row.getCell(position).value) : null;
        values[column.key] = value;
        if (value !== null) filled = true;
      }
      if (filled) rows.push({ row: number, values });
    });
    totalRows += rows.length;
    sheets[definition.key] = rows;
  }

  if (Object.keys(sheets).length === 0 && errors.length === 0) {
    errors.push("Aucune feuille reconnue : utilisez le modèle d'import (feuilles Établissements, Enfants, Sponsors, Parrainages).");
  }
  if (totalRows > IMPORT_MAX_ROWS) errors.push(`Le fichier contient ${totalRows} lignes : ${IMPORT_MAX_ROWS} maximum par import.`);
  return { sheets, errors, totalRows };
}
