import "server-only";

import { Types } from "mongoose";

import { Session, User } from "@/features/auth/model";
import type { ChangePasswordInput, LoginInput } from "@/features/auth/schemas";
import { recordAudit, type AuditActor } from "@/lib/audit";
import { SESSION_ABSOLUTE_TTL_MS, SESSION_IDLE_TTL_MS, SESSION_TOUCH_INTERVAL_MS } from "@/lib/auth/config";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import type { Role } from "@/lib/auth/permissions";
import { connectDB, withTransaction } from "@/lib/db/mongoose";
import { BusinessRuleError, RateLimitError, ValidationError } from "@/lib/errors";
import { clearFailures, getLock, registerFailure } from "@/lib/security/rate-limit";
import { generateToken, hashToken } from "@/lib/security/tokens";
import { fullName } from "@/lib/text";

/**
 * Service d'authentification — indépendant de Next.js (pas de cookies ici) pour rester testable.
 * La couche `lib/auth/session.ts` gère le cookie et appelle ce service.
 */

export type RequestContext = { ip: string | null; userAgent: string | null };

/** Utilisateur authentifié exposé au reste de l'application (DTO : aucun champ sensible). */
export type SessionUser = {
  id: string;
  sessionId: string;
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  role: Role;
  mustChangePassword: boolean;
};

const INVALID_CREDENTIALS = "Adresse e-mail ou mot de passe incorrect.";

export function actorOf(user: Pick<SessionUser, "id" | "name">, ctx?: RequestContext): AuditActor {
  return { id: user.id, label: user.name, ip: ctx?.ip, userAgent: ctx?.userAgent };
}

/* ------------------------------------------------------------------ Connexion */

export async function authenticate(
  input: LoginInput,
  ctx: RequestContext,
): Promise<{ token: string; expiresAt: Date; user: SessionUser }> {
  await connectDB();
  const emailKey = `email:${input.email}` as const;
  const ipKey = ctx.ip ? (`ip:${ctx.ip}` as const) : null;

  const lockedUntil = await getLock(ipKey ? [emailKey, ipKey] : [emailKey]);
  if (lockedUntil) {
    const minutes = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000));
    await recordAudit({ label: input.email, ip: ctx.ip, userAgent: ctx.userAgent }, {
      action: "auth.login.blocked",
      summary: `Tentative de connexion bloquée (verrouillage en cours) pour ${input.email}.`,
      entityType: "User",
    });
    throw new RateLimitError(`Trop de tentatives. Réessayez dans ${minutes} minute${minutes > 1 ? "s" : ""}.`);
  }

  const user = await User.findOne({ email: input.email }).select("+passwordHash").lean();
  // Comparaison effectuée même si le compte n'existe pas (temps de réponse constant).
  const passwordOk = await verifyPassword(input.password, user?.passwordHash);

  if (!user || !passwordOk || user.status !== "ACTIVE") {
    await registerFailure(emailKey);
    if (ipKey) await registerFailure(ipKey);
    await recordAudit({ id: user?._id, label: input.email, ip: ctx.ip, userAgent: ctx.userAgent }, {
      action: "auth.login.failed",
      summary: user && passwordOk ? `Connexion refusée : compte désactivé (${input.email}).` : `Échec de connexion pour ${input.email}.`,
      entityType: "User",
      entityId: user?._id,
    });
    throw new ValidationError(INVALID_CREDENTIALS);
  }

  await clearFailures(emailKey);
  const { token, expiresAt, sessionId } = await createSession(user._id, ctx);
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });

  const sessionUser = toSessionUser(user, sessionId);
  await recordAudit(actorOf(sessionUser, ctx), {
    action: "auth.login.success",
    summary: `Connexion de ${sessionUser.name}.`,
    entityType: "User",
    entityId: user._id,
  });
  return { token, expiresAt, user: sessionUser };
}

async function createSession(userId: Types.ObjectId, ctx: RequestContext) {
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS);
  const [session] = await Session.create([
    {
      tokenHash: hashToken(token),
      user: userId,
      expiresAt,
      lastSeenAt: now,
      ip: ctx.ip ?? undefined,
      userAgent: ctx.userAgent?.slice(0, 512) ?? undefined,
    },
  ]);
  return { token, expiresAt, sessionId: session._id.toString() };
}

type UserLike = {
  _id: Types.ObjectId;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  mustChangePassword?: boolean | null;
};

function toSessionUser(user: UserLike, sessionId: string): SessionUser {
  return {
    id: user._id.toString(),
    sessionId,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    name: fullName(user),
    role: user.role,
    mustChangePassword: Boolean(user.mustChangePassword),
  };
}

/* ------------------------------------------------------------------ Validation de session */

/**
 * Vérifie un jeton de session contre la base : session non révoquée, ni expirée, ni inactive depuis
 * trop longtemps, compte actif. Met à jour `lastSeenAt` au plus toutes les 5 minutes.
 */
export async function resolveSession(token: string): Promise<SessionUser | null> {
  await connectDB();
  const now = Date.now();
  const session = await Session.findOne({ tokenHash: hashToken(token) }).lean();
  if (!session || session.revokedAt) return null;
  if (session.expiresAt.getTime() <= now) return null;
  if (now - session.lastSeenAt.getTime() > SESSION_IDLE_TTL_MS) {
    await Session.updateOne({ _id: session._id }, { $set: { revokedAt: new Date() } });
    return null;
  }

  const user = await User.findById(session.user, { email: 1, firstName: 1, lastName: 1, role: 1, status: 1, mustChangePassword: 1 }).lean();
  if (!user || user.status !== "ACTIVE") return null;

  if (now - session.lastSeenAt.getTime() > SESSION_TOUCH_INTERVAL_MS) {
    await Session.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date(now) } });
  }
  return toSessionUser(user, session._id.toString());
}

/* ------------------------------------------------------------------ Déconnexion / révocation */

export async function revokeSessionByToken(token: string, ctx: RequestContext): Promise<void> {
  await connectDB();
  const session = await Session.findOneAndUpdate(
    { tokenHash: hashToken(token), revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  ).lean();
  if (session) {
    const user = await User.findById(session.user, { firstName: 1, lastName: 1 }).lean();
    await recordAudit({ id: session.user, label: user ? fullName(user) : "Utilisateur", ip: ctx.ip, userAgent: ctx.userAgent }, {
      action: "auth.logout",
      summary: "Déconnexion.",
      entityType: "User",
      entityId: session.user,
    });
  }
}

/** Révoque toutes les sessions actives d'un utilisateur (sauf, éventuellement, la session courante). */
export async function revokeUserSessions(userId: string, options: { exceptSessionId?: string } = {}): Promise<number> {
  await connectDB();
  const filter: Record<string, unknown> = { user: new Types.ObjectId(userId), revokedAt: { $exists: false } };
  if (options.exceptSessionId) filter._id = { $ne: new Types.ObjectId(options.exceptSessionId) };
  const result = await Session.updateMany(filter, { $set: { revokedAt: new Date() } });
  return result.modifiedCount;
}

/* ------------------------------------------------------------------ Mot de passe */

/** Changement de son propre mot de passe : vérifie l'actuel, révoque les autres sessions. */
export async function changeOwnPassword(user: SessionUser, input: ChangePasswordInput, ctx: RequestContext): Promise<void> {
  await connectDB();
  const current = await User.findById(user.id).select("+passwordHash").lean();
  if (!current) throw new BusinessRuleError("Compte introuvable.");
  if (!(await verifyPassword(input.currentPassword, current.passwordHash))) {
    throw new ValidationError("Le mot de passe actuel est incorrect.", { currentPassword: ["Mot de passe incorrect."] });
  }
  if (await verifyPassword(input.newPassword, current.passwordHash)) {
    throw new ValidationError("Choisissez un mot de passe différent de l'actuel.", { newPassword: ["Identique à l'actuel."] });
  }

  const passwordHash = await hashPassword(input.newPassword);
  await withTransaction(async (session) => {
    await User.updateOne(
      { _id: current._id },
      { $set: { passwordHash, passwordChangedAt: new Date(), mustChangePassword: false } },
      { session },
    );
    await recordAudit(actorOf(user, ctx), {
      action: "auth.password.change",
      summary: "Mot de passe modifié.",
      entityType: "User",
      entityId: current._id,
    }, session);
  });
  await revokeUserSessions(user.id, { exceptSessionId: user.sessionId });
}
