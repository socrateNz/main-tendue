import "server-only";

import mongoose, { type ClientSession } from "mongoose";

import { getEnv } from "@/lib/env";
import { ConfigError } from "@/lib/errors";

/**
 * Connexion MongoDB réutilisable, adaptée aux fonctions serverless de Vercel.
 *
 * La promesse de connexion est conservée sur `globalThis` : une même instance de fonction (et le
 * rechargement à chaud en développement) réutilise la connexion existante au lieu d'en ouvrir une
 * nouvelle à chaque requête.
 */

type MongooseCache = { promise: Promise<typeof mongoose> | null };

const globalForMongoose = globalThis as typeof globalThis & { __mongoose?: MongooseCache };
const cache: MongooseCache = (globalForMongoose.__mongoose ??= { promise: null });

mongoose.set("strictQuery", true);

export async function connectDB(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;

  if (!cache.promise) {
    const { MONGODB_URI, MONGODB_DB } = getEnv("database");
    cache.promise = mongoose
      .connect(MONGODB_URI, {
        dbName: MONGODB_DB,
        bufferCommands: false,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 10_000,
        // Les index sont créés au démarrage en développement ; en production on les synchronise
        // explicitement (script `db:indexes`) pour ne pas pénaliser les démarrages à froid.
        autoIndex: process.env.NODE_ENV !== "production",
      })
      .catch((error: unknown) => {
        cache.promise = null; // permet une nouvelle tentative à la requête suivante
        throw error;
      });
  }
  return cache.promise;
}

/**
 * Exécute `work` dans une transaction MongoDB (commit/abort et nouvelles tentatives sur erreurs
 * transitoires gérés par le pilote). Toute opération passée à `work` doit utiliser la `session`.
 *
 * Les transactions sont disponibles sur MongoDB Atlas (y compris l'offre gratuite M0).
 */
export async function withTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  await connectDB();
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(() => work(session), {
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" },
    });
  } finally {
    await session.endSession();
  }
}

/**
 * Exécute plusieurs lectures : en parallèle hors transaction, en SÉQUENCE dans une transaction
 * (MongoDB interdit les opérations concurrentes sur une même session transactionnelle).
 */
export async function gather<T extends readonly unknown[]>(
  session: ClientSession | null | undefined,
  tasks: { readonly [K in keyof T]: () => PromiseLike<T[K]> },
): Promise<T> {
  if (!session) return (await Promise.all(tasks.map((task) => task()))) as unknown as T;
  const results: unknown[] = [];
  for (const task of tasks) results.push(await task());
  return results as unknown as T;
}

/** Vérifie la disponibilité de la base (diagnostic). Ne lève jamais d'erreur. */
export async function pingDatabase(): Promise<{ ok: true; latencyMs: number } | { ok: false; reason: string }> {
  const started = Date.now();
  try {
    const instance = await connectDB();
    const db = instance.connection.db;
    if (!db) return { ok: false, reason: "Connexion non initialisée." };
    await db.admin().command({ ping: 1 });
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    const reason =
      error instanceof ConfigError
        ? "Variables MongoDB manquantes ou invalides."
        : name === "MongooseServerSelectionError" || name === "MongoServerSelectionError"
          ? "Serveur injoignable (vérifiez l'URI et l'accès réseau dans Atlas)."
          : name === "MongoServerError" || name === "MongoParseError"
            ? "Connexion refusée (identifiants ou URI invalides)."
            : "Connexion impossible.";
    return { ok: false, reason };
  }
}
