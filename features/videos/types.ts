export const VIDEO_STATUSES = ["PROCESSING", "AVAILABLE", "REVOKED", "PENDING_DELETION", "DELETED"] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];
export const VIDEO_STATUS_LABELS: Record<VideoStatus, string> = {
  PROCESSING: "En préparation",
  AVAILABLE: "Disponible",
  REVOKED: "Accès révoqués",
  PENDING_DELETION: "Suppression en attente",
  DELETED: "Supprimée",
};

/** Durée de mise à disposition par défaut (règle validée). */
export const DEFAULT_VIDEO_RETENTION_DAYS = 90;

/** Formats et taille acceptés à l'import. */
export const VIDEO_ALLOWED_FORMATS = ["mp4", "mov", "webm", "m4v"] as const;
export const VIDEO_MAX_BYTES = 500 * 1024 * 1024;

/** Durée de validité d'une URL Cloudinary signée délivrée après vérification d'un lien. */
export const SIGNED_URL_TTL_SECONDS = 10 * 60;

/** Nombre maximal de tentatives de suppression Cloudinary avant alerte (les tentatives continuent). */
export const DELETION_ALERT_THRESHOLD = 5;

export function defaultExpiry(availableAt: Date): Date {
  const expiry = new Date(availableAt);
  expiry.setUTCDate(expiry.getUTCDate() + DEFAULT_VIDEO_RETENTION_DAYS);
  return expiry;
}
