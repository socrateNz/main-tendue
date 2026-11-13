/**
 * Conversion des cellules Excel vers les formats attendus par les validations de l'application.
 * Module pur (testé unitairement). Toute valeur non reconnue donne `null` et produit une erreur
 * explicite au niveau de la ligne : rien n'est deviné silencieusement.
 */

import { COUNTRY_CODES, countryName } from "@/lib/countries";
import { parseDateInput, toDateInput } from "@/lib/dates";
import { normalizeSearch } from "@/lib/text";

export type Cell = string | number | Date | null | undefined;

export function text(value: Cell): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return toDateInput(value);
  return String(value).trim();
}

/** Date Excel, « JJ/MM/AAAA », « J/M/AAAA » ou « AAAA-MM-JJ » → « AAAA-MM-JJ » ; null si invalide. */
export function dateValue(value: Cell): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : toDateInput(value);
  const raw = String(value).trim();
  const french = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(raw);
  const candidate = french ? `${french[3]}-${french[2].padStart(2, "0")}-${french[1].padStart(2, "0")}` : raw;
  return parseDateInput(candidate) ? candidate : null;
}

/** Montant FCFA entier (« 100000 », « 100 000 », 100000) ; null si vide, NaN si invalide. */
export function amountValue(value: Cell): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : Number.NaN;
  const digits = String(value).replace(/[\s  ]/g, "").replace(/fcfa|xaf/i, "");
  return /^\d{1,13}$/.test(digits) ? Number(digits) : Number.NaN;
}

/** Retrouve un code à partir de son libellé (ou du code lui-même), sans tenir compte des accents ni de la casse. */
export function codeFromLabel<T extends string>(value: Cell, labels: Record<T, string>): T | null {
  const wanted = normalizeSearch(text(value));
  if (!wanted) return null;
  for (const [code, label] of Object.entries(labels) as Array<[T, string]>) {
    if (normalizeSearch(label) === wanted || normalizeSearch(code) === wanted) return code;
  }
  return null;
}

const COUNTRY_BY_NAME = new Map(COUNTRY_CODES.map((code) => [normalizeSearch(countryName(code)), code]));

/** Pays : code ISO (« FR ») ou nom français (« France », « Côte d'Ivoire »). */
export function countryValue(value: Cell): string | null {
  const raw = text(value);
  if (!raw) return null;
  if (/^[A-Za-z]{2}$/.test(raw) && COUNTRY_CODES.includes(raw.toUpperCase())) return raw.toUpperCase();
  return COUNTRY_BY_NAME.get(normalizeSearch(raw)) ?? null;
}
