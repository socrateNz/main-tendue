"use server";

import { revalidatePath } from "next/cache";

import { correctCashOpening, createCashOpening } from "@/features/cashbox/service";
import {
  correctCashOpeningSchema,
  createCashOpeningSchema,
  createSchoolYearSchema,
  reopenSchoolYearSchema,
  updateSchoolYearSchema,
  yearIdSchema,
} from "@/features/school-years/schemas";
import {
  activateSchoolYear,
  closeSchoolYear,
  deleteDraftSchoolYear,
  getClosingPreview,
  reopenSchoolYear,
  setSchoolYearArchived,
  updateSchoolYear,
  createSchoolYear,
  type ClosingPreview,
} from "@/features/school-years/service";
import { getRequestContext, requirePermission } from "@/lib/auth/session";
import { type ActionResult, toPublicError } from "@/lib/errors";
import { zodFieldErrors } from "@/lib/validation";

/** Chaque action vérifie sa permission côté serveur avant toute lecture ou écriture. */

const BASE = "/annees-scolaires";

function invalid(error: Parameters<typeof zodFieldErrors>[0]): ActionResult<never> {
  return { ok: false, code: "VALIDATION", message: "Vérifiez les champs saisis.", fieldErrors: zodFieldErrors(error) };
}

function refresh(yearId?: string) {
  revalidatePath(BASE);
  if (yearId) revalidatePath(`${BASE}/${yearId}`);
  revalidatePath("/tableau-de-bord");
}

export async function createSchoolYearAction(input: unknown): Promise<ActionResult<{ yearId: string }>> {
  try {
    const actor = await requirePermission("schoolYears:manage");
    const parsed = createSchoolYearSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const yearId = await createSchoolYear(actor, parsed.data, await getRequestContext());
    refresh();
    return { ok: true, data: { yearId }, message: `Année ${parsed.data.label} créée.` };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function updateSchoolYearAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission("schoolYears:manage");
    const parsed = updateSchoolYearSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await updateSchoolYear(actor, parsed.data, await getRequestContext());
    refresh(parsed.data.yearId);
    return { ok: true, data: undefined, message: "Année scolaire mise à jour." };
  } catch (error) {
    return toPublicError(error);
  }
}

type YearOperation = "activate" | "close" | "archive" | "unarchive" | "delete";

export async function schoolYearOperationAction(input: unknown, operation: YearOperation): Promise<ActionResult> {
  try {
    const actor = await requirePermission("schoolYears:manage");
    const parsed = yearIdSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const ctx = await getRequestContext();
    const { yearId } = parsed.data;
    const messages: Record<YearOperation, string> = {
      activate: "Année activée.",
      close: "Année clôturée : l'instantané financier est figé.",
      archive: "Année archivée.",
      unarchive: "Année désarchivée.",
      delete: "Année supprimée.",
    };
    switch (operation) {
      case "activate":
        await activateSchoolYear(actor, yearId, ctx);
        break;
      case "close":
        await closeSchoolYear(actor, yearId, ctx);
        break;
      case "archive":
      case "unarchive":
        await setSchoolYearArchived(actor, yearId, operation === "archive", ctx);
        break;
      case "delete":
        await deleteDraftSchoolYear(actor, yearId, ctx);
        break;
      default:
        return { ok: false, code: "VALIDATION", message: "Opération inconnue." };
    }
    refresh(operation === "delete" ? undefined : yearId);
    return { ok: true, data: undefined, message: messages[operation] };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function closingPreviewAction(input: unknown): Promise<ActionResult<ClosingPreview>> {
  try {
    await requirePermission("schoolYears:manage");
    const parsed = yearIdSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    return { ok: true, data: await getClosingPreview(parsed.data.yearId) };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function reopenSchoolYearAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission("schoolYears:reopen");
    const parsed = reopenSchoolYearSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await reopenSchoolYear(actor, parsed.data.yearId, parsed.data.reason, await getRequestContext());
    refresh(parsed.data.yearId);
    return { ok: true, data: undefined, message: "Année rouverte. L'instantané précédent est conservé dans l'historique." };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function createCashOpeningAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission("cashbox:initialize");
    const parsed = createCashOpeningSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await createCashOpening(actor, parsed.data, await getRequestContext());
    refresh(parsed.data.yearId);
    return { ok: true, data: undefined, message: "Solde initial de la caisse enregistré." };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function correctCashOpeningAction(input: unknown, yearId: string): Promise<ActionResult> {
  try {
    const actor = await requirePermission("cashbox:initialize");
    const parsed = correctCashOpeningSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await correctCashOpening(actor, parsed.data, await getRequestContext());
    refresh(/^[a-f0-9]{24}$/i.test(yearId) ? yearId : undefined);
    return { ok: true, data: undefined, message: "Solde initial corrigé. La correction est tracée." };
  } catch (error) {
    return toPublicError(error);
  }
}
