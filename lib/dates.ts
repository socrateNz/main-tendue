/**
 * Dates « calendaires » (jour sans heure) : périodes d'années scolaires, dates d'opérations.
 *
 * Elles sont stockées à minuit UTC et comparées au jour près, ce qui évite tout décalage lié au
 * fuseau horaire (une date saisie le 1er septembre reste le 1er septembre partout).
 * Module pur, partagé client / serveur.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
export const DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** "2025-09-01" → Date à 2025-09-01T00:00:00Z ; null si la date n'existe pas. */
export function parseDateInput(value: string): Date | null {
  if (!DATE_INPUT_PATTERN.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

/** Date → "2025-09-01" (valeur d'un champ <input type="date">). */
export function toDateInput(date: Date | string): string {
  return new Date(date).toISOString().slice(0, 10);
}

/** Ramène un instant au jour calendaire UTC correspondant. */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Vrai si `date` appartient à la période [start, end] (bornes incluses, au jour près). */
export function isWithinPeriod(date: Date, start: Date, end: Date): boolean {
  const day = startOfUtcDay(date).getTime();
  return day >= startOfUtcDay(start).getTime() && day <= startOfUtcDay(end).getTime();
}

/** Vrai si les périodes [aStart, aEnd] et [bStart, bEnd] ont au moins un jour en commun. */
export function periodsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return startOfUtcDay(aStart) <= startOfUtcDay(bEnd) && startOfUtcDay(bStart) <= startOfUtcDay(aEnd);
}

/** Lendemain de `date` à minuit UTC : borne exclusive pour les requêtes `{ $lt }`. */
export function nextUtcDay(date: Date): Date {
  return new Date(startOfUtcDay(date).getTime() + DAY_MS);
}

const longFormatter = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const shortFormatter = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const dateTimeFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Africa/Douala",
});

/** « 1 septembre 2025 » */
export function formatDate(date: Date | string): string {
  return longFormatter.format(new Date(date));
}

/** « 01/09/2025 » */
export function formatShortDate(date: Date | string): string {
  return shortFormatter.format(new Date(date));
}

/** Horodatage d'un événement (audit), heure d'Afrique centrale : « 11 nov. 2026, 14:05 » */
export function formatDateTime(date: Date | string): string {
  return dateTimeFormatter.format(new Date(date));
}

/** « 1 sept. 2025 → 30 juin 2026 » */
export function formatPeriod(start: Date | string, end: Date | string): string {
  return `${formatShortDate(start)} → ${formatShortDate(end)}`;
}
