import "server-only";

import { LoginAttempt } from "@/features/auth/model";
import { LOGIN_RATE_LIMIT } from "@/lib/auth/config";
import { connectDB } from "@/lib/db/mongoose";

/**
 * Limitation des tentatives de connexion, stockée dans MongoDB (partagée entre toutes les instances
 * serverless). Les compteurs expirent automatiquement (index TTL).
 */

export type RateLimitKey = `email:${string}` | `ip:${string}`;

/** Retourne la date de fin de blocage si la clé est actuellement bloquée. */
export async function getLock(keys: RateLimitKey[]): Promise<Date | null> {
  await connectDB();
  const now = new Date();
  const locked = await LoginAttempt.findOne({ key: { $in: keys }, lockedUntil: { $gt: now } }, { lockedUntil: 1 })
    .sort({ lockedUntil: -1 })
    .lean();
  return locked?.lockedUntil ?? null;
}

/** Enregistre un échec ; verrouille la clé si le seuil est atteint dans la fenêtre. */
export async function registerFailure(key: RateLimitKey): Promise<void> {
  await connectDB();
  const now = new Date();
  const windowStart = new Date(now.getTime() - LOGIN_RATE_LIMIT.windowMs);
  const max = key.startsWith("email:") ? LOGIN_RATE_LIMIT.maxFailuresPerAccount : LOGIN_RATE_LIMIT.maxFailuresPerIp;

  // Nouvelle fenêtre si la précédente est échue, sinon incrément atomique.
  const doc = await LoginAttempt.findOneAndUpdate(
    { key },
    [
      {
        $set: {
          count: { $cond: [{ $lt: ["$windowStart", windowStart] }, 1, { $add: [{ $ifNull: ["$count", 0] }, 1] }] },
          windowStart: { $cond: [{ $lt: ["$windowStart", windowStart] }, now, { $ifNull: ["$windowStart", now] }] },
          expiresAt: new Date(now.getTime() + LOGIN_RATE_LIMIT.windowMs + LOGIN_RATE_LIMIT.lockMs),
        },
      },
    ],
    { upsert: true, returnDocument: "after", updatePipeline: true },
  ).lean();

  if (doc && doc.count >= max) {
    await LoginAttempt.updateOne({ key }, { $set: { lockedUntil: new Date(now.getTime() + LOGIN_RATE_LIMIT.lockMs) } });
  }
}

/** Réinitialise le compteur d'un compte après une connexion réussie. */
export async function clearFailures(key: RateLimitKey): Promise<void> {
  await connectDB();
  await LoginAttempt.deleteOne({ key });
}
