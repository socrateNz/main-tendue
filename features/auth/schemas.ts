import { z } from "zod";

import { ROLES } from "@/lib/auth/permissions";

/**
 * Validations partagées entre formulaires (client) et Server Actions (serveur).
 * Le serveur revalide systématiquement : la validation client n'est qu'un confort.
 */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "L'adresse e-mail est obligatoire.")
  .max(254, "Adresse trop longue.")
  .pipe(z.email("Adresse e-mail invalide."));

/** Politique de mot de passe : 12 caractères minimum, au moins une lettre et un chiffre, ≤ 72 octets (limite bcrypt). */
export const newPasswordSchema = z
  .string()
  .min(12, "12 caractères minimum.")
  .refine((value) => new TextEncoder().encode(value).length <= 72, "72 octets maximum.")
  .refine((value) => /\p{L}/u.test(value) && /\d/.test(value), "Au moins une lettre et un chiffre.");

export const loginSchema = z.object({
  email: emailSchema,
  // Pas de politique ici : on ne révèle rien sur les règles à un utilisateur non authentifié.
  password: z.string().min(1, "Le mot de passe est obligatoire.").max(256),
  next: z.string().max(500).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Le mot de passe actuel est obligatoire.").max(256),
    newPassword: newPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Les mots de passe ne correspondent pas.",
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    path: ["newPassword"],
    message: "Le nouveau mot de passe doit être différent de l'actuel.",
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

const nameSchema = (label: string) =>
  z.string().trim().min(1, `${label} est obligatoire.`).max(100, `${label} : 100 caractères maximum.`);

export const createUserSchema = z.object({
  email: emailSchema,
  firstName: nameSchema("Le prénom"),
  lastName: nameSchema("Le nom"),
  role: z.enum(ROLES, "Rôle invalide."),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = createUserSchema.omit({ email: true }).extend({
  userId: z.string().regex(/^[a-f0-9]{24}$/i, "Identifiant invalide."),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const userIdSchema = z.object({ userId: z.string().regex(/^[a-f0-9]{24}$/i, "Identifiant invalide.") });
