import type { CurrencyCode } from "@/lib/money";

export const PAYMENT_METHODS = ["CASH", "BANK_TRANSFER", "MOBILE_MONEY", "CHECK", "CARD", "OTHER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Espèces",
  BANK_TRANSFER: "Virement bancaire",
  MOBILE_MONEY: "Mobile Money",
  CHECK: "Chèque",
  CARD: "Carte bancaire",
  OTHER: "Autre",
};

/** Statut d'un mouvement financier (versement, affectation d'avance, dépense). */
export const MOVEMENT_STATUSES = ["VALID", "CANCELLED"] as const;
export type MovementStatus = (typeof MOVEMENT_STATUSES)[number];
export const MOVEMENT_STATUS_LABELS: Record<MovementStatus, string> = {
  VALID: "Validé",
  CANCELLED: "Annulé",
};

/**
 * Ventilation d'un versement (docs/modele-donnees.md § 5) :
 * - COMMITMENT : contribution affectée à un engagement ;
 * - DONATION   : don libre, distinct des contributions ;
 * - ADVANCE    : avance conservée comme crédit, affectée plus tard après validation explicite.
 */
export const PAYMENT_LINE_KINDS = ["COMMITMENT", "DONATION", "ADVANCE"] as const;
export type PaymentLineKind = (typeof PAYMENT_LINE_KINDS)[number];
export const PAYMENT_LINE_KIND_LABELS: Record<PaymentLineKind, string> = {
  COMMITMENT: "Contribution à un engagement",
  DONATION: "Don libre",
  ADVANCE: "Avance (crédit)",
};

export type PaymentLineInput = { kind: PaymentLineKind; commitmentId?: string; amount: number };

export type PaymentLinesCheck = { ok: true } | { ok: false; message: string };

/**
 * Contrôles intrinsèques d'une ventilation (sans accès à la base) — partagés par le formulaire,
 * la validation Zod, le service métier et le schéma Mongoose.
 * Le plafond par engagement (≤ restant dû) est vérifié par le service, qui connaît les soldes.
 */
export function checkPaymentLines(amountXaf: number, lines: readonly PaymentLineInput[]): PaymentLinesCheck {
  if (lines.length === 0) return { ok: false, message: "La ventilation doit comporter au moins une ligne." };

  let total = 0;
  const seen = new Set<string>();
  let donationLines = 0;
  let advanceLines = 0;

  for (const line of lines) {
    if (!Number.isSafeInteger(line.amount) || line.amount <= 0) {
      return { ok: false, message: "Chaque ligne doit avoir un montant entier strictement positif." };
    }
    total += line.amount;

    if (line.kind === "COMMITMENT") {
      if (!line.commitmentId) return { ok: false, message: "Une contribution doit viser un engagement." };
      if (seen.has(line.commitmentId)) {
        return { ok: false, message: "Un même engagement ne peut apparaître qu'une fois par versement." };
      }
      seen.add(line.commitmentId);
    } else {
      if (line.commitmentId) return { ok: false, message: "Un don ou une avance ne vise pas d'engagement." };
      if (line.kind === "DONATION") donationLines += 1;
      if (line.kind === "ADVANCE") advanceLines += 1;
    }
  }

  if (donationLines > 1 || advanceLines > 1) {
    return { ok: false, message: "Regroupez le don libre et l'avance chacun sur une seule ligne." };
  }
  if (total !== amountXaf) {
    return { ok: false, message: "La somme des affectations doit être exactement égale au montant du versement." };
  }
  return { ok: true };
}

export type PaymentCurrencyInput = {
  code: CurrencyCode;
  originalAmountMinor: number;
  rate: string;
  convertedAt: Date;
};
