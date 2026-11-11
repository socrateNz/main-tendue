/** Utilitaires de texte purs (partagés client / serveur). */

/** Minuscules, sans accents ni espaces superflus : « Éloïse  N'GUESSAN » → « eloise n'guessan ». */
export function normalizeSearch(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Construit le texte de recherche d'un document à partir de ses champs pertinents. */
export function buildSearchText(parts: ReadonlyArray<string | null | undefined>): string {
  return normalizeSearch(parts.filter((part): part is string => Boolean(part)).join(" "));
}

export function fullName(person: { firstName?: string | null; lastName?: string | null }): string {
  return [person.firstName, person.lastName?.toUpperCase()].filter(Boolean).join(" ");
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
