import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Jetons opaques (sessions, liens vidéo privés).
 * Le jeton en clair n'est transmis qu'une fois (cookie ou lien) ; seule son empreinte SHA-256 est
 * stockée en base. Une fuite de la base ne permet donc pas de rejouer un jeton.
 */

/** 32 octets aléatoires cryptographiquement sûrs, encodés en base64url (43 caractères). */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Comparaison à temps constant de deux chaînes (évite les attaques temporelles). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Forme d'un jeton base64url valide : filtre les entrées absurdes avant toute requête en base. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
