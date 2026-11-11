import { z } from "zod";

import { objectIdSchema, optionalText } from "@/features/children/schemas";
import { dateInputSchema } from "@/features/school-years/schemas";
import { CURRENCY_CODES, MAX_XAF_AMOUNT, normalizeRate, parseMinorAmount } from "@/lib/money";

import { PAYMENT_METHODS } from "./types";

/**
 * Saisie d'un versement (docs/modele-donnees.md § 5). La conversion et la ventilation sont
 * recalculées et revérifiées par le service : le client n'envoie jamais le montant XAF final.
 */

const xaf = z.number().int("Montant entier en FCFA.").min(0).max(MAX_XAF_AMOUNT);

export const paymentSchema = z
  .object({
    sponsorId: objectIdSchema,
    receivedAt: dateInputSchema("La date du versement"),
    method: z.enum(PAYMENT_METHODS, "Moyen de paiement invalide."),
    reference: optionalText(100),
    currency: z.enum(CURRENCY_CODES, "Devise invalide."),
    /** Montant d'origine tel que saisi (« 150,50 » pour 150,50 €, « 100000 » pour 100 000 FCFA). */
    originalAmount: z.string().trim().min(1, "Le montant est obligatoire."),
    /** Taux « 1 unité = x FCFA » (ignoré pour XAF). */
    rate: z.string().trim().optional(),
    lines: z
      .array(z.object({ commitmentId: objectIdSchema, amount: xaf.min(1, "Montant supérieur à 0.") }))
      .max(50, "50 engagements maximum par versement."),
    donationAmount: xaf,
    advanceAmount: xaf,
    note: optionalText(2000),
  })
  .superRefine((data, ctx) => {
    if (parseMinorAmount(data.originalAmount, data.currency) === null || parseMinorAmount(data.originalAmount, data.currency) === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["originalAmount"],
        message: data.currency === "XAF" ? "Montant invalide (entier en FCFA)." : "Montant invalide (2 décimales maximum).",
      });
    }
    if (data.currency !== "XAF" && (!data.rate || normalizeRate(data.rate) === null)) {
      ctx.addIssue({ code: "custom", path: ["rate"], message: "Taux de conversion invalide (ex. 655,957)." });
    }
    const ids = data.lines.map((line) => line.commitmentId);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["lines"], message: "Un engagement ne peut figurer qu'une fois." });
  });
export type PaymentInput = z.input<typeof paymentSchema>;
export type PaymentData = z.output<typeof paymentSchema>;

export const cancelMovementSchema = z.object({
  id: objectIdSchema,
  reason: z.string().trim().min(5, "Le motif doit contenir au moins 5 caractères.").max(500),
});

export const applyAdvanceSchema = z.object({
  sponsorId: objectIdSchema,
  commitmentId: objectIdSchema,
  amount: xaf.min(1, "Montant supérieur à 0."),
  note: optionalText(1000),
});
export type ApplyAdvanceData = z.output<typeof applyAdvanceSchema>;
