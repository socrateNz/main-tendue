import "server-only";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { resolveSession, type RequestContext, type SessionUser } from "@/features/auth/service";
import { CHANGE_PASSWORD_PATH, LOGIN_PATH, SESSION_COOKIE_NAME } from "@/lib/auth/config";
import { hasPermission, type Permission } from "@/lib/auth/permissions";
import { readSessionToken, signSessionToken } from "@/lib/auth/token";
import { getEnv } from "@/lib/env";
import { ForbiddenError, UnauthenticatedError } from "@/lib/errors";

/**
 * Couche d'accès à la session (Data Access Layer de l'authentification).
 *
 * Toute page, Server Action ou Route Handler sensible passe par `requireUser` / `requirePermission`
 * (ou leurs variantes) : la vérification est faite côté serveur à chaque appel, contre la base.
 */

/* ------------------------------------------------------------------ Cookie */

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const { JWT_SECRET } = getEnv("auth");
  const value = await signSessionToken(token, expiresAt, JWT_SECRET);
  (await cookies()).set(SESSION_COOKIE_NAME, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
    priority: "high",
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE_NAME);
}

/** Jeton de session en clair extrait du cookie signé (null si absent, falsifié ou expiré). */
export async function readSessionTokenFromCookie(): Promise<string | null> {
  const raw = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  return readSessionToken(raw, process.env.JWT_SECRET);
}

/* ------------------------------------------------------------------ Contexte de requête */

export async function getRequestContext(): Promise<RequestContext> {
  const list = await headers();
  const forwarded = list.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || list.get("x-real-ip") || null;
  return { ip: ip ? ip.slice(0, 64) : null, userAgent: list.get("user-agent") };
}

/* ------------------------------------------------------------------ Utilisateur courant */

/** Utilisateur de la requête courante (mémoïsé pour la durée du rendu). */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = await readSessionTokenFromCookie();
  if (!token) return null;
  return resolveSession(token);
});

/**
 * Pages : redirige vers la connexion sans session, et vers le changement de mot de passe
 * obligatoire tant qu'un mot de passe temporaire est en vigueur.
 */
export async function requireUser(options: { allowPendingPasswordChange?: boolean } = {}): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_PATH);
  if (user.mustChangePassword && !options.allowPendingPasswordChange) redirect(CHANGE_PASSWORD_PATH);
  return user;
}

export type PageAuthorization = { ok: true; user: SessionUser } | { ok: false; user: SessionUser };

/** Pages : vérifie une permission ; la page affiche un état « accès refusé » si `ok` est faux. */
export async function authorizePage(permission: Permission): Promise<PageAuthorization> {
  const user = await requireUser();
  return { ok: hasPermission(user.role, permission), user };
}

/**
 * Server Actions / Route Handlers : lève une erreur typée (convertie en réponse sûre) au lieu de
 * rediriger. À appeler en première instruction de chaque mutation.
 */
export async function requirePermission(
  permission: Permission,
  options: { allowPendingPasswordChange?: boolean } = {},
): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthenticatedError();
  if (user.mustChangePassword && !options.allowPendingPasswordChange) {
    throw new ForbiddenError("Vous devez d'abord changer votre mot de passe temporaire.");
  }
  if (!hasPermission(user.role, permission)) throw new ForbiddenError();
  return user;
}

/** Server Actions accessibles à tout utilisateur connecté (ex. changer son mot de passe). */
export async function requireAuthenticated(options: { allowPendingPasswordChange?: boolean } = {}): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthenticatedError();
  if (user.mustChangePassword && !options.allowPendingPasswordChange) {
    throw new ForbiddenError("Vous devez d'abord changer votre mot de passe temporaire.");
  }
  return user;
}
