"use server";

import { revalidatePath } from "next/cache";

import { objectIdSchema } from "@/features/children/schemas";
import { getSponsorOpenItems, type OpenCommitment } from "@/features/contributions/queries";
import { applyAdvanceSchema, cancelMovementSchema, paymentSchema } from "@/features/contributions/schemas";
import { addPaymentAttachment, applyAdvance, cancelCreditApplication, cancelPayment, createPayment } from "@/features/contributions/service";
import { Sponsor } from "@/features/sponsors/model";
import { getRequestContext, requirePermission } from "@/lib/auth/session";
import { connectDB } from "@/lib/db/mongoose";
import { searchFilter } from "@/lib/db/pagination";
import { type ActionResult, toPublicError } from "@/lib/errors";
import { normalizeSearch } from "@/lib/text";
import { zodFieldErrors } from "@/lib/validation";

/**
 * Saisie : `payments:write` (FINANCE_MANAGER, ADMIN, SUPER_ADMIN).
 * Annulation : `finance:cancel` (FINANCE_MANAGER, ADMIN, SUPER_ADMIN).
 */

function invalid(error: Parameters<typeof zodFieldErrors>[0]): ActionResult<never> {
  return { ok: false, code: "VALIDATION", message: "Vérifiez les champs signalés.", fieldErrors: zodFieldErrors(error) };
}

function refresh() {
  for (const path of ["/contributions", "/sponsors", "/enfants", "/parrainages", "/annees-scolaires", "/rapports", "/tableau-de-bord"]) {
    revalidatePath(path, "layout");
  }
}

export async function createPaymentAction(input: unknown): Promise<ActionResult<{ paymentId: string }>> {
  try {
    const actor = await requirePermission("payments:write");
    const parsed = paymentSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const paymentId = await createPayment(actor, parsed.data, await getRequestContext());
    refresh();
    return { ok: true, data: { paymentId }, message: "Versement enregistré." };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function cancelPaymentAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission("finance:cancel");
    const parsed = cancelMovementSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await cancelPayment(actor, parsed.data.id, parsed.data.reason, await getRequestContext());
    refresh();
    return { ok: true, data: undefined, message: "Versement annulé. Il reste consultable dans l'historique." };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function addPaymentAttachmentAction(formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requirePermission("payments:write");
    const id = objectIdSchema.safeParse(formData.get("id"));
    const file = formData.get("file");
    if (!id.success) return { ok: false, code: "VALIDATION", message: "Identifiant invalide." };
    if (!(file instanceof File)) return { ok: false, code: "VALIDATION", message: "Aucun fichier reçu." };
    await addPaymentAttachment(actor, id.data, file, await getRequestContext());
    revalidatePath(`/contributions/${id.data}`);
    return { ok: true, data: undefined, message: "Justificatif ajouté." };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function applyAdvanceAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission("payments:write");
    const parsed = applyAdvanceSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await applyAdvance(actor, parsed.data, await getRequestContext());
    refresh();
    return { ok: true, data: undefined, message: "Avance affectée à l'engagement." };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function cancelCreditApplicationAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission("finance:cancel");
    const parsed = cancelMovementSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await cancelCreditApplication(actor, parsed.data.id, parsed.data.reason, await getRequestContext());
    refresh();
    return { ok: true, data: undefined, message: "Affectation annulée : le crédit est de nouveau disponible." };
  } catch (error) {
    return toPublicError(error);
  }
}

/* ------------------------------------------------------------------ Données de saisie */

export async function sponsorOpenItemsAction(sponsorId: unknown): Promise<ActionResult<{ commitments: OpenCommitment[]; advanceAvailable: number }>> {
  try {
    await requirePermission("payments:write");
    const parsed = objectIdSchema.safeParse(sponsorId);
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: "Identifiant invalide." };
    return { ok: true, data: await getSponsorOpenItems(parsed.data) };
  } catch (error) {
    return toPublicError(error);
  }
}

/** Sponsors pouvant verser : actifs ou inactifs (un ancien sponsor peut régler un arriéré). */
export async function searchPayingSponsorsAction(q: unknown): Promise<ActionResult<Array<{ id: string; label: string; description: string }>>> {
  try {
    await requirePermission("payments:write");
    await connectDB();
    const filter = { status: { $in: ["ACTIVE" as const, "INACTIVE" as const] }, ...searchFilter(typeof q === "string" ? q.slice(0, 100) : "", "searchText", normalizeSearch) };
    const sponsors = await Sponsor.find(filter, { code: 1, displayName: 1, email: 1, status: 1 }).sort({ sortName: 1 }).limit(10).lean();
    return {
      ok: true,
      data: sponsors.map((s) => ({ id: s._id.toString(), label: s.displayName, description: [s.code, s.email, s.status === "INACTIVE" ? "inactif" : null].filter(Boolean).join(" · ") })),
    };
  } catch (error) {
    return toPublicError(error);
  }
}
