import "server-only";

import { v2 as cloudinary } from "cloudinary";

import { getEnv } from "@/lib/env";
import { ConfigError } from "@/lib/errors";

/**
 * Client Cloudinary serveur.
 *
 * Le SDK lit nativement `CLOUDINARY_URL` ; on valide la variable avant toute utilisation pour
 * obtenir une erreur explicite si elle manque. Le secret API ne quitte jamais le serveur.
 *
 * Toutes les ressources sensibles (photos, justificatifs, vidéos) sont stockées en
 * `type: "authenticated"` : elles ne sont accessibles que via des URLs signées générées ici.
 */

let configured = false;

export function getCloudinary(): typeof cloudinary {
  if (!configured) {
    const { CLOUDINARY_URL } = getEnv("cloudinary");
    const url = new URL(CLOUDINARY_URL);
    cloudinary.config({
      cloud_name: url.hostname,
      api_key: decodeURIComponent(url.username),
      api_secret: decodeURIComponent(url.password),
      secure: true,
    });
    configured = true;
  }
  return cloudinary;
}

/** Nom du cloud (non secret), utile au navigateur pour les téléversements directs signés. */
export function getCloudName(): string {
  return new URL(getEnv("cloudinary").CLOUDINARY_URL).hostname;
}

/** Dossiers Cloudinary par usage : facilite l'inventaire et les suppressions ciblées. */
export const CLOUDINARY_FOLDERS = {
  childPhotos: "parrainage/enfants",
  sponsorPhotos: "parrainage/sponsors",
  receipts: "parrainage/justificatifs",
  videos: "parrainage/videos",
} as const;

export type CloudinaryFolder = (typeof CLOUDINARY_FOLDERS)[keyof typeof CLOUDINARY_FOLDERS];

/** Vérifie la validité des identifiants Cloudinary (diagnostic). Ne lève jamais d'erreur. */
export async function pingCloudinary(): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const result: unknown = await getCloudinary().api.ping();
    const status = typeof result === "object" && result !== null && "status" in result ? result.status : undefined;
    return status === "ok" ? { ok: true } : { ok: false, reason: "Réponse inattendue de Cloudinary." };
  } catch (error) {
    if (error instanceof ConfigError) {
      return { ok: false, reason: "Variable CLOUDINARY_URL manquante ou invalide." };
    }
    return { ok: false, reason: "Identifiants refusés ou service injoignable." };
  }
}
