export const COMMITMENT_STATUSES = ["ACTIVE", "CANCELLED"] as const;
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];
export const COMMITMENT_STATUS_LABELS: Record<CommitmentStatus, string> = {
  ACTIVE: "Actif",
  CANCELLED: "Annulé",
};

/** État de règlement — CALCULÉ, jamais stocké (docs/modele-donnees.md § 4). */
export const SETTLEMENT_STATES = ["UNPAID", "PARTIAL", "SETTLED"] as const;
export type SettlementState = (typeof SETTLEMENT_STATES)[number];
export const SETTLEMENT_STATE_LABELS: Record<SettlementState, string> = {
  UNPAID: "Non honoré",
  PARTIAL: "Partiellement honoré",
  SETTLED: "Honoré",
};

export type CommitmentFigures = {
  committed: number;
  expected: number;
  received: number;
  remaining: number;
  state: SettlementState;
};

/** Calcul des grandeurs d'un engagement à partir du montant attendu et du total reçu (XAF entiers). */
export function computeCommitmentFigures(committed: number, expected: number, received: number): CommitmentFigures {
  const remaining = Math.max(0, expected - received);
  const state: SettlementState = received >= expected ? "SETTLED" : received <= 0 ? "UNPAID" : "PARTIAL";
  return { committed, expected, received, remaining, state };
}
