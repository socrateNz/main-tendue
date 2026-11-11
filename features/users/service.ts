import "server-only";

import { type ClientSession, Types, mongo } from "mongoose";

import { Session, User } from "@/features/auth/model";
import type { CreateUserInput, UpdateUserInput } from "@/features/auth/schemas";
import { actorOf, revokeUserSessions, type RequestContext, type SessionUser } from "@/features/auth/service";
import { recordAudit, SYSTEM_ACTOR } from "@/lib/audit";
import { generateTemporaryPassword, hashPassword } from "@/lib/auth/password";
import { ROLE_LABELS, type AssignableRole } from "@/lib/auth/permissions";
import { connectDB, withTransaction } from "@/lib/db/mongoose";
import { escapeRegex, toPaginated, type ListParams, type Paginated } from "@/lib/db/pagination";
import { BusinessRuleError, ConflictError, NotFoundError } from "@/lib/errors";
import { fullName } from "@/lib/text";

/**
 * Gestion des comptes de l'organisation. Les contrôles de permission sont faits par l'appelant
 * (Server Action) ; ce service applique les règles métier.
 *
 * Le SUPER_ADMIN est un compte technique MASQUÉ : absent de la liste et des recherches, et toute
 * opération de gestion qui le vise répond « Compte introuvable », même si l'identifiant est connu.
 * Seul ce compte peut modifier ses propres informations de connexion (via « Mon compte »).
 */

export type UserListItem = {
  id: string;
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  role: AssignableRole;
  status: "ACTIVE" | "DISABLED";
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  activeSessions: number;
  createdAt: string;
};

export const USER_SORTS = ["name", "email", "role", "lastLoginAt", "createdAt"] as const;
export type UserSort = (typeof USER_SORTS)[number];

const SORT_FIELDS: Record<UserSort, string> = {
  name: "lastName",
  email: "email",
  role: "role",
  lastLoginAt: "lastLoginAt",
  createdAt: "createdAt",
};

export async function listUsers(params: ListParams<UserSort>): Promise<Paginated<UserListItem>> {
  await connectDB();
  const filter: Record<string, unknown> = { role: { $ne: HIDDEN_ROLE } };
  if (params.q) {
    const pattern = new RegExp(escapeRegex(params.q), "i");
    filter.$or = [{ email: pattern }, { firstName: pattern }, { lastName: pattern }];
  }
  const direction = params.dir === "asc" ? 1 : -1;
  const [users, total] = await Promise.all([
    User.find(filter)
      .sort({ [SORT_FIELDS[params.sort]]: direction, _id: 1 })
      .skip((params.page - 1) * params.pageSize)
      .limit(params.pageSize)
      .lean(),
    User.countDocuments(filter),
  ]);

  // Sessions actives de la page, en une seule agrégation (pas de N+1).
  const counts = await Session.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { user: { $in: users.map((u) => u._id) }, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } } },
    { $group: { _id: "$user", count: { $sum: 1 } } },
  ]);
  const sessionsByUser = new Map(counts.map((c) => [c._id.toString(), c.count]));

  const items = users.filter(isManageable).map<UserListItem>((user) => ({
    id: user._id.toString(),
    email: user.email,
    name: fullName(user),
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    activeSessions: sessionsByUser.get(user._id.toString()) ?? 0,
    createdAt: user.createdAt.toISOString(),
  }));
  return toPaginated(items, total, params);
}

const HIDDEN_ROLE = "SUPER_ADMIN" as const;

function isManageable<T extends { role: string }>(user: T): user is T & { role: AssignableRole } {
  return user.role !== HIDDEN_ROLE;
}

/** Compte gérable depuis l'application : le compte technique SUPER_ADMIN est traité comme inexistant. */
async function loadManageable(userId: string, session?: ClientSession) {
  if (!Types.ObjectId.isValid(userId)) throw new NotFoundError("Compte introuvable.");
  const user = await User.findById(userId).session(session ?? null).lean();
  if (!user || !isManageable(user)) throw new NotFoundError("Compte introuvable.");
  return user;
}

function isDuplicateKey(error: unknown): boolean {
  return error instanceof mongo.MongoServerError && error.code === 11000;
}


/** Crée un compte avec un mot de passe temporaire, retourné UNE seule fois à l'appelant. */
export async function createUser(actor: SessionUser, input: CreateUserInput, ctx: RequestContext) {
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  try {
    const user = await withTransaction(async (session) => {
      const [created] = await User.create(
        [{ ...input, passwordHash, mustChangePassword: true, createdBy: new Types.ObjectId(actor.id) }],
        { session },
      );
      await recordAudit(actorOf(actor, ctx), {
        action: "user.create",
        summary: `Création du compte ${fullName(input)} (${ROLE_LABELS[input.role]}).`,
        entityType: "User",
        entityId: created._id,
        details: { email: input.email, role: input.role },
      }, session);
      return created;
    });
    return { userId: user._id.toString(), temporaryPassword };
  } catch (error) {
    if (isDuplicateKey(error)) {
      throw new ConflictError("Un compte existe déjà avec cette adresse e-mail.", { email: ["Adresse déjà utilisée."] });
    }
    throw error;
  }
}

export async function updateUser(actor: SessionUser, input: UpdateUserInput, ctx: RequestContext): Promise<void> {
  await withTransaction(async (session) => {
    const user = await loadManageable(input.userId, session);

    if (user.role !== input.role && user._id.toString() === actor.id) {
      throw new BusinessRuleError("Vous ne pouvez pas modifier votre propre rôle.");
    }

    const before = { firstName: user.firstName, lastName: user.lastName, role: user.role };
    await User.updateOne(
      { _id: user._id },
      { $set: { firstName: input.firstName, lastName: input.lastName, role: input.role } },
      { session, runValidators: true },
    );

    await recordAudit(actorOf(actor, ctx), {
      action: "user.update",
      summary: `Modification du compte ${fullName(input)}.`,
      entityType: "User",
      entityId: user._id,
      details: { before, after: { firstName: input.firstName, lastName: input.lastName, role: input.role } },
    }, session);
  });
}

export async function setUserStatus(
  actor: SessionUser,
  userId: string,
  status: "ACTIVE" | "DISABLED",
  ctx: RequestContext,
): Promise<void> {
  await withTransaction(async (session) => {
    const user = await loadManageable(userId, session);
    if (user.status === status) return;
    if (status === "DISABLED" && user._id.toString() === actor.id) {
      throw new BusinessRuleError("Vous ne pouvez pas désactiver votre propre compte.");
    }
    await User.updateOne({ _id: user._id }, { $set: { status } }, { session, runValidators: true });
    if (status === "DISABLED") {
      await Session.updateMany({ user: user._id, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } }, { session });
    }
    await recordAudit(actorOf(actor, ctx), {
      action: status === "DISABLED" ? "user.disable" : "user.enable",
      summary: `${status === "DISABLED" ? "Désactivation" : "Réactivation"} du compte ${fullName(user)}.`,
      entityType: "User",
      entityId: user._id,
    }, session);
  });
}

/** Réinitialise le mot de passe (temporaire, retourné une seule fois) et ferme toutes les sessions. */
export async function resetUserPassword(actor: SessionUser, userId: string, ctx: RequestContext) {
  if (userId === actor.id) {
    throw new BusinessRuleError("Utilisez « Mon compte » pour changer votre propre mot de passe.");
  }
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  await withTransaction(async (session) => {
    const user = await loadManageable(userId, session);
    await User.updateOne(
      { _id: user._id },
      { $set: { passwordHash, mustChangePassword: true, passwordChangedAt: new Date() } },
      { session },
    );
    await Session.updateMany({ user: user._id, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } }, { session });
    await recordAudit(actorOf(actor, ctx), {
      action: "user.password.reset",
      summary: `Réinitialisation du mot de passe de ${fullName(user)}.`,
      entityType: "User",
      entityId: user._id,
    }, session);
  });
  return { temporaryPassword };
}

export async function revokeSessionsOf(actor: SessionUser, userId: string, ctx: RequestContext): Promise<number> {
  await connectDB();
  const user = await loadManageable(userId);
  const count = await revokeUserSessions(userId, userId === actor.id ? { exceptSessionId: actor.sessionId } : {});
  await recordAudit(actorOf(actor, ctx), {
    action: "user.sessions.revoke",
    summary: `Fermeture de ${count} session(s) de ${fullName(user)}.`,
    entityType: "User",
    entityId: user._id,
  });
  return count;
}

/* ------------------------------------------------------------------ Premier administrateur */

/**
 * Création du PREMIER super administrateur (script en ligne de commande uniquement).
 * Refusée dès qu'un super administrateur existe : aucun compte par défaut, aucune porte dérobée.
 */
export async function bootstrapSuperAdmin(input: Omit<CreateUserInput, "role">, password: string): Promise<string> {
  const passwordHash = await hashPassword(password);
  return withTransaction(async (session) => {
    const existing = await User.countDocuments({ role: "SUPER_ADMIN" }).session(session);
    if (existing > 0) {
      throw new BusinessRuleError("Un super administrateur existe déjà. Créez les autres comptes depuis l'application.");
    }
    const [user] = await User.create(
      [{ ...input, role: "SUPER_ADMIN", passwordHash, mustChangePassword: false, passwordChangedAt: new Date() }],
      { session },
    );
    await recordAudit({ ...SYSTEM_ACTOR, label: "Script create-admin" }, {
      action: "user.bootstrap",
      summary: `Création du premier super administrateur ${fullName(input)}.`,
      entityType: "User",
      entityId: user._id,
      details: { email: input.email },
    }, session);
    return user._id.toString();
  });
}
