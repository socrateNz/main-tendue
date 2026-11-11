"use server";

import { revalidatePath } from "next/cache";

import { objectIdSchema } from "@/features/children/schemas";
import { cancelMovementSchema } from "@/features/contributions/schemas";
import { categorySchema, expenseSchema, updateCategorySchema } from "@/features/expenses/schemas";
import { addExpenseAttachment, cancelExpense, createCategory, createExpense, updateCategory } from "@/features/expenses/service";
import { getRequestContext, requirePermission } from "@/lib/auth/session";
import { type ActionResult, toPublicError } from "@/lib/errors";
import { zodFieldErrors } from "@/lib/validation";

/** Saisie `expenses:write` ; catégories `expenseCategories:manage` ; annulation `finance:cancel`. */

function invalid(error: Parameters<typeof zodFieldErrors>[0], prefix = ""): ActionResult<never> {
  const fieldErrors = Object.fromEntries(Object.entries(zodFieldErrors(error)).map(([k, v]) => [prefix && k.startsWith(prefix) ? k.slice(prefix.length) : k, v]));
  return { ok: false, code: "VALIDATION", message: "Vérifiez les champs signalés.", fieldErrors };
}

function refresh() {
  for (const path of ["/depenses", "/enfants", "/annees-scolaires", "/rapports", "/tableau-de-bord"]) revalidatePath(path, "layout");
}

export async function createExpenseAction(input: unknown): Promise<ActionResult<{ expenseId: string }>> {
  try {
    const actor = await requirePermission("expenses:write");
    const parsed = expenseSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const expenseId = await createExpense(actor, parsed.data, await getRequestContext());
    refresh();
    return { ok: true, data: { expenseId }, message: "Dépense enregistrée." };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function cancelExpenseAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission("finance:cancel");
    const parsed = cancelMovementSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await cancelExpense(actor, parsed.data.id, parsed.data.reason, await getRequestContext());
    refresh();
    return { ok: true, data: undefined, message: "Dépense annulée. Elle reste consultable dans l'historique." };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function addExpenseAttachmentAction(formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requirePermission("expenses:write");
    const id = objectIdSchema.safeParse(formData.get("id"));
    const file = formData.get("file");
    if (!id.success) return { ok: false, code: "VALIDATION", message: "Identifiant invalide." };
    if (!(file instanceof File)) return { ok: false, code: "VALIDATION", message: "Aucun fichier reçu." };
    await addExpenseAttachment(actor, id.data, file, await getRequestContext());
    revalidatePath(`/depenses/${id.data}`);
    return { ok: true, data: undefined, message: "Justificatif ajouté." };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function createCategoryAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission("expenseCategories:manage");
    const parsed = categorySchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await createCategory(actor, parsed.data, await getRequestContext());
    revalidatePath("/depenses", "layout");
    return { ok: true, data: undefined, message: "Catégorie créée." };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function updateCategoryAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission("expenseCategories:manage");
    const parsed = updateCategorySchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error, "data.");
    await updateCategory(actor, parsed.data.categoryId, parsed.data.data, parsed.data.active, await getRequestContext());
    revalidatePath("/depenses", "layout");
    return { ok: true, data: undefined, message: "Catégorie mise à jour." };
  } catch (error) {
    return toPublicError(error);
  }
}
