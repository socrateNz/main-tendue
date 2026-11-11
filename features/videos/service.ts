import "server-only";

import { type ClientSession, Types } from "mongoose";

import { actorOf, type RequestContext, type SessionUser } from "@/features/auth/service";
import { Child } from "@/features/children/model";
import { SchoolYear } from "@/features/school-years/model";
import { Sponsor } from "@/features/sponsors/model";
import { Sponsorship } from "@/features/sponsorships/model";
import { Video, VideoAccessLink } from "@/features/videos/model";
import { recordAudit, SYSTEM_ACTOR } from "@/lib/audit";
import { CLOUDINARY_FOLDERS, destroyVideo, fetchVideoResource, signVideoUpload, type StoredAsset } from "@/lib/cloudinary";
import { connectDB, withTransaction } from "@/lib/db/mongoose";
import { formatDate } from "@/lib/dates";
import { getEnv } from "@/lib/env";
import { BusinessRuleError, NotFoundError, ValidationError } from "@/lib/errors";
import { generateToken, hashToken, TOKEN_PATTERN } from "@/lib/security/tokens";
import { fullName } from "@/lib/text";

import { DELETION_ALERT_THRESHOLD, VIDEO_ALLOWED_FORMATS, VIDEO_MAX_BYTES, defaultExpiry } from "./types";

/**
 * Vidéos de remerciement (docs/modele-donnees.md § 10).
 *
 * - Fichiers Cloudinary en mode `authenticated` : jamais publics.
 * - Un lien par sponsor : jeton aléatoire de 256 bits, stocké HACHÉ, affiché une seule fois,
 *   révocable, avec date d'expiration.
 * - À chaque accès, le serveur vérifie le lien puis délivre une URL signée valable quelques minutes.
 * - À l'échéance, une tâche planifiée invalide les liens et supprime le fichier, avec nouvelles
 *   tentatives en cas d'échec (la vidéo n'est marquée supprimée qu'après confirmation).
 */

const AUDIT_ENTITY = "Video";

export type GeneratedLink = { sponsorId: string; sponsorName: string; url: string };

function linkUrl(token: string): string {
  return `${getEnv("app").NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/v/${token}`;
}

/* ------------------------------------------------------------------ Import */

/** Prépare un envoi direct signé : identifiant aléatoire imposé dans le dossier des vidéos. */
export function prepareVideoUpload() {
  const publicId = `${CLOUDINARY_FOLDERS.videos}/${generateToken(18)}`;
  return { publicId, maxBytes: VIDEO_MAX_BYTES, ...signVideoUpload(publicId, VIDEO_ALLOWED_FORMATS) };
}

export async function registerVideo(
  actor: SessionUser,
  input: { publicId: string; childId: string; schoolYearId: string; title: string; message?: string },
  ctx: RequestContext,
): Promise<string> {
  if (!input.publicId.startsWith(`${CLOUDINARY_FOLDERS.videos}/`)) throw new ValidationError("Fichier vidéo inattendu.");
  const resource = await fetchVideoResource(input.publicId);
  if (!resource) throw new BusinessRuleError("La vidéo est introuvable sur Cloudinary : l'envoi n'a pas abouti.");
  const asset: StoredAsset = {
    publicId: input.publicId,
    resourceType: "video",
    deliveryType: "authenticated",
    format: resource.format,
    bytes: resource.bytes,
    version: resource.version,
  };
  if (resource.bytes > VIDEO_MAX_BYTES || !(VIDEO_ALLOWED_FORMATS as readonly string[]).includes(resource.format)) {
    await destroyVideo(asset);
    throw new BusinessRuleError("Format ou taille de vidéo non accepté (MP4, MOV, WebM, M4V ; 100 Mo maximum).");
  }

  try {
    return await withTransaction(async (session) => {
      const child = await Child.findById(input.childId, { firstName: 1, lastName: 1 }).session(session).lean();
      const year = await SchoolYear.findById(input.schoolYearId, { label: 1 }).session(session).lean();
      if (!child) throw new NotFoundError("Enfant introuvable.");
      if (!year) throw new NotFoundError("Année scolaire introuvable.");
      const now = new Date();
      const [video] = await Video.create(
        [
          {
            child: child._id,
            schoolYear: year._id,
            title: input.title,
            message: input.message,
            asset: { ...asset, duration: resource.duration ?? undefined },
            status: "PROCESSING",
            // Une vidéo jamais publiée est elle aussi supprimée à l'échéance par défaut.
            expiresAt: defaultExpiry(now),
            createdBy: new Types.ObjectId(actor.id),
          },
        ],
        { session },
      );
      await recordAudit(actorOf(actor, ctx), {
        action: "video.upload",
        summary: `Import de la vidéo « ${input.title} » de ${fullName(child)} (${year.label}).`,
        entityType: AUDIT_ENTITY,
        entityId: video._id,
        schoolYear: year._id,
        details: { bytes: resource.bytes, format: resource.format },
      }, session);
      return video._id.toString();
    });
  } catch (error) {
    await destroyVideo(asset); // pas de fichier orphelin si l'enregistrement échoue
    throw error;
  }
}

/* ------------------------------------------------------------------ Liens */

/** Sponsors de l'enfant pour l'année de la vidéo (parrainages non annulés, sponsors non archivés). */
async function eligibleSponsors(childId: Types.ObjectId, yearId: Types.ObjectId, session: ClientSession) {
  const sponsorIds = await Sponsorship.distinct("sponsor", { child: childId, schoolYear: yearId, status: { $ne: "CANCELLED" } }).session(session);
  return Sponsor.find({ _id: { $in: sponsorIds }, status: { $ne: "ARCHIVED" } }, { displayName: 1 }).session(session).lean();
}

async function createLink(videoId: Types.ObjectId, sponsorId: Types.ObjectId, expiresAt: Date, actorId: string, session: ClientSession): Promise<string> {
  await VideoAccessLink.updateMany(
    { video: videoId, sponsor: sponsorId, active: true },
    { $set: { active: false, revokedAt: new Date(), revokedBy: new Types.ObjectId(actorId) } },
    { session },
  );
  const token = generateToken();
  await VideoAccessLink.create([{ video: videoId, sponsor: sponsorId, tokenHash: hashToken(token), expiresAt, createdBy: new Types.ObjectId(actorId) }], { session });
  return token;
}

/**
 * Mise à disposition : génère un lien privé par sponsor de l'enfant pour l'année.
 * Les liens en clair ne sont retournés qu'ici : ils ne sont jamais stockés.
 */
export async function publishVideo(actor: SessionUser, videoId: string, expiresAt: Date | null, ctx: RequestContext): Promise<GeneratedLink[]> {
  return withTransaction(async (session) => {
    const video = await Video.findById(videoId).session(session).lean();
    if (!video) throw new NotFoundError("Vidéo introuvable.");
    if (video.status !== "PROCESSING") throw new BusinessRuleError("Cette vidéo a déjà été mise à disposition.");
    const availableAt = new Date();
    const expiry = expiresAt ?? defaultExpiry(availableAt);
    if (expiry <= availableAt) throw new BusinessRuleError("La date d'expiration doit être future.", { expiresAt: ["Date passée."] });

    const sponsors = await eligibleSponsors(video.child, video.schoolYear, session);
    if (sponsors.length === 0) throw new BusinessRuleError("Aucun sponsor n'est associé à cet enfant pour l'année de la vidéo.");

    await Video.updateOne({ _id: video._id }, { $set: { status: "AVAILABLE", availableAt, expiresAt: expiry } }, { session });
    const links: GeneratedLink[] = [];
    for (const sponsor of sponsors) {
      const token = await createLink(video._id, sponsor._id, expiry, actor.id, session);
      links.push({ sponsorId: sponsor._id.toString(), sponsorName: sponsor.displayName, url: linkUrl(token) });
    }
    await recordAudit(actorOf(actor, ctx), {
      action: "video.publish",
      summary: `Mise à disposition de « ${video.title} » : ${links.length} lien(s) privé(s), jusqu'au ${formatDate(expiry)}.`,
      entityType: AUDIT_ENTITY,
      entityId: video._id,
      schoolYear: video.schoolYear,
      details: { sponsors: links.map((l) => l.sponsorId), expiresAt: expiry },
    }, session);
    return links;
  });
}

/** (Re)génère le lien d'un sponsor : l'ancien lien est révoqué. */
export async function regenerateLink(actor: SessionUser, videoId: string, sponsorId: string, ctx: RequestContext): Promise<GeneratedLink> {
  return withTransaction(async (session) => {
    const video = await Video.findById(videoId).session(session).lean();
    if (!video || !video.expiresAt) throw new NotFoundError("Vidéo introuvable.");
    if (video.status !== "AVAILABLE") throw new BusinessRuleError("La vidéo n'est pas disponible : aucun lien ne peut être généré.");
    const sponsors = await eligibleSponsors(video.child, video.schoolYear, session);
    const sponsor = sponsors.find((s) => s._id.toString() === sponsorId);
    if (!sponsor) throw new BusinessRuleError("Ce sponsor ne parraine pas l'enfant pour l'année de la vidéo.");
    const token = await createLink(video._id, sponsor._id, video.expiresAt, actor.id, session);
    await recordAudit(actorOf(actor, ctx), {
      action: "video.link.generate",
      summary: `Nouveau lien de « ${video.title} » pour ${sponsor.displayName} (l'ancien est révoqué).`,
      entityType: AUDIT_ENTITY,
      entityId: video._id,
      schoolYear: video.schoolYear,
    }, session);
    return { sponsorId, sponsorName: sponsor.displayName, url: linkUrl(token) };
  });
}

export async function revokeLink(actor: SessionUser, linkId: string, ctx: RequestContext): Promise<void> {
  await withTransaction(async (session) => {
    const link = await VideoAccessLink.findOneAndUpdate(
      { _id: linkId, active: true },
      { $set: { active: false, revokedAt: new Date(), revokedBy: new Types.ObjectId(actor.id) } },
      { session },
    ).lean();
    if (!link) throw new NotFoundError("Lien introuvable ou déjà révoqué.");
    const sponsor = await Sponsor.findById(link.sponsor, { displayName: 1 }).session(session).lean();
    await recordAudit(actorOf(actor, ctx), {
      action: "video.link.revoke",
      summary: `Révocation du lien de ${sponsor?.displayName ?? "un sponsor"}.`,
      entityType: AUDIT_ENTITY,
      entityId: link.video,
    }, session);
  });
}

/** Révocation de TOUS les accès avant l'échéance (le fichier est supprimé à l'échéance prévue). */
export async function revokeVideo(actor: SessionUser, videoId: string, reason: string, ctx: RequestContext): Promise<void> {
  await withTransaction(async (session) => {
    const video = await Video.findById(videoId).session(session).lean();
    if (!video) throw new NotFoundError("Vidéo introuvable.");
    if (video.status !== "AVAILABLE" && video.status !== "PROCESSING") throw new BusinessRuleError("Les accès de cette vidéo sont déjà fermés.");
    await Video.updateOne({ _id: video._id }, { $set: { status: "REVOKED", revokedAt: new Date(), revokedBy: new Types.ObjectId(actor.id), revokeReason: reason } }, { session });
    await VideoAccessLink.updateMany({ video: video._id, active: true }, { $set: { active: false, revokedAt: new Date(), revokedBy: new Types.ObjectId(actor.id) } }, { session });
    await recordAudit(actorOf(actor, ctx), { action: "video.revoke", summary: `Révocation de tous les accès à « ${video.title} ».`, entityType: AUDIT_ENTITY, entityId: video._id, details: { reason } }, session);
  });
}

/** Modifie la date d'expiration (et celle des liens actifs). */
export async function updateVideoExpiry(actor: SessionUser, videoId: string, expiresAt: Date, ctx: RequestContext): Promise<void> {
  await withTransaction(async (session) => {
    const video = await Video.findById(videoId).session(session).lean();
    if (!video) throw new NotFoundError("Vidéo introuvable.");
    if (video.status === "PENDING_DELETION" || video.status === "DELETED") throw new BusinessRuleError("La vidéo a expiré.");
    if (expiresAt <= new Date()) throw new BusinessRuleError("La date d'expiration doit être future.", { expiresAt: ["Date passée."] });
    await Video.updateOne({ _id: video._id }, { $set: { expiresAt } }, { session, runValidators: true });
    await VideoAccessLink.updateMany({ video: video._id, active: true }, { $set: { expiresAt } }, { session });
    await recordAudit(actorOf(actor, ctx), {
      action: "video.expiry",
      summary: `Expiration de « ${video.title} » : ${video.expiresAt ? formatDate(video.expiresAt) : "—"} → ${formatDate(expiresAt)}.`,
      entityType: AUDIT_ENTITY,
      entityId: video._id,
    }, session);
  });
}

/* ------------------------------------------------------------------ Accès sponsor (public) */

export type ResolvedLink = { linkId: string; video: { id: string; title: string; message: string | null; childFirstName: string; asset: StoredAsset; expiresAt: Date } };

/** Vérifie un jeton de lien : forme, empreinte, lien actif, non expiré, vidéo disponible. */
export async function resolveVideoLink(token: string): Promise<ResolvedLink | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  await connectDB();
  const now = new Date();
  const link = await VideoAccessLink.findOne({ tokenHash: hashToken(token), active: true, expiresAt: { $gt: now } }).lean();
  if (!link) return null;
  const video = await Video.findOne({ _id: link.video, status: "AVAILABLE", expiresAt: { $gt: now } }).lean();
  if (!video || !video.expiresAt) return null;
  const child = await Child.findById(video.child, { firstName: 1 }).lean();
  return {
    linkId: link._id.toString(),
    video: { id: video._id.toString(), title: video.title, message: video.message ?? null, childFirstName: child?.firstName ?? "", asset: video.asset as StoredAsset, expiresAt: video.expiresAt },
  };
}

/** Journalise un accès sponsor (consultation ou téléchargement). */
export async function recordLinkAccess(linkId: string, kind: "view" | "download", ctx: RequestContext): Promise<void> {
  const link = await VideoAccessLink.findOneAndUpdate(
    { _id: linkId },
    { $inc: kind === "view" ? { accessCount: 1 } : { downloadCount: 1 }, $set: { lastAccessAt: new Date() } },
  ).lean();
  if (!link) return;
  const sponsor = await Sponsor.findById(link.sponsor, { displayName: 1 }).lean();
  await recordAudit(
    { label: `Sponsor via lien privé (${sponsor?.displayName ?? "?"})`, ip: ctx.ip, userAgent: ctx.userAgent },
    { action: kind === "view" ? "video.view" : "video.download", summary: `${kind === "view" ? "Consultation" : "Téléchargement"} de la vidéo par ${sponsor?.displayName ?? "un sponsor"}.`, entityType: AUDIT_ENTITY, entityId: link.video },
  );
}

/* ------------------------------------------------------------------ Expiration (tâche planifiée) */

export type ExpirySummary = { expired: number; deleted: number; failed: number; alerts: string[] };

/**
 * 1. Les vidéos échues passent en PENDING_DELETION et tous leurs liens sont invalidés.
 * 2. Chaque vidéo PENDING_DELETION est supprimée de Cloudinary ; elle ne passe en DELETED qu'après
 *    confirmation. En cas d'échec, le nombre de tentatives est incrémenté et la suppression sera
 *    retentée au passage suivant. Métadonnées et historique sont conservés.
 */
export async function processExpiredVideos(now = new Date()): Promise<ExpirySummary> {
  await connectDB();
  const due = await Video.find({ status: { $in: ["PROCESSING", "AVAILABLE", "REVOKED"] }, expiresAt: { $lte: now } }, { _id: 1, title: 1 }).lean();
  for (const video of due) {
    await withTransaction(async (session) => {
      await Video.updateOne({ _id: video._id }, { $set: { status: "PENDING_DELETION" } }, { session });
      await VideoAccessLink.updateMany({ video: video._id, active: true }, { $set: { active: false, revokedAt: now } }, { session });
      await recordAudit(SYSTEM_ACTOR, { action: "video.expire", summary: `Échéance atteinte pour « ${video.title} » : accès invalidés.`, entityType: AUDIT_ENTITY, entityId: video._id }, session);
    });
  }

  const pending = await Video.find({ status: "PENDING_DELETION" }).lean();
  let deleted = 0;
  let failed = 0;
  const alerts: string[] = [];
  for (const video of pending) {
    const result = await destroyVideo(video.asset as StoredAsset);
    if (result.ok) {
      deleted += 1;
      await Video.updateOne(
        { _id: video._id },
        { $set: { status: "DELETED", "deletion.deletedAt": new Date(), "deletion.lastAttemptAt": new Date() }, $inc: { "deletion.attempts": 1 } },
      );
      await recordAudit(SYSTEM_ACTOR, { action: "video.delete", summary: `Fichier de « ${video.title} » supprimé de Cloudinary.`, entityType: AUDIT_ENTITY, entityId: video._id });
    } else {
      failed += 1;
      const attempts = (video.deletion?.attempts ?? 0) + 1;
      await Video.updateOne({ _id: video._id }, { $set: { "deletion.lastAttemptAt": new Date(), "deletion.lastError": result.error }, $inc: { "deletion.attempts": 1 } });
      await recordAudit(SYSTEM_ACTOR, { action: "video.delete.failed", summary: `Échec de suppression de « ${video.title} » (tentative ${attempts}) : nouvel essai au prochain passage.`, entityType: AUDIT_ENTITY, entityId: video._id, details: { error: result.error } });
      if (attempts >= DELETION_ALERT_THRESHOLD) alerts.push(`« ${video.title} » : ${attempts} tentatives échouées.`);
    }
  }
  return { expired: due.length, deleted, failed, alerts };
}
