/**
 * Pays (ISO 3166-1 alpha-2). Les noms français sont fournis par `Intl.DisplayNames` : aucune
 * liste de libellés à maintenir. Module pur, partagé client / serveur.
 */

const CODES =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW";

export const COUNTRY_CODES: readonly string[] = CODES.split(" ");

const names = new Intl.DisplayNames(["fr"], { type: "region" });

export function countryName(code: string | null | undefined): string {
  if (!code) return "—";
  try {
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Pays les plus fréquents en tête de liste, puis les autres par ordre alphabétique. */
const PREFERRED = ["CM", "FR", "BE", "CH", "CA", "US", "DE", "GB", "IT", "ES", "GA", "CG", "TD", "CF", "GQ", "CI", "SN"];

export function countryOptions(): { preferred: Array<{ value: string; label: string }>; others: Array<{ value: string; label: string }> } {
  const collator = new Intl.Collator("fr");
  const preferred = PREFERRED.map((code) => ({ value: code, label: countryName(code) }));
  const others = COUNTRY_CODES.filter((code) => !PREFERRED.includes(code))
    .map((code) => ({ value: code, label: countryName(code) }))
    .sort((a, b) => collator.compare(a.label, b.label));
  return { preferred, others };
}

export function isCountryCode(value: string): boolean {
  return COUNTRY_CODES.includes(value);
}
