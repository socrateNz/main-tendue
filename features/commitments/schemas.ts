import { z } from "zod";

import { objectIdSchema, optionalText } from "@/features/children/schemas";
import { MAX_XAF_AMOUNT } from "@/lib/money";

const amount = (label: string, min: 0 | 1) =>
  z
    .number({ error: `${label} est obligatoire.` })
    .int("Montant entier en FCFA.")
    .min(min, min === 1 ? `${label} doit être supérieur à 0.` : `${label} ne peut pas être négatif.`)
    .max(MAX_XAF_AMOUNT, "Montant trop élevé.");

export const createCommitmentSchema = z.object({
  sponsorshipId: objectIdSchema,
  committedAmount: amount("Le montant engagé", 1),
  notes: optionalText(2000),
});

export const updateCommitmentSchema = z.object({
  commitmentId: objectIdSchema,
  committedAmount: amount("Le montant engagé", 1),
  notes: optionalText(2000),
});

export const adjustExpectedSchema = z.object({
  commitmentId: objectIdSchema,
  expectedAmount: amount("Le montant attendu", 0),
  reason: z.string().trim().min(5, "Le motif doit contenir au moins 5 caractères.").max(500),
});

export const cancelCommitmentSchema = z.object({
  commitmentId: objectIdSchema,
  reason: z.string().trim().min(5, "Le motif doit contenir au moins 5 caractères.").max(500),
});
