import "server-only";

import { type ClientSession, Types } from "mongoose";

import { actorOf, type RequestContext, type SessionUser } from "@/features/auth/service";
import { Sponsor } from "@/features/sponsors/model";
import type { SponsorData } from "@/features/sponsors/schemas";
import { Sponsorship } from "@/features/sponsorships/model";
import { recordAudit } from "@/lib/audit";
import { CLOUDINARY_FOLDERS, destroyAsset, readImageFile, uploadPrivateImage, type StoredAsset } from "@/lib/cloudinary";
import { formatNumber, nextSequence } from "@/lib/db/counter";
import { connectDB, withTransaction } from "@/lib/db/mongoose";
import { BusinessRuleError, ConflictError, NotFoundError } from "@/lib/errors";

import { SPONSOR_STATUS_LABELS, sponsorDisplayName, type SponsorStatus } from "./types";

/**
 * Règles du module Sponsors. Les sponsors n'ont pas de compte : ce sont des fiches de contact.
 * Les permissions sont vérifiées par les Server Actions appelantes.
 */

/** Champs de la fiche ; les champs facultatifs vides sont effacés. */
function toDocument(data: SponsorData) {
  const person = data.kind === "PERSON";
  return {
    kind: data.kind,
    firstName: person ? data.firstName : undefined,
    lastName: person ? data.lastName : undefined,
    organizationName: person ? undefined : data.organizationName,
    email: data.email,
    phone: data.phone,
    secondaryPhone: data.secondaryPhone,
    address: data.address,
    notes: data.notes,
  };
}

/** Une même adresse e-mail ne peut identifier qu'un seul sponsor. */
async function assertEmailAvailable(email: string | undefined, session: ClientSession, excludeId?: Types.ObjectId) {
  if (!email) return;
  const existing = await Sponsor.findOne({ email, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }, { code: 1, displayName: 1 })
    .session(session)
    .lean();
  if (existing) {
    throw new ConflictError(`Cette adresse e-mail est déjà celle de ${existing.displayName} (${existing.code}).`, {
      email: ["Déjà utilisée par un autre sponsor."],
    });
  }
}

export async function createSponsor(actor: SessionUser, data: SponsorData, ctx: RequestContext): Promise<string> {
  return withTransaction(async (session) => {
    await assertEmailAvailable(data.email, session);
    const code = formatNumber("SPN", await nextSequence("sponsor", session), 5);
    const [sponsor] = await Sponsor.create([{ ...toDocument(data), code, createdBy: new Types.ObjectId(actor.id) }], { session });
    await recordAudit(actorOf(actor, ctx), {
      action: "sponsor.create",
      summary: `Création du sponsor ${sponsorDisplayName(data)} (${code}).`,
      entityType: "Sponsor",
      entityId: sponsor._id,
    }, session);
    return sponsor._id.toString();
  });
}

export async function updateSponsor(actor: SessionUser, sponsorId: string, data: SponsorData, ctx: RequestContext): Promise<void> {
  await withTransaction(async (session) => {
    const sponsor = await Sponsor.findById(sponsorId).session(session);
    if (!sponsor) throw new NotFoundError("Sponsor introuvable.");
    if (sponsor.status === "ARCHIVED") throw new BusinessRuleError("La fiche est archivée : réactivez-la avant de la modifier.");
    await assertEmailAvailable(data.email, session, sponsor._id);

    const document = toDocument(data);
    sponsor.set(document);
    for (const field of ["firstName", "lastName", "organizationName", "email", "phone", "secondaryPhone", "notes"] as const) {
      if (document[field] === undefined) sponsor.set(field, undefined);
    }
    await sponsor.save({ session });
    await recordAudit(actorOf(actor, ctx), {
      action: "sponsor.update",
      summary: `Modification de la fiche de ${sponsor.displayName} (${sponsor.code}).`,
      entityType: "Sponsor",
      entityId: sponsor._id,
    }, session);
  });
}

/**
 * Changement de statut. Un sponsor ne peut devenir inactif ou être archivé tant qu'il a des
 * parrainages actifs : ils doivent d'abord être terminés ou suspendus.
 */
export async function setSponsorStatus(
  actor: SessionUser,
  sponsorId: string,
  status: SponsorStatus,
  reason: string | undefined,
  ctx: RequestContext,
): Promise<void> {
  await withTransaction(async (session) => {
    const sponsor = await Sponsor.findById(sponsorId, { displayName: 1, code: 1, status: 1 }).session(session).lean();
    if (!sponsor) throw new NotFoundError("Sponsor introuvable.");
    if (sponsor.status === status) return;
    if (status !== "ACTIVE") {
      if (!reason || reason.length < 5) throw new BusinessRuleError("Indiquez le motif du changement de statut (5 caractères minimum).");
      const active = await Sponsorship.countDocuments({ sponsor: sponsor._id, status: "ACTIVE" }).session(session);
      if (active > 0) {
        throw new BusinessRuleError(`Ce sponsor a ${active} parrainage(s) actif(s) : terminez-les ou suspendez-les d'abord.`);
      }
    }
    await Sponsor.updateOne(
      { _id: sponsor._id },
      status === "ACTIVE"
        ? { $set: { status, statusChangedAt: new Date() }, $unset: { statusReason: 1 } }
        : { $set: { status, statusChangedAt: new Date(), statusReason: reason } },
      { session },
    );
    await recordAudit(actorOf(actor, ctx), {
      action: "sponsor.status",
      summary: `${sponsor.displayName} (${sponsor.code}) : ${SPONSOR_STATUS_LABELS[sponsor.status]} → ${SPONSOR_STATUS_LABELS[status]}.`,
      entityType: "Sponsor",
      entityId: sponsor._id,
      details: { from: sponsor.status, to: status, reason },
    }, session);
  });
}

/* ------------------------------------------------------------------ Photo */

export async function setSponsorPhoto(actor: SessionUser, sponsorId: string, file: File, ctx: RequestContext): Promise<void> {
  const buffer = await readImageFile(file);
  await connectDB();
  const sponsor = await Sponsor.findById(sponsorId, { displayName: 1, code: 1, status: 1, photo: 1 }).lean();
  if (!sponsor) throw new NotFoundError("Sponsor introuvable.");
  if (sponsor.status === "ARCHIVED") throw new BusinessRuleError("La fiche est archivée.");

  const uploaded = await uploadPrivateImage(buffer, CLOUDINARY_FOLDERS.sponsorPhotos, file.name);
  try {
    await withTransaction(async (session) => {
      await Sponsor.updateOne({ _id: sponsor._id }, { $set: { photo: uploaded } }, { session });
      await recordAudit(actorOf(actor, ctx), {
        action: "sponsor.photo.update",
        summary: `Mise à jour de la photo de ${sponsor.displayName} (${sponsor.code}).`,
        entityType: "Sponsor",
        entityId: sponsor._id,
      }, session);
    });
  } catch (error) {
    await destroyAsset(uploaded);
    throw error;
  }
  if (sponsor.photo) await destroyAsset(sponsor.photo as StoredAsset);
}

export async function removeSponsorPhoto(actor: SessionUser, sponsorId: string, ctx: RequestContext): Promise<void> {
  await connectDB();
  const sponsor = await Sponsor.findById(sponsorId, { displayName: 1, code: 1, photo: 1 }).lean();
  if (!sponsor) throw new NotFoundError("Sponsor introuvable.");
  if (!sponsor.photo) return;
  await withTransaction(async (session) => {
    await Sponsor.updateOne({ _id: sponsor._id }, { $set: { photo: null } }, { session });
    await recordAudit(actorOf(actor, ctx), {
      action: "sponsor.photo.remove",
      summary: `Suppression de la photo de ${sponsor.displayName} (${sponsor.code}).`,
      entityType: "Sponsor",
      entityId: sponsor._id,
    }, session);
  });
  await destroyAsset(sponsor.photo as StoredAsset);
}
