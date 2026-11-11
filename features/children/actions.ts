"use server";

import { revalidatePath } from "next/cache";

import {
  archiveChildSchema,
  childSchema,
  objectIdSchema,
  saveEnrollmentSchema,
  schoolSchema,
  updateChildSchema,
  updateSchoolSchema,
} from "@/features/children/schemas";
import {
  archiveChild,
  createChild,
  createSchool,
  deleteEnrollment,
  removeChildPhoto,
  saveEnrollment,
  setChildPhoto,
  unarchiveChild,
  updateChild,
  updateSchool,
} from "@/features/children/service";
import { getRequestContext, requirePermission } from "@/lib/auth/session";
import { type ActionResult, toPublicError } from "@/lib/errors";
import { zodFieldErrors } from "@/lib/validation";

/** Chaque action vérifie sa permission côté serveur avant toute lecture ou écriture. */

function invalid(error: Parameters<typeof zodFieldErrors>[0], prefix = ""): ActionResult<never> {
  const fieldErrors = zodFieldErrors(error);
  const stripped = prefix
    ? Object.fromEntries(Object.entries(fieldErrors).map(([key, value]) => [key.startsWith(prefix) ? key.slice(prefix.length) : key, value]))
    : fieldErrors;
  return { ok: false, code: "VALIDATION", message: "Vérifiez les champs signalés.", fieldErrors: stripped };
}

function refreshChild(childId?: string) {
  revalidatePath("/enfants");
  if (childId) revalidatePath(`/enfants/${childId}`);
}

export async function createChildAction(input: unknown): Promise<ActionResult<{ childId: string }>> {
  try {
    const actor = await requirePermission("children:write");
    const parsed = childSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const childId = await createChild(actor, parsed.data, await getRequestContext());
    refreshChild();
    return { ok: true, data: { childId }, message: "Fiche créée." };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function updateChildAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission("children:write");
    const parsed = updateChildSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error, "data.");
    await updateChild(actor, parsed.data.childId, parsed.data.data, await getRequestContext());
    refreshChild(parsed.data.childId);
    return { ok: true, data: undefined, message: "Fiche mise à jour." };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function archiveChildAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission("children:archive");
    const parsed = archiveChildSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await archiveChild(actor, parsed.data.childId, parsed.data.reason, await getRequestContext());
    refreshChild(parsed.data.childId);
    return { ok: true, data: undefined, message: "Fiche archivée. Son historique reste consultable." };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function unarchiveChildAction(childId: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission("children:archive");
    const parsed = objectIdSchema.safeParse(childId);
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: "Identifiant invalide." };
    await unarchiveChild(actor, parsed.data, await getRequestContext());
    refreshChild(parsed.data);
    return { ok: true, data: undefined, message: "Fiche réactivée." };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function uploadChildPhotoAction(formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requirePermission("children:write");
    const childId = objectIdSchema.safeParse(formData.get("childId"));
    const file = formData.get("photo");
    if (!childId.success) return { ok: false, code: "VALIDATION", message: "Identifiant invalide." };
    if (!(file instanceof File)) return { ok: false, code: "VALIDATION", message: "Aucun fichier reçu." };
    await setChildPhoto(actor, childId.data, file, await getRequestContext());
    refreshChild(childId.data);
    return { ok: true, data: undefined, message: "Photo mise à jour." };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function removeChildPhotoAction(childId: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission("children:write");
    const parsed = objectIdSchema.safeParse(childId);
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: "Identifiant invalide." };
    await removeChildPhoto(actor, parsed.data, await getRequestContext());
    refreshChild(parsed.data);
    return { ok: true, data: undefined, message: "Photo supprimée." };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function saveEnrollmentAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission("children:write");
    const parsed = saveEnrollmentSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error, "data.");
    const { childId, enrollmentId, data } = parsed.data;
    await saveEnrollment(actor, childId, enrollmentId, data, await getRequestContext());
    refreshChild(childId);
    revalidatePath("/enfants/etablissements");
    return { ok: true, data: undefined, message: enrollmentId ? "Scolarité mise à jour." : "Scolarité enregistrée." };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function deleteEnrollmentAction(childId: unknown, enrollmentId: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission("children:write");
    const child = objectIdSchema.safeParse(childId);
    const enrollment = objectIdSchema.safeParse(enrollmentId);
    if (!child.success || !enrollment.success) return { ok: false, code: "VALIDATION", message: "Identifiant invalide." };
    await deleteEnrollment(actor, child.data, enrollment.data, await getRequestContext());
    refreshChild(child.data);
    return { ok: true, data: undefined, message: "Scolarité supprimée." };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function createSchoolAction(input: unknown): Promise<ActionResult<{ schoolId: string }>> {
  try {
    const actor = await requirePermission("schools:write");
    const parsed = schoolSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const schoolId = await createSchool(actor, parsed.data, await getRequestContext());
    revalidatePath("/enfants/etablissements");
    return { ok: true, data: { schoolId }, message: "Établissement créé." };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function updateSchoolAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission("schools:write");
    const parsed = updateSchoolSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error, "data.");
    await updateSchool(actor, parsed.data.schoolId, parsed.data.data, parsed.data.active, await getRequestContext());
    revalidatePath("/enfants/etablissements");
    return { ok: true, data: undefined, message: "Établissement mis à jour." };
  } catch (error) {
    return toPublicError(error);
  }
}
