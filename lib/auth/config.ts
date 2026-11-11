/**
 * Paramètres de sécurité de l'authentification (module pur, utilisable dans le proxy).
 */

/** Durée de vie maximale d'une session, quelle que soit l'activité. */
export const SESSION_ABSOLUTE_TTL_MS = 12 * 60 * 60 * 1000; // 12 h
/** Expiration après inactivité. */
export const SESSION_IDLE_TTL_MS = 2 * 60 * 60 * 1000; // 2 h
/** Fréquence maximale de mise à jour de `lastSeenAt` (évite une écriture à chaque requête). */
export const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/** Préfixe `__Host-` en production : cookie lié à l'hôte, Secure, sans attribut Domain. */
export const SESSION_COOKIE_NAME = process.env.NODE_ENV === "production" ? "__Host-session" : "session";

export const LOGIN_RATE_LIMIT = {
  windowMs: 15 * 60 * 1000,
  /** Échecs autorisés par compte dans la fenêtre avant verrouillage. */
  maxFailuresPerAccount: 5,
  /** Échecs autorisés par adresse IP dans la fenêtre avant blocage. */
  maxFailuresPerIp: 30,
  lockMs: 15 * 60 * 1000,
} as const;

export const LOGIN_PATH = "/connexion";
export const CHANGE_PASSWORD_PATH = "/mon-compte/mot-de-passe";
export const HOME_PATH = "/tableau-de-bord";

/** Chemins accessibles sans session (le reste de l'espace de gestion est protégé). */
export const PUBLIC_PATHS = [LOGIN_PATH] as const;

/** Redirection post-connexion : uniquement un chemin interne (pas d'URL externe ni `//`). */
export function safeRedirectPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return HOME_PATH;
  if (value === LOGIN_PATH || value.startsWith(`${LOGIN_PATH}?`)) return HOME_PATH;
  return value;
}
