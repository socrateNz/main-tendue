import { z } from "zod";

import { objectIdSchema, optionalText } from "@/features/children/schemas";
import { dateInputSchema } from "@/features/school-years/schemas";
import { parseDateInput } from "@/lib/dates";

/**
 * Validations du module Parrainages (partagées formulaire / serveur).
 */

const optionalDate = z
  .string()
  .optional()
  .transform((value) => (value ? value : undefined))
  .refine((value) => value === undefined || parseDateInput(value) !== null, "Date invalide.");

export const createSponsorshipSchema = z
  .object({
    sponsorId: objectIdSchema,
    childId: objectIdSchema,
    schoolYearId: objectIdSchema,
    startDate: dateInputSchema("La date de début"),
    endDate: optionalDate,
    notes: optionalText(2000),
  })
  .superRefine((data, ctx) => {
    if (data.endDate && data.endDate < data.startDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "La fin ne peut pas précéder le début." });
    }
  });
export type CreateSponsorshipInput = z.input<typeof createSponsorshipSchema>;
export type CreateSponsorshipData = z.output<typeof createSponsorshipSchema>;

export const updateSponsorshipSchema = z
  .object({
    sponsorshipId: objectIdSchema,
    startDate: dateInputSchema("La date de début"),
    endDate: optionalDate,
    notes: optionalText(2000),
  })
  .superRefine((data, ctx) => {
    if (data.endDate && data.endDate < data.startDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "La fin ne peut pas précéder le début." });
    }
  });
export type UpdateSponsorshipData = z.output<typeof updateSponsorshipSchema>;

export const SPONSORSHIP_TRANSITIONS = ["suspend", "resume", "end", "cancel"] as const;
export type SponsorshipTransition = (typeof SPONSORSHIP_TRANSITIONS)[number];

export const sponsorshipTransitionSchema = z
  .object({
    sponsorshipId: objectIdSchema,
    transition: z.enum(SPONSORSHIP_TRANSITIONS),
    reason: optionalText(500),
    endDate: optionalDate,
  })
  .superRefine((data, ctx) => {
    if (data.transition !== "resume" && (!data.reason || data.reason.length < 5)) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "Le motif doit contenir au moins 5 caractères." });
    }
    if (data.transition === "end" && !data.endDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "La date de fin est obligatoire." });
    }
  });
export type SponsorshipTransitionData = z.output<typeof sponsorshipTransitionSchema>;
