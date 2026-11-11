export const SPONSORSHIP_STATUSES = ["ACTIVE", "SUSPENDED", "ENDED", "CANCELLED"] as const;
export type SponsorshipStatus = (typeof SPONSORSHIP_STATUSES)[number];
export const SPONSORSHIP_STATUS_LABELS: Record<SponsorshipStatus, string> = {
  ACTIVE: "Actif",
  SUSPENDED: "Suspendu",
  ENDED: "Terminé",
  CANCELLED: "Annulé",
};
