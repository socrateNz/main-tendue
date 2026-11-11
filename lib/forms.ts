import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

import type { PublicError } from "@/lib/errors";

/**
 * Reporte les erreurs renvoyées par une Server Action sur les champs du formulaire (React Hook Form).
 * Retourne le message global à afficher si aucune erreur n'a pu être rattachée à un champ.
 */
export function applyServerErrors<T extends FieldValues>(
  result: PublicError,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): string | null {
  let attached = false;
  for (const [key, messages] of Object.entries(result.fieldErrors ?? {})) {
    const field = fields.find((name) => name === key);
    if (field && messages[0]) {
      setError(field, { type: "server", message: messages[0] }, { shouldFocus: !attached });
      attached = true;
    }
  }
  return attached && result.code === "VALIDATION" ? null : result.message;
}
