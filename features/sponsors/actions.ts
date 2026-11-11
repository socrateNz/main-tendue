"use server";

import { revalidatePath } from "next/cache";

import { objectIdSchema } from "@/features/children/schemas";
import { searchChildOptions, searchSponsorOptions, type PickerOption } from "@/features/sponsors/queries";
import { sponsorSchema, sponsorStatusSchema, updateSponsorSchema } from "@/features/sponsors/schemas";
import { createSponsor, removeSponsorPhoto, setSponsorPhoto, setSponsorStatus, updateSponsor } from "@/features/sponsors/service";
import { getRequestContext, requirePermission } from "@/lib/auth/session";
import { type ActionResult, toPublicError } from "@/lib/errors";
import { zodFieldErrors } from "@/lib/validation";

/** Chaque action vérifie sa permission côté serveur avant toute lecture ou écriture. */

function invalid(error: Parameters<typeof zodFieldErrors>[0], prefix = ""): ActionResult<never> {
  const fieldErrors = Object.fromEntries(
    Object.entries(zodFieldErrors(error)).map(([key, value]) => [prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key, value]),
  );
  return { ok: false, code: "VALIDATION", message: "Vérifiez les champs signalés.", fieldErrors };
}

function refresh(sponsorId?: string) {
  revalidatePath("/sponsors");
  if (sponsorId) revalidatePath(`/sponsors/${sponsorId}`);
}

export async function createSponsorAction(input: unknown): Promise<ActionResult<{ sponsorId: string }>> {
  try {
    const actor = await requirePermission("sponsors:write");
    const parsed = sponsorSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const sponsorId = await createSponsor(actor, parsed.data, await getRequestContext());
    refresh();
    return { ok: true, data: { sponsorId }, message: "Sponsor créé." };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function updateSponsorAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission("sponsors:write");
    const parsed = updateSponsorSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error, "data.");
    await updateSponsor(actor, parsed.data.sponsorId, parsed.data.data, await getRequestContext());
    refresh(parsed.data.sponsorId);
    return { ok: true, data: undefined, message: "Fiche mise à jour." };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function setSponsorStatusAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission("sponsors:write");
    const parsed = sponsorStatusSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await setSponsorStatus(actor, parsed.data.sponsorId, parsed.data.status, parsed.data.reason, await getRequestContext());
    refresh(parsed.data.sponsorId);
    return { ok: true, data: undefined, message: "Statut mis à jour." };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function uploadSponsorPhotoAction(formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requirePermission("sponsors:write");
    const sponsorId = objectIdSchema.safeParse(formData.get("id"));
    const file = formData.get("photo");
    if (!sponsorId.success) return { ok: false, code: "VALIDATION", message: "Identifiant invalide." };
    if (!(file instanceof File)) return { ok: false, code: "VALIDATION", message: "Aucun fichier reçu." };
    await setSponsorPhoto(actor, sponsorId.data, file, await getRequestContext());
    refresh(sponsorId.data);
    return { ok: true, data: undefined, message: "Photo mise à jour." };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function removeSponsorPhotoAction(sponsorId: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission("sponsors:write");
    const parsed = objectIdSchema.safeParse(sponsorId);
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: "Identifiant invalide." };
    await removeSponsorPhoto(actor, parsed.data, await getRequestContext());
    refresh(parsed.data);
    return { ok: true, data: undefined, message: "Photo supprimée." };
  } catch (error) {
    return toPublicError(error);
  }
}

/* ------------------------------------------------------------------ Sélecteurs (lecture) */

function query(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 100) : "";
}

export async function searchSponsorsAction(q: unknown): Promise<ActionResult<PickerOption[]>> {
  try {
    await requirePermission("sponsorships:write");
    return { ok: true, data: await searchSponsorOptions(query(q)) };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function searchChildrenAction(q: unknown): Promise<ActionResult<PickerOption[]>> {
  try {
    await requirePermission("sponsorships:write");
    return { ok: true, data: await searchChildOptions(query(q)) };
  } catch (error) {
    return toPublicError(error);
  }
}
