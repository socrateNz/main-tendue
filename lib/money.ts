/**
 * Montants financiers.
 *
 * Toute la comptabilité est tenue en XAF (FCFA d'Afrique centrale), en ENTIERS : le franc CFA n'a pas
 * de sous-unité. Les devises étrangères (EUR, USD) sont saisies en unités mineures (centimes) et
 * converties avec un taux décimal exprimé en texte, en arithmétique entière exacte (BigInt) : aucun
 * calcul financier ne passe par un nombre flottant.
 *
 * Module volontairement sans dépendance : il est partagé entre le serveur, le client et les tests.
 */

export const ACCOUNTING_CURRENCY = "XAF" as const;

export const CURRENCIES = {
  XAF: { label: "Franc CFA (XAF)", minorDigits: 0, symbol: "FCFA" },
  EUR: { label: "Euro (EUR)", minorDigits: 2, symbol: "€" },
  USD: { label: "Dollar US (USD)", minorDigits: 2, symbol: "$" },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;
export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

/** Plafond de sécurité pour un montant unitaire (1 000 milliards XAF), bien en deçà de 2^53. */
export const MAX_XAF_AMOUNT = 1_000_000_000_000;

/** Taux de conversion : nombre décimal positif, 6 décimales maximum (ex. "655.957"). */
export const RATE_PATTERN = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/;
const RATE_SCALE_DIGITS = 6;
const RATE_SCALE = BigInt(10 ** RATE_SCALE_DIGITS);

export function isXafAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_XAF_AMOUNT;
}

export function isPositiveXafAmount(value: unknown): value is number {
  return isXafAmount(value) && value > 0;
}

function assertXaf(value: number, label = "montant"): void {
  if (!isXafAmount(value)) {
    throw new RangeError(`Le ${label} doit être un nombre entier de FCFA compris entre 0 et ${MAX_XAF_AMOUNT}.`);
  }
}

/** Somme exacte de montants XAF (lève une erreur sur toute valeur non entière ou hors plage). */
export function sumXaf(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    assertXaf(value);
    total += value;
  }
  if (!Number.isSafeInteger(total)) throw new RangeError("Total hors plage.");
  return total;
}

/**
 * Répartition à parts égales d'un montant entre `count` bénéficiaires.
 * Le reste de la division entière est attribué au PREMIER bénéficiaire (règle validée).
 *   splitEqually(1000, 3) → [334, 333, 333]
 */
export function splitEqually(amount: number, count: number): number[] {
  assertXaf(amount);
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new RangeError("Le nombre de bénéficiaires doit être un entier supérieur ou égal à 1.");
  }
  const share = Math.floor(amount / count);
  const remainder = amount - share * count;
  return Array.from({ length: count }, (_, index) => (index === 0 ? share + remainder : share));
}

/** Vérifie qu'une liste de parts correspond exactement au total. */
export function allocationsMatchTotal(total: number, parts: readonly number[]): boolean {
  return sumXaf(parts) === total;
}

/** Normalise un taux saisi ("655,957" → "655.957") ; retourne null si invalide ou nul. */
export function normalizeRate(input: string): string | null {
  const value = input.trim().replace(",", ".");
  if (!RATE_PATTERN.test(value)) return null;
  const [intPart, fraction = ""] = value.split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");
  const normalized = trimmedFraction ? `${intPart}.${trimmedFraction}` : intPart;
  return rateToScaled(normalized) > BigInt(0) ? normalized : null;
}

function rateToScaled(rate: string): bigint {
  const [intPart, fraction = ""] = rate.split(".");
  return BigInt(intPart) * RATE_SCALE + BigInt(fraction.padEnd(RATE_SCALE_DIGITS, "0"));
}

/**
 * Conversion d'un montant en devise étrangère vers XAF.
 *
 * @param originalAmountMinor montant d'origine en unités mineures (centimes pour EUR/USD, FCFA pour XAF)
 * @param currency devise d'origine
 * @param rate taux « 1 unité de devise = rate XAF », texte décimal (ex. "655.957")
 * @returns montant XAF entier, arrondi au plus proche (demi vers le haut)
 */
export function convertToXaf(originalAmountMinor: number, currency: CurrencyCode, rate: string): number {
  if (!Number.isSafeInteger(originalAmountMinor) || originalAmountMinor <= 0) {
    throw new RangeError("Le montant d'origine doit être un entier strictement positif (en unités mineures).");
  }
  const normalized = normalizeRate(rate);
  if (normalized === null) throw new RangeError("Taux de conversion invalide.");
  if (currency === "XAF" && normalized !== "1") {
    throw new RangeError("Un versement en XAF doit avoir un taux égal à 1.");
  }

  const minorFactor = BigInt(10 ** CURRENCIES[currency].minorDigits);
  const numerator = BigInt(originalAmountMinor) * rateToScaled(normalized);
  const denominator = minorFactor * RATE_SCALE;
  const result = (numerator * BigInt(2) + denominator) / (denominator * BigInt(2)); // arrondi demi-haut

  if (result > BigInt(MAX_XAF_AMOUNT)) throw new RangeError("Montant converti hors plage.");
  return Number(result);
}

/** Convertit une saisie décimale ("150,50") en unités mineures (15050) pour la devise donnée. */
export function parseMinorAmount(input: string, currency: CurrencyCode): number | null {
  const digits = CURRENCIES[currency].minorDigits;
  const value = input.trim().replace(/[\s  ]/g, "").replace(",", ".");
  const pattern = digits === 0 ? /^\d{1,13}$/ : new RegExp(`^\\d{1,13}(?:\\.\\d{1,${digits}})?$`);
  if (!pattern.test(value)) return null;
  const [intPart, fraction = ""] = value.split(".");
  const minor = Number(intPart) * 10 ** digits + Number(fraction.padEnd(digits, "0") || "0");
  return Number.isSafeInteger(minor) ? minor : null;
}

const xafFormatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

/** 1250000 → « 1 250 000 FCFA » */
export function formatXaf(amount: number, options: { withUnit?: boolean } = {}): string {
  const formatted = xafFormatter.format(amount);
  return options.withUnit === false ? formatted : `${formatted} FCFA`;
}

/** Formate un montant en unités mineures dans sa devise d'origine (15050, "EUR" → « 150,50 € »). */
export function formatMinor(amountMinor: number, currency: CurrencyCode): string {
  const digits = CURRENCIES[currency].minorDigits;
  if (currency === "XAF") return formatXaf(amountMinor);
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amountMinor / 10 ** digits);
}

/** Taux de couverture en pourcentage entier borné à [0, 100] ; 0 si rien n'est attendu. */
export function coverageRate(received: number, expected: number): number {
  if (expected <= 0) return 0;
  return Math.min(100, Math.floor((received * 100) / expected));
}
