"use server";

import { redirect } from "next/navigation";

import { authenticate, changeOwnPassword, revokeSessionByToken } from "@/features/auth/service";
import { changePasswordSchema, loginSchema } from "@/features/auth/schemas";
import { LOGIN_PATH, safeRedirectPath } from "@/lib/auth/config";
import {
  clearSessionCookie,
  getRequestContext,
  readSessionTokenFromCookie,
  requireAuthenticated,
  setSessionCookie,
} from "@/lib/auth/session";
import { type ActionResult, toPublicError } from "@/lib/errors";
import { zodFieldErrors } from "@/lib/validation";

/**
 * Server Actions d'authentification. Next.js vérifie l'origine des requêtes de Server Action
 * (en-tête Origin comparé à l'hôte) : une requête inter-sites est rejetée avant d'arriver ici.
 */

export async function loginAction(input: unknown): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "VALIDATION", message: "Vérifiez les champs saisis.", fieldErrors: zodFieldErrors(parsed.error) };
  }

  let destination: string;
  try {
    const { token, expiresAt, user } = await authenticate(parsed.data, await getRequestContext());
    await setSessionCookie(token, expiresAt);
    destination = user.mustChangePassword ? "/mon-compte/mot-de-passe" : safeRedirectPath(parsed.data.next);
  } catch (error) {
    return toPublicError(error);
  }
  redirect(destination);
}

export async function logoutAction(): Promise<void> {
  const token = await readSessionTokenFromCookie();
  if (token) {
    try {
      await revokeSessionByToken(token, await getRequestContext());
    } catch (error) {
      // La déconnexion côté navigateur a lieu quoi qu'il arrive ; l'échec est journalisé.
      console.error("[logout]", error);
    }
  }
  await clearSessionCookie();
  redirect(LOGIN_PATH);
}

export async function changePasswordAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireAuthenticated({ allowPendingPasswordChange: true });
    const parsed = changePasswordSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: "Vérifiez les champs saisis.", fieldErrors: zodFieldErrors(parsed.error) };
    }
    await changeOwnPassword(user, parsed.data, await getRequestContext());
    return { ok: true, data: undefined, message: "Mot de passe modifié. Vos autres sessions ont été fermées." };
  } catch (error) {
    return toPublicError(error);
  }
}
