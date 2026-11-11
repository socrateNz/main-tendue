export const SPONSOR_KINDS = ["PERSON", "ORGANIZATION"] as const;
export type SponsorKind = (typeof SPONSOR_KINDS)[number];
export const SPONSOR_KIND_LABELS: Record<SponsorKind, string> = {
  PERSON: "Particulier",
  ORGANIZATION: "Organisation",
};

export const SPONSOR_STATUSES = ["ACTIVE", "INACTIVE", "ARCHIVED"] as const;
export type SponsorStatus = (typeof SPONSOR_STATUSES)[number];
export const SPONSOR_STATUS_LABELS: Record<SponsorStatus, string> = {
  ACTIVE: "Actif",
  INACTIVE: "Inactif",
  ARCHIVED: "Archivé",
};

/** Code pays ISO 3166-1 alpha-2 (ex. CM, FR, US). */
export const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
