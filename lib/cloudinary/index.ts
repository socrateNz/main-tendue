import "server-only";

import { v2 as cloudinary } from "cloudinary";

import { getEnv } from "@/lib/env";
import { ConfigError, ValidationError } from "@/lib/errors";

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

/**
 * Lit et contrôle une image reçue d'un formulaire : taille, puis type RÉEL d'après le contenu.
 * Lève une ValidationError explicite ; retourne le contenu prêt à téléverser.
 */
export async function readImageFile(file: File): Promise<Buffer> {
  if (file.size === 0) throw new ValidationError("Le fichier est vide.");
  if (file.size > IMAGE_MAX_BYTES) throw new ValidationError("La photo ne doit pas dépasser 3 Mo.");
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!detectImageType(buffer)) throw new ValidationError("Format non accepté : utilisez une image JPEG, PNG ou WebP.");
  return buffer;
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

/* ------------------------------------------------------------------ Justificatifs (image ou PDF) */

const isPdf = (buffer: Buffer) => buffer.subarray(0, 5).toString("ascii") === "%PDF-";

/** Type d'un justificatif déjà contrôlé par `readDocumentFile`. */
export function detectDocumentType(buffer: Buffer): "image" | "pdf" {
  return isPdf(buffer) ? "pdf" : "image";
}

/** Justificatif : image (JPEG, PNG, WebP) ou PDF, 3 Mo maximum, contrôlé d'après son contenu réel. */
export async function readDocumentFile(file: File): Promise<Buffer> {
  if (file.size === 0) throw new ValidationError("Le fichier est vide.");
  if (file.size > IMAGE_MAX_BYTES) throw new ValidationError("Le justificatif ne doit pas dépasser 3 Mo.");
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!detectImageType(buffer) && !isPdf(buffer)) throw new ValidationError("Format non accepté : PDF, JPEG, PNG ou WebP.");
  return buffer;
}

export async function uploadPrivateDocument(buffer: Buffer, kind: "image" | "pdf", folder: CloudinaryFolder, originalFilename: string): Promise<StoredAsset> {
  if (kind === "image") return uploadPrivateImage(buffer, folder, originalFilename);
  const client = getCloudinary();
  const result = await new Promise<{ public_id: string; format: string; bytes: number; version: number }>((resolve, reject) => {
    const stream = client.uploader.upload_stream(
      { folder, type: "authenticated", resource_type: "image", format: "pdf", unique_filename: true, overwrite: false },
      (error, response) => (error || !response ? reject(error ?? new Error("Téléversement impossible.")) : resolve(response)),
    );
    stream.end(buffer);
  });
  return {
    publicId: result.public_id,
    resourceType: "image",
    deliveryType: "authenticated",
    format: "pdf",
    bytes: result.bytes,
    version: result.version,
    originalFilename: originalFilename.slice(0, 255),
  };
}

/** URL signée d'un justificatif, sans transformation (consultation du document d'origine). */
export function signedAssetUrl(asset: StoredAsset): string | null {
  try {
    return getCloudinary().url(asset.publicId, {
      type: asset.deliveryType,
      resource_type: asset.resourceType,
      sign_url: true,
      secure: true,
      version: asset.version ?? undefined,
      format: asset.format ?? undefined,
    });
  } catch {
    return null;
  }
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

/* ------------------------------------------------------------------ Vidéos privées */

/**
 * Paramètres d'un envoi DIRECT navigateur → Cloudinary (les vidéos dépassent la limite des
 * fonctions Vercel). Le serveur impose l'identifiant (aléatoire, dans le dossier vidéos), le mode
 * `authenticated` et les formats ; la signature empêche le navigateur de les modifier.
 */
export function signVideoUpload(publicId: string, allowedFormats: readonly string[]) {
  const client = getCloudinary();
  const config = client.config();
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { public_id: publicId, timestamp, type: "authenticated", allowed_formats: allowedFormats.join(",") };
  const signature = client.utils.api_sign_request(params, String(config.api_secret));
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloud_name}/video/upload`,
    fields: { ...params, timestamp: String(timestamp), api_key: String(config.api_key), signature },
  };
}

/** Lit la ressource vidéo réellement présente sur Cloudinary (taille, format, durée), ou null. */
export async function fetchVideoResource(publicId: string): Promise<{ bytes: number; format: string; duration: number | null; version: number } | null> {
  try {
    const resource: unknown = await getCloudinary().api.resource(publicId, { resource_type: "video", type: "authenticated" });
    if (typeof resource !== "object" || resource === null) return null;
    const r = resource as { bytes?: unknown; format?: unknown; duration?: unknown; version?: unknown };
    if (typeof r.bytes !== "number" || typeof r.format !== "string") return null;
    return { bytes: r.bytes, format: r.format, duration: typeof r.duration === "number" ? r.duration : null, version: typeof r.version === "number" ? r.version : 0 };
  } catch {
    return null;
  }
}

/**
 * URL de lecture (ou de téléchargement) d'une vidéo authentifiée, SIGNÉE et EXPIRANT après
 * `ttlSeconds`. Générée à chaque accès, après vérification du lien privé côté serveur.
 */
export function privateVideoUrl(asset: StoredAsset, options: { ttlSeconds: number; attachment: boolean }): string {
  return getCloudinary().utils.private_download_url(asset.publicId, asset.format ?? "mp4", {
    resource_type: "video",
    type: "authenticated",
    expires_at: Math.floor(Date.now() / 1000) + options.ttlSeconds,
    attachment: options.attachment,
  });
}

/** Suppression définitive d'une vidéo ; distingue succès, absence et échec (nouvelle tentative). */
export async function destroyVideo(asset: StoredAsset): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const result: unknown = await getCloudinary().uploader.destroy(asset.publicId, { type: "authenticated", resource_type: "video", invalidate: true });
    const status = typeof result === "object" && result !== null && "result" in result ? String(result.result) : "unknown";
    return status === "ok" || status === "not found" ? { ok: true } : { ok: false, error: `Réponse Cloudinary : ${status}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message.slice(0, 300) : "Erreur inconnue" };
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
