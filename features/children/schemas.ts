import { z } from "zod";

import { dateInputSchema } from "@/features/school-years/schemas";
import { parseDateInput, startOfUtcDay } from "@/lib/dates";

import { ENROLLMENT_OUTCOMES, GUARDIAN_RELATIONSHIPS, SCHOOL_TYPES, SEXES } from "./types";

/**
 * Validations du module Enfants (partagées formulaire / serveur).
 */

export const objectIdSchema = z.string().regex(/^[a-f0-9]{24}$/i, "Identifiant invalide.");

/** Texte facultatif : une chaîne vide devient `undefined`. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `${max} caractères maximum.`)
    .optional()
    .transform((value) => (value ? value : undefined));

const requiredText = (label: string, max = 100) =>
  z.string().trim().min(1, `${label} est obligatoire.`).max(max, `${max} caractères maximum.`);

export const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .optional()
  .refine((value) => !value || z.email().safeParse(value).success, "Adresse e-mail invalide.")
  .transform((value) => (value ? value : undefined));

export const optionalPhone = z
  .string()
  .trim()
  .max(30, "30 caractères maximum.")
  .optional()
  .refine((value) => !value || /^[+0-9 ().-]{6,30}$/.test(value), "Numéro invalide (chiffres, espaces, +, -, parenthèses).")
  .transform((value) => (value ? value : undefined));

export const guardianSchema = z.object({
  relationship: z.enum(GUARDIAN_RELATIONSHIPS, "Lien de parenté invalide."),
  firstName: requiredText("Le prénom"),
  lastName: requiredText("Le nom"),
  phone: optionalPhone,
  email: optionalEmail,
  address: optionalText(300),
  occupation: optionalText(100),
  isPrimaryContact: z.boolean(),
});
export type GuardianInput = z.input<typeof guardianSchema>;

export const childSchema = z
  .object({
    firstName: requiredText("Le prénom"),
    lastName: requiredText("Le nom"),
    birthDate: dateInputSchema("La date de naissance"),
    sex: z.enum(SEXES, "Le sexe est obligatoire."),
    birthPlace: optionalText(100),
    address: optionalText(300),
    city: optionalText(100),
    phone: optionalPhone,
    email: optionalEmail,
    notes: optionalText(5000),
    guardians: z.array(guardianSchema).max(6, "6 parents ou tuteurs maximum."),
  })
  .superRefine((data, ctx) => {
    const birth = parseDateInput(data.birthDate);
    if (birth) {
      const today = startOfUtcDay(new Date());
      if (birth > today) ctx.addIssue({ code: "custom", path: ["birthDate"], message: "La date de naissance ne peut pas être future." });
      const ageYears = (today.getTime() - birth.getTime()) / (365.25 * 24 * 3600 * 1000);
      if (ageYears > 30) ctx.addIssue({ code: "custom", path: ["birthDate"], message: "Vérifiez la date de naissance (plus de 30 ans)." });
    }
    if (data.guardians.filter((guardian) => guardian.isPrimaryContact).length > 1) {
      ctx.addIssue({ code: "custom", path: ["guardians"], message: "Un seul contact principal est possible." });
    }
  });
export type ChildInput = z.input<typeof childSchema>;
export type ChildData = z.output<typeof childSchema>;

export const updateChildSchema = z.object({ childId: objectIdSchema, data: childSchema });

export const archiveChildSchema = z.object({
  childId: objectIdSchema,
  reason: z.string().trim().min(5, "Le motif doit contenir au moins 5 caractères.").max(500),
});

/* ------------------------------------------------------------------ Établissements */

export const schoolSchema = z.object({
  name: requiredText("Le nom de l'établissement", 200),
  type: z.enum(SCHOOL_TYPES, "Type invalide."),
  city: optionalText(100),
  address: optionalText(300),
  phone: optionalPhone,
  email: optionalEmail,
});
export type SchoolInput = z.input<typeof schoolSchema>;
export type SchoolData = z.output<typeof schoolSchema>;

export const updateSchoolSchema = z.object({ schoolId: objectIdSchema, data: schoolSchema, active: z.boolean() });

/* ------------------------------------------------------------------ Scolarité */

export const enrollmentSchema = z.object({
  schoolYearId: objectIdSchema,
  schoolId: objectIdSchema,
  className: requiredText("La classe", 50),
  level: optionalText(50),
  average: z
    .number({ error: "La moyenne doit être un nombre (ex. 12,5)." })
    .min(0, "La moyenne est comprise entre 0 et 20.")
    .max(20, "La moyenne est comprise entre 0 et 20.")
    .optional()
    .nullable()
    .transform((value) => (value === null ? undefined : value)),
  rank: optionalText(30),
  outcome: z.enum(ENROLLMENT_OUTCOMES, "Résultat invalide."),
  notes: optionalText(2000),
});
export type EnrollmentInput = z.input<typeof enrollmentSchema>;
export type EnrollmentData = z.output<typeof enrollmentSchema>;

export const saveEnrollmentSchema = z.object({
  childId: objectIdSchema,
  enrollmentId: objectIdSchema.optional(),
  data: enrollmentSchema,
});
