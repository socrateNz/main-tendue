import "server-only";

import { User } from "@/features/auth/model";
import { CASH_OPENING_ID, CashOpening } from "@/features/cashbox/model";
import { SchoolYear } from "@/features/school-years/model";
import { pingCloudinary } from "@/lib/cloudinary";
import { connectDB, pingDatabase } from "@/lib/db/mongoose";
import { getEnvStatus, type EnvGroup } from "@/lib/env";

/**
 * Diagnostic de mise en service : uniquement des contrôles réels, aucune valeur secrète renvoyée.
 */

export type SetupCheck = {
  id: string;
  label: string;
  status: "ok" | "todo" | "error";
  detail: string;
};

const GROUP_LABELS: Record<EnvGroup, string> = {
  database: "Variables MongoDB",
  cloudinary: "Variable Cloudinary",
  auth: "Secret de session (JWT_SECRET)",
  cron: "Secret des tâches planifiées (CRON_SECRET)",
  app: "URL de l'application (NEXT_PUBLIC_APP_URL)",
};

export async function getSetupChecks(): Promise<SetupCheck[]> {
  const checks: SetupCheck[] = getEnvStatus().map((env) => ({
    id: `env-${env.group}`,
    label: GROUP_LABELS[env.group],
    status: env.ok ? "ok" : "todo",
    detail: env.ok ? "Renseignée et valide." : `À compléter : ${env.problems.join(", ")}.`,
  }));

  const [database, cloudinary] = await Promise.all([pingDatabase(), pingCloudinary()]);

  checks.push({
    id: "mongodb",
    label: "Connexion MongoDB Atlas",
    status: database.ok ? "ok" : "error",
    detail: database.ok ? `Connectée (${database.latencyMs} ms).` : database.reason,
  });
  checks.push({
    id: "cloudinary",
    label: "Connexion Cloudinary",
    status: cloudinary.ok ? "ok" : "error",
    detail: cloudinary.ok ? "Identifiants acceptés." : cloudinary.reason,
  });

  if (database.ok) {
    await connectDB();
    const [superAdmins, activeYear, cashOpening] = await Promise.all([
      User.countDocuments({ role: "SUPER_ADMIN", status: "ACTIVE" }),
      SchoolYear.findOne({ status: "ACTIVE" }, { label: 1 }).lean(),
      CashOpening.exists({ _id: CASH_OPENING_ID }),
    ]);
    checks.push({
      id: "super-admin",
      label: "Premier super administrateur",
      status: superAdmins > 0 ? "ok" : "todo",
      detail:
        superAdmins > 0
          ? `${superAdmins} compte(s) actif(s).`
          : "Aucun compte. Il sera créé par une commande sécurisée (phase Authentification).",
    });
    checks.push({
      id: "school-year",
      label: "Année scolaire active",
      status: activeYear ? "ok" : "todo",
      detail: activeYear ? `Année ${activeYear.label}.` : "Aucune année active (module Années scolaires).",
    });
    checks.push({
      id: "cash-opening",
      label: "Solde initial de la caisse",
      status: cashOpening ? "ok" : "todo",
      detail: cashOpening
        ? "Enregistré."
        : "Non enregistré. Le super administrateur le saisira sur la première année scolaire (0 accepté).",
    });
  }

  return checks;
}
