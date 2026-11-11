/**
 * Erreurs applicatives typées.
 *
 * Les services métier lèvent ces erreurs ; les Server Actions et Route Handlers les convertissent en
 * réponses sûres via `toPublicError`. Toute autre erreur est journalisée côté serveur et présentée à
 * l'utilisateur sous forme d'un message générique (aucun détail interne exposé).
 */

export type FieldErrors = Record<string, string[]>;

export type AppErrorCode =
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "BUSINESS_RULE"
  | "RATE_LIMITED"
  | "CONFIG"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly fieldErrors?: FieldErrors;

  constructor(code: AppErrorCode, message: string, status: number, fieldErrors?: FieldErrors) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Certaines informations sont invalides.", fieldErrors?: FieldErrors) {
    super("VALIDATION", message, 400, fieldErrors);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "Votre session a expiré. Veuillez vous reconnecter.") {
    super("UNAUTHENTICATED", message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Vous n'avez pas l'autorisation d'effectuer cette action.") {
    super("FORBIDDEN", message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Élément introuvable.") {
    super("NOT_FOUND", message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, fieldErrors?: FieldErrors) {
    super("CONFLICT", message, 409, fieldErrors);
  }
}

/** Violation d'une règle métier (ex. ventilation incohérente, année clôturée). */
export class BusinessRuleError extends AppError {
  constructor(message: string, fieldErrors?: FieldErrors) {
    super("BUSINESS_RULE", message, 422, fieldErrors);
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Trop de tentatives. Veuillez réessayer plus tard.") {
    super("RATE_LIMITED", message, 429);
  }
}

/** Configuration serveur manquante : le message ne contient que des noms de variables. */
export class ConfigError extends AppError {
  readonly group: string;
  readonly details: string[];

  constructor(group: string, details: string[]) {
    super("CONFIG", `Configuration « ${group} » incomplète : ${details.join(", ")}.`, 503);
    this.group = group;
    this.details = details;
  }
}

/** Résultat standard d'une Server Action consommée par un formulaire. */
export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; code: AppErrorCode; message: string; fieldErrors?: FieldErrors };

export type PublicError = Extract<ActionResult, { ok: false }>;

const GENERIC_MESSAGE = "Une erreur inattendue est survenue. Veuillez réessayer.";

export function toPublicError(error: unknown): PublicError {
  if (error instanceof ConfigError) {
    // Le détail (noms de variables) est utile aux administrateurs, il ne contient aucun secret.
    console.error(`[config] ${error.message}`);
    return { ok: false, code: error.code, message: "Le service n'est pas encore configuré. Contactez un administrateur." };
  }
  if (error instanceof AppError) {
    return { ok: false, code: error.code, message: error.message, fieldErrors: error.fieldErrors };
  }
  console.error("[unexpected]", error);
  return { ok: false, code: "INTERNAL", message: GENERIC_MESSAGE };
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
