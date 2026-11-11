import { NextResponse, type NextRequest } from "next/server";

import { HOME_PATH, LOGIN_PATH, PUBLIC_PATHS, SESSION_COOKIE_NAME } from "@/lib/auth/config";
import { readSessionToken } from "@/lib/auth/token";

/**
 * Contrôle OPTIMISTE : écarte immédiatement les requêtes sans cookie de session valablement signé.
 * Ce n'est pas la barrière de sécurité : révocation, inactivité, compte actif et permissions sont
 * vérifiés côté serveur (lib/auth/session.ts) sur chaque page et chaque mutation.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const sid = await readSessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value, process.env.JWT_SECRET);

  if (isPublic) {
    // Déjà connecté : inutile d'afficher la page de connexion.
    return sid ? NextResponse.redirect(new URL(HOME_PATH, request.url)) : NextResponse.next();
  }

  if (!sid) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
    }
    const url = new URL(LOGIN_PATH, request.url);
    if (pathname !== "/" && pathname !== HOME_PATH) url.searchParams.set("next", `${pathname}${search}`);
    const response = NextResponse.redirect(url);
    // Cookie présent mais invalide (expiré, falsifié) : on le supprime.
    if (request.cookies.has(SESSION_COOKIE_NAME)) response.cookies.delete(SESSION_COOKIE_NAME);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Tout sauf : ressources Next.js, fichiers statiques, tâches planifiées (protégées par
     * CRON_SECRET) et accès sponsors aux vidéos (protégés par jeton) — ces deux dernières routes
     * arriveront avec le module Vidéos.
     */
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|api/cron|v/|api/videos/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
