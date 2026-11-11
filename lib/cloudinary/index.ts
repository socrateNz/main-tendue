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

/* ------------------------------------------------------------------ Images privées */

export type StoredAsset = {
  publicId: string;
  resourceType: "image" | "video" | "raw";
  deliveryType: "authenticated" | "private" | "upload";
  format?: string | null;
  bytes?: number | null;
  width?: number | null;
  height?: number | null;
  version?: number | null;
  originalFilename?: string | null;
};

export const IMAGE_MAX_BYTES = 3 * 1024 * 1024;
const IMAGE_SIGNATURES: Array<{ mime: string; test: (b: Buffer) => boolean }> = [
  { mime: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/webp", test: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP" },
];

/**
 * Vérifie une image par son CONTENU (signature binaire), pas seulement par son extension ou son type
 * déclaré. Retourne le type réel ou null si le fichier n'est pas une image acceptée.
 */
export function detectImageType(buffer: Buffer): string | null {
  return IMAGE_SIGNATURES.find((signature) => signature.test(buffer))?.mime ?? null;
}

/** Téléverse une image en ressource AUTHENTIFIÉE (jamais publique), sous un identifiant aléatoire. */
export async function uploadPrivateImage(buffer: Buffer, folder: CloudinaryFolder, originalFilename: string): Promise<StoredAsset> {
  const client = getCloudinary();
  const result = await new Promise<{ public_id: string; format: string; bytes: number; width: number; height: number; version: number }>(
    (resolve, reject) => {
      const stream = client.uploader.upload_stream(
        {
          folder,
          type: "authenticated",
          resource_type: "image",
          use_filename: false,
          unique_filename: true,
          overwrite: false,
          // Normalisation : taille plafonnée, métadonnées (EXIF, GPS) supprimées.
          transformation: [{ width: 1600, height: 1600, crop: "limit" }],
          image_metadata: false,
        },
        (error, response) => (error || !response ? reject(error ?? new Error("Téléversement impossible.")) : resolve(response)),
      );
      stream.end(buffer);
    },
  );
  return {
    publicId: result.public_id,
    resourceType: "image",
    deliveryType: "authenticated",
    format: result.format,
    bytes: result.bytes,
    width: result.width,
    height: result.height,
    version: result.version,
    originalFilename: originalFilename.slice(0, 255),
  };
}

/** URL signée d'une image authentifiée, recadrée ; l'URL ne peut pas être modifiée sans invalider la signature. */
export function signedImageUrl(asset: StoredAsset, size: { width: number; height: number }): string | null {
  try {
    return getCloudinary().url(asset.publicId, {
      type: asset.deliveryType,
      resource_type: "image",
      sign_url: true,
      secure: true,
      version: asset.version ?? undefined,
      transformation: [{ width: size.width, height: size.height, crop: "fill", gravity: "auto" }, { fetch_format: "auto", quality: "auto" }],
    });
  } catch {
    return null; // Cloudinary non configuré : l'interface affiche les initiales.
  }
}

/** Supprime une ressource ; retourne false en cas d'échec (sans lever d'erreur). */
export async function destroyAsset(asset: StoredAsset): Promise<boolean> {
  try {
    const result: unknown = await getCloudinary().uploader.destroy(asset.publicId, {
      type: asset.deliveryType,
      resource_type: asset.resourceType,
      invalidate: true,
    });
    const status = typeof result === "object" && result !== null && "result" in result ? result.result : undefined;
    return status === "ok" || status === "not found";
  } catch {
    return false;
  }
}

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
