/**
 * - DRAFT    : en préparation (parrainages et engagements possibles) ;
 * - ACTIVE   : année courante (une seule à la fois) ;
 * - REOPENED : année clôturée puis rouverte exceptionnellement par un SUPER_ADMIN ;
 * - CLOSED   : clôturée, instantané figé, plus aucun mouvement daté dans sa période.
 */
export const SCHOOL_YEAR_STATUSES = ["DRAFT", "ACTIVE", "REOPENED", "CLOSED"] as const;
export type SchoolYearStatus = (typeof SCHOOL_YEAR_STATUSES)[number];

export const SCHOOL_YEAR_STATUS_LABELS: Record<SchoolYearStatus, string> = {
  DRAFT: "En préparation",
  ACTIVE: "Active",
  REOPENED: "Rouverte",
  CLOSED: "Clôturée",
};

/** Une année accepte de nouveaux mouvements financiers tant qu'elle n'est pas clôturée. */
export function acceptsMovements(status: SchoolYearStatus): boolean {
  return status !== "CLOSED";
}

/** « 2025-2026 » : deux années consécutives. */
export const SCHOOL_YEAR_LABEL_PATTERN = /^(\d{4})-(\d{4})$/;

export function isValidSchoolYearLabel(label: string): boolean {
  const match = SCHOOL_YEAR_LABEL_PATTERN.exec(label);
  return match !== null && Number(match[2]) === Number(match[1]) + 1;
}

/* ------------------------------------------------------------------ Trésorerie */

/**
 * Mouvements de TRÉSORERIE d'une année (montants XAF entiers, mouvements valides uniquement).
 * Les affectations d'avances (credit_applications) n'en font jamais partie : elles ne sont pas des
 * entrées de caisse (docs/modele-donnees.md § 0 et § 8).
 */
export type YearTreasury = {
  openingBalance: number;
  /** Lignes COMMITMENT des versements de l'année, arriérés d'années antérieures inclus. */
  contributions: number;
  donations: number;
  advances: number;
  expenses: number;
};

/** Solde de clôture = ouverture + contributions + dons + avances − dépenses. */
export function computeClosingBalance(treasury: YearTreasury): number {
  const { openingBalance, contributions, donations, advances, expenses } = treasury;
  for (const value of [contributions, donations, advances, expenses]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("Montant de trésorerie invalide.");
  }
  if (!Number.isSafeInteger(openingBalance)) throw new RangeError("Solde d'ouverture invalide.");
  return openingBalance + contributions + donations + advances - expenses;
}

/** Instantané immuable figé à la clôture (docs/modele-donnees.md § 8). */
export type ClosingSnapshot = YearTreasury & {
  /** Part des contributions correspondant à des règlements tardifs d'engagements antérieurs. */
  lateContributions: number;
  closingBalance: number;
  commitmentsExpected: number;
  commitmentsAllocatedAtClosing: number;
  advancesAvailableAtClosing: number;
  closedAt: Date;
};

/* ------------------------------------------------------------------ Arriérés */

export type SettlementTiming = "CURRENT" | "LATE" | "FUTURE";

/**
 * Situe l'année d'un engagement par rapport à l'année du mouvement (comparaison des dates de début,
 * les périodes ne se chevauchant pas) :
 * - CURRENT : même année ;
 * - LATE    : engagement d'une année antérieure → règlement tardif, autorisé même si l'année est clôturée ;
 * - FUTURE  : engagement d'une année postérieure → refusé en contribution directe (passer par une avance).
 */
export function settlementTiming(movementYearStart: Date, commitmentYearStart: Date): SettlementTiming {
  const diff = commitmentYearStart.getTime() - movementYearStart.getTime();
  return diff === 0 ? "CURRENT" : diff < 0 ? "LATE" : "FUTURE";
}
