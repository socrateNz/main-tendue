import "server-only";

import { z } from "zod";

import { ConfigError } from "@/lib/errors";

/**
 * Variables d'environnement serveur, validées à la demande.
 *
 * Chaque groupe est validé indépendamment : une variable Cloudinary manquante ne doit pas empêcher
 * l'authentification de fonctionner, et inversement. Les valeurs ne sont jamais incluses dans les
 * messages d'erreur, seuls les noms des variables le sont.
 */

const secret = z.string().min(32, "doit contenir au moins 32 caractères");

const groups = {
  database: z.object({
    MONGODB_URI: z
      .string()
      .regex(/^mongodb(\+srv)?:\/\//, "doit commencer par mongodb:// ou mongodb+srv://")
      .refine((v) => !/<[^>]+>/.test(v), "contient encore un modèle du type <db_password>"),
    MONGODB_DB: z.string().min(1).default("parrainage"),
  }),
  cloudinary: z.object({
    CLOUDINARY_URL: z
      .string()
      .regex(
        /^cloudinary:\/\/[^:\s]+:[^@\s]+@[^\s/]+$/,
        "format attendu : cloudinary://API_KEY:API_SECRET@CLOUD_NAME",
      ),
  }),
  auth: z.object({
    JWT_SECRET: secret,
  }),
  cron: z.object({
    CRON_SECRET: secret,
  }),
  app: z.object({
    NEXT_PUBLIC_APP_URL: z.url(),
  }),
} as const;

export type EnvGroup = keyof typeof groups;
type EnvOf<G extends EnvGroup> = z.infer<(typeof groups)[G]>;

const cache = new Map<EnvGroup, unknown>();

function read(group: EnvGroup) {
  const shape = groups[group].shape;
  const raw: Record<string, string | undefined> = {};
  for (const key of Object.keys(shape)) {
    const value = process.env[key]?.trim();
    raw[key] = value === "" ? undefined : value;
  }
  return groups[group].safeParse(raw);
}

/** Retourne les variables d'un groupe ou lève une `ConfigError` explicite (sans les valeurs). */
export function getEnv<G extends EnvGroup>(group: G): EnvOf<G> {
  const cached = cache.get(group);
  if (cached) return cached as EnvOf<G>;

  const result = read(group);
  if (!result.success) {
    const details = result.error.issues.map((issue) => {
      const name = String(issue.path[0] ?? "?");
      return issue.code === "invalid_type" ? `${name} : non renseignée` : `${name} : ${issue.message}`;
    });
    throw new ConfigError(group, details);
  }
  cache.set(group, result.data);
  return result.data as EnvOf<G>;
}

export type EnvStatus = { group: EnvGroup; ok: boolean; problems: string[] };

/** Diagnostic de configuration (noms de variables uniquement). */
export function getEnvStatus(): EnvStatus[] {
  return (Object.keys(groups) as EnvGroup[]).map((group) => {
    const result = read(group);
    return {
      group,
      ok: result.success,
      problems: result.success
        ? []
        : result.error.issues.map((issue) => {
            const name = String(issue.path[0] ?? "?");
            return issue.code === "invalid_type" ? `${name} non renseignée` : `${name} ${issue.message}`;
          }),
    };
  });
}
