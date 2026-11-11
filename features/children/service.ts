import "server-only";

import { type ClientSession, Types, mongo } from "mongoose";

import { actorOf, type RequestContext, type SessionUser } from "@/features/auth/service";
import { Child, Enrollment, School, childIdentityKey } from "@/features/children/model";
import type { ChildData, EnrollmentData, SchoolData } from "@/features/children/schemas";
import { SchoolYear } from "@/features/school-years/model";
import { Sponsorship } from "@/features/sponsorships/model";
import { recordAudit } from "@/lib/audit";
import {
  CLOUDINARY_FOLDERS,
  IMAGE_MAX_BYTES,
  destroyAsset,
  detectImageType,
  uploadPrivateImage,
  type StoredAsset,
} from "@/lib/cloudinary";
import { nextSequence, formatNumber } from "@/lib/db/counter";
import { connectDB, withTransaction } from "@/lib/db/mongoose";
import { parseDateInput } from "@/lib/dates";
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { fullName } from "@/lib/text";

/**
 * Règles du module Enfants. Les permissions sont vérifiées par les Server Actions appelantes.
 */

function isDuplicateKey(error: unknown): boolean {
  return error instanceof mongo.MongoServerError && error.code === 11000;
}

function toDocument(data: ChildData) {
  const birthDate = parseDateInput(data.birthDate);
  if (!birthDate) throw new ValidationError("Date de naissance invalide.", { birthDate: ["Date invalide."] });
  return { ...data, birthDate };
}

/** Refuse un enfant identique (même nom, prénom et date de naissance) déjà enregistré. */
async function assertNotDuplicate(data: ChildData, birthDate: Date, session: ClientSession, excludeId?: Types.ObjectId) {
  const duplicate = await Child.findOne(
    { identityKey: childIdentityKey(data.firstName, data.lastName), birthDate, ...(excludeId ? { _id: { $ne: excludeId } } : {}) },
    { code: 1, status: 1 },
  )
    .session(session)
    .lean();
  if (duplicate) {
    throw new ConflictError(
      `Un enfant portant ce nom et cette date de naissance existe déjà (${duplicate.code}${duplicate.status === "ARCHIVED" ? ", archivé" : ""}).`,
    );
  }
}

/* ------------------------------------------------------------------ Fiche enfant */

export async function createChild(actor: SessionUser, data: ChildData, ctx: RequestContext): Promise<string> {
  const document = toDocument(data);
  return withTransaction(async (session) => {
    await assertNotDuplicate(data, document.birthDate, session);
    const code = formatNumber("ENF", await nextSequence("child", session), 5);
    const [child] = await Child.create([{ ...document, code, createdBy: new Types.ObjectId(actor.id) }], { session });
    await recordAudit(actorOf(actor, ctx), {
      action: "child.create",
      summary: `Création de la fiche de ${fullName(data)} (${code}).`,
      entityType: "Child",
      entityId: child._id,
    }, session);
    return child._id.toString();
  });
}

export async function updateChild(actor: SessionUser, childId: string, data: ChildData, ctx: RequestContext): Promise<void> {
  const document = toDocument(data);
  await withTransaction(async (session) => {
    const child = await Child.findById(childId).session(session);
    if (!child) throw new NotFoundError("Enfant introuvable.");
    if (child.status === "ARCHIVED") throw new BusinessRuleError("La fiche est archivée : désarchivez-la avant de la modifier.");
    await assertNotDuplicate(data, document.birthDate, session, child._id);

    const tracked = ["firstName", "lastName", "birthDate", "sex", "birthPlace", "address", "city", "phone", "email"] as const;
    const changed = tracked.filter((field) => String(child.get(field) ?? "") !== String(document[field] ?? ""));
    child.set({ ...document, guardians: document.guardians });
    // Les champs facultatifs vidés sont effacés.
    for (const field of ["birthPlace", "address", "city", "phone", "email", "notes"] as const) {
      if (document[field] === undefined) child.set(field, undefined);
    }
    await child.save({ session });

    await recordAudit(actorOf(actor, ctx), {
      action: "child.update",
      summary: `Modification de la fiche de ${fullName(data)} (${child.code}).`,
      entityType: "Child",
      entityId: child._id,
      details: { changedFields: changed, guardians: document.guardians.length },
    }, session);
  });
}

export async function archiveChild(actor: SessionUser, childId: string, reason: string, ctx: RequestContext): Promise<void> {
  await withTransaction(async (session) => {
    const child = await Child.findById(childId, { firstName: 1, lastName: 1, code: 1, status: 1 }).session(session).lean();
    if (!child) throw new NotFoundError("Enfant introuvable.");
    if (child.status === "ARCHIVED") return;
    const activeSponsorships = await Sponsorship.countDocuments({ child: child._id, status: "ACTIVE" }).session(session);
    if (activeSponsorships > 0) {
      throw new BusinessRuleError(`L'enfant a ${activeSponsorships} parrainage(s) actif(s) : terminez-les avant d'archiver la fiche.`);
    }
    await Child.updateOne(
      { _id: child._id },
      { $set: { status: "ARCHIVED", archivedAt: new Date(), archivedBy: new Types.ObjectId(actor.id), archiveReason: reason } },
      { session },
    );
    await recordAudit(actorOf(actor, ctx), {
      action: "child.archive",
      summary: `Archivage de la fiche de ${fullName(child)} (${child.code}).`,
      entityType: "Child",
      entityId: child._id,
      details: { reason },
    }, session);
  });
}

export async function unarchiveChild(actor: SessionUser, childId: string, ctx: RequestContext): Promise<void> {
  await withTransaction(async (session) => {
    const child = await Child.findById(childId, { firstName: 1, lastName: 1, code: 1, status: 1 }).session(session).lean();
    if (!child) throw new NotFoundError("Enfant introuvable.");
    if (child.status === "ACTIVE") return;
    await Child.updateOne(
      { _id: child._id },
      { $set: { status: "ACTIVE" }, $unset: { archivedAt: 1, archivedBy: 1, archiveReason: 1 } },
      { session },
    );
    await recordAudit(actorOf(actor, ctx), {
      action: "child.unarchive",
      summary: `Réactivation de la fiche de ${fullName(child)} (${child.code}).`,
      entityType: "Child",
      entityId: child._id,
    }, session);
  });
}

/* ------------------------------------------------------------------ Photo */

/**
 * Remplace la photo : contrôle du contenu réel du fichier, téléversement en ressource authentifiée,
 * puis suppression de l'ancienne image. En cas d'échec de l'écriture en base, la nouvelle image
 * est supprimée pour ne pas laisser de fichier orphelin.
 */
export async function setChildPhoto(actor: SessionUser, childId: string, file: File, ctx: RequestContext): Promise<void> {
  if (file.size === 0) throw new ValidationError("Le fichier est vide.");
  if (file.size > IMAGE_MAX_BYTES) throw new ValidationError("La photo ne doit pas dépasser 3 Mo.");
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!detectImageType(buffer)) throw new ValidationError("Format non accepté : utilisez une image JPEG, PNG ou WebP.");

  await connectDB();
  const child = await Child.findById(childId, { firstName: 1, lastName: 1, code: 1, status: 1, photo: 1 }).lean();
  if (!child) throw new NotFoundError("Enfant introuvable.");
  if (child.status === "ARCHIVED") throw new BusinessRuleError("La fiche est archivée.");

  const uploaded = await uploadPrivateImage(buffer, CLOUDINARY_FOLDERS.childPhotos, file.name);
  try {
    await withTransaction(async (session) => {
      await Child.updateOne({ _id: child._id }, { $set: { photo: uploaded } }, { session });
      await recordAudit(actorOf(actor, ctx), {
        action: "child.photo.update",
        summary: `Mise à jour de la photo de ${fullName(child)} (${child.code}).`,
        entityType: "Child",
        entityId: child._id,
      }, session);
    });
  } catch (error) {
    await destroyAsset(uploaded);
    throw error;
  }
  if (child.photo) await destroyAsset(child.photo as StoredAsset);
}

export async function removeChildPhoto(actor: SessionUser, childId: string, ctx: RequestContext): Promise<void> {
  await connectDB();
  const child = await Child.findById(childId, { firstName: 1, lastName: 1, code: 1, photo: 1 }).lean();
  if (!child) throw new NotFoundError("Enfant introuvable.");
  if (!child.photo) return;
  await withTransaction(async (session) => {
    await Child.updateOne({ _id: child._id }, { $set: { photo: null } }, { session });
    await recordAudit(actorOf(actor, ctx), {
      action: "child.photo.remove",
      summary: `Suppression de la photo de ${fullName(child)} (${child.code}).`,
      entityType: "Child",
      entityId: child._id,
    }, session);
  });
  await destroyAsset(child.photo as StoredAsset);
}

/* ------------------------------------------------------------------ Établissements */

export async function createSchool(actor: SessionUser, data: SchoolData, ctx: RequestContext): Promise<string> {
  try {
    return await withTransaction(async (session) => {
      const [school] = await School.create([data], { session });
      await recordAudit(actorOf(actor, ctx), {
        action: "school.create",
        summary: `Création de l'établissement ${data.name}${data.city ? ` (${data.city})` : ""}.`,
        entityType: "School",
        entityId: school._id,
      }, session);
      return school._id.toString();
    });
  } catch (error) {
    if (isDuplicateKey(error)) throw new ConflictError("Cet établissement existe déjà dans cette ville.", { name: ["Déjà enregistré."] });
    throw error;
  }
}

export async function updateSchool(actor: SessionUser, schoolId: string, data: SchoolData, active: boolean, ctx: RequestContext): Promise<void> {
  try {
    await withTransaction(async (session) => {
      const school = await School.findById(schoolId).session(session);
      if (!school) throw new NotFoundError("Établissement introuvable.");
      school.set({ ...data, active });
      for (const field of ["city", "address", "phone", "email"] as const) {
        if (data[field] === undefined) school.set(field, undefined);
      }
      await school.save({ session });
      await recordAudit(actorOf(actor, ctx), {
        action: "school.update",
        summary: `Modification de l'établissement ${data.name}${active ? "" : " (désactivé)"}.`,
        entityType: "School",
        entityId: school._id,
      }, session);
    });
  } catch (error) {
    if (isDuplicateKey(error)) throw new ConflictError("Un établissement porte déjà ce nom dans cette ville.", { name: ["Déjà enregistré."] });
    throw error;
  }
}

/* ------------------------------------------------------------------ Scolarité */

export async function saveEnrollment(
  actor: SessionUser,
  childId: string,
  enrollmentId: string | undefined,
  data: EnrollmentData,
  ctx: RequestContext,
): Promise<void> {
  try {
    await withTransaction(async (session) => {
      // Lectures successives : pas d'opérations concurrentes dans une transaction.
      const child = await Child.findById(childId, { firstName: 1, lastName: 1, code: 1, status: 1 }).session(session).lean();
      const year = await SchoolYear.findById(data.schoolYearId, { label: 1 }).session(session).lean();
      const school = await School.findById(data.schoolId, { name: 1, active: 1 }).session(session).lean();
      if (!child) throw new NotFoundError("Enfant introuvable.");
      if (child.status === "ARCHIVED") throw new BusinessRuleError("La fiche est archivée.");
      if (!year) throw new NotFoundError("Année scolaire introuvable.");
      if (!school) throw new NotFoundError("Établissement introuvable.");

      const fields = {
        schoolYear: year._id,
        school: school._id,
        className: data.className,
        level: data.level,
        average: data.average,
        rank: data.rank,
        outcome: data.outcome,
        notes: data.notes,
      };

      if (enrollmentId) {
        const enrollment = await Enrollment.findOne({ _id: enrollmentId, child: child._id }).session(session);
        if (!enrollment) throw new NotFoundError("Inscription introuvable.");
        if (!school.active && !enrollment.school.equals(school._id)) {
          throw new BusinessRuleError("Cet établissement est désactivé.");
        }
        enrollment.set(fields);
        for (const field of ["level", "average", "rank", "notes"] as const) if (data[field] === undefined) enrollment.set(field, undefined);
        await enrollment.save({ session });
      } else {
        if (!school.active) throw new BusinessRuleError("Cet établissement est désactivé.");
        await Enrollment.create([{ ...fields, child: child._id }], { session });
      }

      await recordAudit(actorOf(actor, ctx), {
        action: enrollmentId ? "enrollment.update" : "enrollment.create",
        summary: `${enrollmentId ? "Mise à jour" : "Inscription"} de ${fullName(child)} — ${year.label}, ${school.name}, ${data.className}.`,
        entityType: "Child",
        entityId: child._id,
        schoolYear: year._id,
      }, session);
    });
  } catch (error) {
    if (isDuplicateKey(error)) {
      throw new ConflictError("Cet enfant a déjà une scolarité enregistrée pour cette année.", { schoolYearId: ["Déjà renseignée."] });
    }
    throw error;
  }
}

export async function deleteEnrollment(actor: SessionUser, childId: string, enrollmentId: string, ctx: RequestContext): Promise<void> {
  await withTransaction(async (session) => {
    const enrollment = await Enrollment.findOne({ _id: enrollmentId, child: childId })
      .populate<{ schoolYear: { label: string } }>("schoolYear", "label")
      .session(session)
      .lean();
    if (!enrollment) throw new NotFoundError("Inscription introuvable.");
    const child = await Child.findById(childId, { firstName: 1, lastName: 1, status: 1 }).session(session).lean();
    if (child?.status === "ARCHIVED") throw new BusinessRuleError("La fiche est archivée.");
    await Enrollment.deleteOne({ _id: enrollment._id }, { session });
    await recordAudit(actorOf(actor, ctx), {
      action: "enrollment.delete",
      summary: `Suppression de la scolarité ${enrollment.schoolYear.label} de ${child ? fullName(child) : "l'enfant"}.`,
      entityType: "Child",
      entityId: new Types.ObjectId(childId),
      details: { className: enrollment.className, school: enrollment.school },
    }, session);
  });
}
