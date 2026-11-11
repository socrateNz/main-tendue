import { z } from "zod";

import { objectIdSchema, optionalEmail, optionalPhone, optionalText } from "@/features/children/schemas";
import { isCountryCode } from "@/lib/countries";

import { SPONSOR_KINDS, SPONSOR_STATUSES } from "./types";

/**
 * Validations du module Sponsors (partagées formulaire / serveur).
 */

export const sponsorSchema = z
  .object({
    kind: z.enum(SPONSOR_KINDS, "Type de sponsor invalide."),
    firstName: optionalText(100),
    lastName: optionalText(100),
    organizationName: optionalText(200),
    email: optionalEmail,
    phone: optionalPhone,
    secondaryPhone: optionalPhone,
    address: z.object({
      line1: optionalText(200),
      line2: optionalText(200),
      postalCode: optionalText(20),
      city: optionalText(100),
      country: z
        .string()
        .trim()
        .toUpperCase()
        .refine((value) => isCountryCode(value), "Choisissez un pays."),
    }),
    notes: optionalText(5000),
  })
  .superRefine((data, ctx) => {
    if (data.kind === "PERSON") {
      if (!data.lastName) ctx.addIssue({ code: "custom", path: ["lastName"], message: "Le nom est obligatoire." });
      if (!data.firstName) ctx.addIssue({ code: "custom", path: ["firstName"], message: "Le prénom est obligatoire." });
    } else if (!data.organizationName) {
      ctx.addIssue({ code: "custom", path: ["organizationName"], message: "Le nom de l'organisation est obligatoire." });
    }
    if (!data.email && !data.phone) {
      ctx.addIssue({ code: "custom", path: ["email"], message: "Renseignez au moins une adresse e-mail ou un téléphone." });
    }
  });
export type SponsorInput = z.input<typeof sponsorSchema>;
export type SponsorData = z.output<typeof sponsorSchema>;

export const updateSponsorSchema = z.object({ sponsorId: objectIdSchema, data: sponsorSchema });

export const sponsorStatusSchema = z.object({
  sponsorId: objectIdSchema,
  status: z.enum(SPONSOR_STATUSES),
  reason: optionalText(500),
});
