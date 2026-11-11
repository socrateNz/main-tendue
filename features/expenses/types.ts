import { splitEqually } from "@/lib/money";

export const EXPENSE_SCOPES = ["GENERAL", "INDIVIDUAL", "COLLECTIVE"] as const;
export type ExpenseScope = (typeof EXPENSE_SCOPES)[number];
export const EXPENSE_SCOPE_LABELS: Record<ExpenseScope, string> = {
  GENERAL: "Générale (sans enfant)",
  INDIVIDUAL: "Individuelle",
  COLLECTIVE: "Collective",
};

export const ALLOCATION_MODES = ["EQUAL", "MANUAL"] as const;
export type AllocationMode = (typeof ALLOCATION_MODES)[number];
export const ALLOCATION_MODE_LABELS: Record<AllocationMode, string> = {
  EQUAL: "Parts égales",
  MANUAL: "Saisie manuelle",
};

export type ExpenseAllocationInput = { childId: string; amount: number };

/** Répartition automatique à parts égales ; le reste va au premier enfant de la liste. */
export function equalAllocations(amount: number, childIds: readonly string[]): ExpenseAllocationInput[] {
  const parts = splitEqually(amount, childIds.length);
  return childIds.map((childId, index) => ({ childId, amount: parts[index] }));
}

export type AllocationCheck = { ok: true } | { ok: false; message: string };

/** Contrôles intrinsèques des allocations d'une dépense (docs/modele-donnees.md § 8). */
export function checkExpenseAllocations(
  amount: number,
  scope: ExpenseScope,
  mode: AllocationMode | null | undefined,
  allocations: readonly ExpenseAllocationInput[],
): AllocationCheck {
  if (scope === "GENERAL") {
    return allocations.length === 0
      ? { ok: true }
      : { ok: false, message: "Une dépense générale ne concerne aucun enfant." };
  }
  if (scope === "INDIVIDUAL" && allocations.length !== 1) {
    return { ok: false, message: "Une dépense individuelle concerne exactement un enfant." };
  }
  if (scope === "COLLECTIVE" && allocations.length < 2) {
    return { ok: false, message: "Une dépense collective concerne au moins deux enfants." };
  }
  if (scope === "COLLECTIVE" && !mode) {
    return { ok: false, message: "Choisissez un mode de répartition." };
  }

  const ids = new Set<string>();
  let total = 0;
  for (const allocation of allocations) {
    if (ids.has(allocation.childId)) return { ok: false, message: "Un enfant ne peut figurer qu'une fois." };
    ids.add(allocation.childId);
    if (!Number.isSafeInteger(allocation.amount) || allocation.amount < 0) {
      return { ok: false, message: "Chaque part doit être un montant entier positif." };
    }
    total += allocation.amount;
  }
  if (total !== amount) {
    return { ok: false, message: "La somme des parts doit être exactement égale au montant de la dépense." };
  }

  if (scope === "COLLECTIVE" && mode === "EQUAL") {
    const expected = splitEqually(amount, allocations.length);
    if (allocations.some((allocation, index) => allocation.amount !== expected[index])) {
      return { ok: false, message: "La répartition ne correspond pas à des parts égales." };
    }
  }
  return { ok: true };
}
