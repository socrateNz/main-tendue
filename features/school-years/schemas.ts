import { z } from "zod";

import { MAX_XAF_AMOUNT } from "@/lib/money";
import { parseDateInput } from "@/lib/dates";

import { isValidSchoolYearLabel } from "./types";

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, "Identifiant invalide.");

export const dateInputSchema = (label: string) =>
  z
    .string({ error: `${label} est obligatoire.` })
    .min(1, `${label} est obligatoire.`)
    .refine((value) => parseDateInput(value) !== null, `${label} est invalide.`);

const periodFields = {
  label: z
    .string()
    .trim()
    .refine(isValidSchoolYearLabel, "Format attendu : deux années consécutives, par exemple 2025-2026."),
  startDate: dateInputSchema("La date de début"),
  endDate: dateInputSchema("La date de fin"),
  notes: z.string().trim().max(2000, "2 000 caractères maximum.").optional(),
};

function checkPeriod<T extends { label: string; startDate: string; endDate: string }>(data: T, ctx: z.RefinementCtx) {
  const start = parseDateInput(data.startDate);
  const end = parseDateInput(data.endDate);
  if (!start || !end) return;
  if (end <= start) {
    ctx.addIssue({ code: "custom", path: ["endDate"], message: "La date de fin doit être postérieure à la date de début." });
  }
  const firstYear = Number(data.label.slice(0, 4));
  if (Number.isFinite(firstYear) && start.getUTCFullYear() !== firstYear) {
    ctx.addIssue({ code: "custom", path: ["startDate"], message: `L'année ${data.label} doit commencer en ${firstYear}.` });
  }
  if (end.getTime() - start.getTime() > 400 * 24 * 60 * 60 * 1000) {
    ctx.addIssue({ code: "custom", path: ["endDate"], message: "Une année scolaire ne peut pas dépasser 13 mois." });
  }
}

export const createSchoolYearSchema = z.object(periodFields).superRefine(checkPeriod);
export type CreateSchoolYearInput = z.infer<typeof createSchoolYearSchema>;

export const updateSchoolYearSchema = z.object({ yearId: objectId, ...periodFields }).superRefine(checkPeriod);
export type UpdateSchoolYearInput = z.infer<typeof updateSchoolYearSchema>;

export const yearIdSchema = z.object({ yearId: objectId });

export const reasonSchema = (min: number) =>
  z.string().trim().min(min, `Le motif doit contenir au moins ${min} caractères.`).max(1000, "1 000 caractères maximum.");

export const reopenSchoolYearSchema = z.object({ yearId: objectId, reason: reasonSchema(10) });

/* ------------------------------------------------------------------ Solde initial */

const amountSchema = z
  .number({ error: "Le montant est obligatoire." })
  .int("Le montant doit être un nombre entier de FCFA.")
  .min(0, "Le montant ne peut pas être négatif.")
  .max(MAX_XAF_AMOUNT, "Montant trop élevé.");

export const createCashOpeningSchema = z.object({
  yearId: objectId,
  amount: amountSchema,
  date: dateInputSchema("La date"),
  reason: reasonSchema(5),
});
export type CreateCashOpeningInput = z.infer<typeof createCashOpeningSchema>;

export const correctCashOpeningSchema = z.object({
  amount: amountSchema,
  reason: reasonSchema(10),
});
export type CorrectCashOpeningInput = z.infer<typeof correctCashOpeningSchema>;
