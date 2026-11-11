import type { z } from "zod";

import type { FieldErrors } from "@/lib/errors";

/** Convertit une erreur Zod en erreurs par champ (`a.b` pour les chemins imbriqués). */
export function zodFieldErrors(error: z.ZodError): FieldErrors {
  const result: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_form";
    (result[key] ??= []).push(issue.message);
  }
  return result;
}
