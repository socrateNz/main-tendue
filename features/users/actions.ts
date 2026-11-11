"use server";

import { revalidatePath } from "next/cache";

import { createUserSchema, updateUserSchema, userIdSchema } from "@/features/auth/schemas";
import {
  createUser,
  resetUserPassword,
  revokeSessionsOf,
  setUserStatus,
  updateUser,
} from "@/features/users/service";
import { getRequestContext, requirePermission } from "@/lib/auth/session";
import { type ActionResult, toPublicError } from "@/lib/errors";
import { zodFieldErrors } from "@/lib/validation";

/** Toutes les actions de ce module exigent `users:manage` (SUPER_ADMIN), vérifié côté serveur. */

const USERS_PATH = "/utilisateurs";

function invalid(error: Parameters<typeof zodFieldErrors>[0]): ActionResult<never> {
  return { ok: false, code: "VALIDATION", message: "Vérifiez les champs saisis.", fieldErrors: zodFieldErrors(error) };
}

export async function createUserAction(input: unknown): Promise<ActionResult<{ temporaryPassword: string }>> {
  try {
    const actor = await requirePermission("users:manage");
    const parsed = createUserSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const { temporaryPassword } = await createUser(actor, parsed.data, await getRequestContext());
    revalidatePath(USERS_PATH);
    return { ok: true, data: { temporaryPassword }, message: "Compte créé." };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function updateUserAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission("users:manage");
    const parsed = updateUserSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await updateUser(actor, parsed.data, await getRequestContext());
    revalidatePath(USERS_PATH);
    return { ok: true, data: undefined, message: "Compte mis à jour." };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function setUserStatusAction(input: unknown, status: "ACTIVE" | "DISABLED"): Promise<ActionResult> {
  try {
    const actor = await requirePermission("users:manage");
    const parsed = userIdSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    if (status !== "ACTIVE" && status !== "DISABLED") return { ok: false, code: "VALIDATION", message: "Statut invalide." };
    await setUserStatus(actor, parsed.data.userId, status, await getRequestContext());
    revalidatePath(USERS_PATH);
    return { ok: true, data: undefined, message: status === "DISABLED" ? "Compte désactivé." : "Compte réactivé." };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function resetUserPasswordAction(input: unknown): Promise<ActionResult<{ temporaryPassword: string }>> {
  try {
    const actor = await requirePermission("users:manage");
    const parsed = userIdSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const result = await resetUserPassword(actor, parsed.data.userId, await getRequestContext());
    revalidatePath(USERS_PATH);
    return { ok: true, data: result, message: "Mot de passe réinitialisé." };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function revokeUserSessionsAction(input: unknown): Promise<ActionResult<{ count: number }>> {
  try {
    const actor = await requirePermission("users:manage");
    const parsed = userIdSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const count = await revokeSessionsOf(actor, parsed.data.userId, await getRequestContext());
    revalidatePath(USERS_PATH);
    return { ok: true, data: { count }, message: `${count} session(s) fermée(s).` };
  } catch (error) {
    return toPublicError(error);
  }
}
