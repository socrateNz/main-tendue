"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { objectIdSchema } from "@/features/children/schemas";
import { dateInputSchema } from "@/features/school-years/schemas";
import {
  prepareVideoUpload,
  publishVideo,
  regenerateLink,
  registerVideo,
  revokeLink,
  revokeVideo,
  updateVideoExpiry,
  type GeneratedLink,
} from "@/features/videos/service";
import { getRequestContext, requirePermission } from "@/lib/auth/session";
import { parseDateInput } from "@/lib/dates";
import { type ActionResult, toPublicError } from "@/lib/errors";
import { zodFieldErrors } from "@/lib/validation";

/** Toutes les actions exigent `videos:write` (MEDIA_MANAGER, ADMIN, SUPER_ADMIN). */

function invalid(error: Parameters<typeof zodFieldErrors>[0]): ActionResult<never> {
  return { ok: false, code: "VALIDATION", message: "Vérifiez les champs signalés.", fieldErrors: zodFieldErrors(error) };
}

function refresh(videoId?: string) {
  revalidatePath("/videos");
  if (videoId) revalidatePath(`/videos/${videoId}`);
}

export async function prepareVideoUploadAction(): Promise<ActionResult<ReturnType<typeof prepareVideoUpload>>> {
  try {
    await requirePermission("videos:write");
    return { ok: true, data: prepareVideoUpload() };
  } catch (error) {
    return toPublicError(error);
  }
}

const registerSchema = z.object({
  publicId: z.string().min(1).max(200),
  childId: objectIdSchema,
  schoolYearId: objectIdSchema,
  title: z.string().trim().min(2, "Le titre est obligatoire.").max(200),
  message: z.string().trim().max(2000).optional(),
});

export async function registerVideoAction(input: unknown): Promise<ActionResult<{ videoId: string }>> {
  try {
    const actor = await requirePermission("videos:write");
    const parsed = registerSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const videoId = await registerVideo(actor, parsed.data, await getRequestContext());
    refresh();
    return { ok: true, data: { videoId }, message: "Vidéo importée." };
  } catch (error) {
    return toPublicError(error);
  }
}

const expirySchema = z.object({ videoId: objectIdSchema, expiresAt: dateInputSchema("La date d'expiration") });

export async function publishVideoAction(input: unknown): Promise<ActionResult<{ links: GeneratedLink[] }>> {
  try {
    const actor = await requirePermission("videos:write");
    const parsed = expirySchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const links = await publishVideo(actor, parsed.data.videoId, endOfDay(parsed.data.expiresAt), await getRequestContext());
    refresh(parsed.data.videoId);
    return { ok: true, data: { links }, message: `${links.length} lien(s) privé(s) générés.` };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function regenerateLinkAction(input: unknown): Promise<ActionResult<{ link: GeneratedLink }>> {
  try {
    const actor = await requirePermission("videos:write");
    const parsed = z.object({ videoId: objectIdSchema, sponsorId: objectIdSchema }).safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const link = await regenerateLink(actor, parsed.data.videoId, parsed.data.sponsorId, await getRequestContext());
    refresh(parsed.data.videoId);
    return { ok: true, data: { link }, message: "Nouveau lien généré." };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function revokeLinkAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission("videos:write");
    const parsed = z.object({ linkId: objectIdSchema, videoId: objectIdSchema }).safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await revokeLink(actor, parsed.data.linkId, await getRequestContext());
    refresh(parsed.data.videoId);
    return { ok: true, data: undefined, message: "Lien révoqué." };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function revokeVideoAction(input: { id: string; reason: string }): Promise<ActionResult> {
  try {
    const actor = await requirePermission("videos:write");
    const parsed = z.object({ id: objectIdSchema, reason: z.string().trim().min(5).max(500) }).safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await revokeVideo(actor, parsed.data.id, parsed.data.reason, await getRequestContext());
    refresh(parsed.data.id);
    return { ok: true, data: undefined, message: "Tous les accès sont révoqués." };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function updateVideoExpiryAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission("videos:write");
    const parsed = expirySchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await updateVideoExpiry(actor, parsed.data.videoId, endOfDay(parsed.data.expiresAt), await getRequestContext());
    refresh(parsed.data.videoId);
    return { ok: true, data: undefined, message: "Date d'expiration mise à jour." };
  } catch (error) {
    return toPublicError(error);
  }
}

/** Une vidéo expire à la fin du jour choisi (23:59:59 UTC). */
function endOfDay(value: string): Date {
  const day = parseDateInput(value) ?? new Date(NaN);
  return new Date(day.getTime() + 24 * 3600 * 1000 - 1000);
}
