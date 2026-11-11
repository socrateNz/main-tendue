import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeCommitmentFigures } from "@/features/commitments/types";
import { checkPaymentLines } from "@/features/contributions/types";
import { checkExpenseAllocations, equalAllocations } from "@/features/expenses/types";
import { computeClosingBalance, settlementTiming } from "@/features/school-years/types";
import { coverageRate, convertToXaf, normalizeRate, parseMinorAmount, splitEqually, sumXaf } from "@/lib/money";

describe("montants XAF", () => {
  it("additionne des entiers et refuse les décimaux", () => {
    assert.equal(sumXaf([100_000, 50_000, 25]), 150_025);
    assert.throws(() => sumXaf([10.5]));
    assert.throws(() => sumXaf([-1]));
  });

  it("répartit à parts égales et attribue le reste au premier enfant", () => {
    assert.deepEqual(splitEqually(1000, 3), [334, 333, 333]);
    assert.deepEqual(splitEqually(900, 3), [300, 300, 300]);
    assert.deepEqual(splitEqually(2, 3), [2, 0, 0]);
    assert.equal(sumXaf(splitEqually(1_234_567, 7)), 1_234_567);
  });

  it("calcule le taux de couverture borné", () => {
    assert.equal(coverageRate(50_000, 100_000), 50);
    assert.equal(coverageRate(0, 0), 0);
    assert.equal(coverageRate(33_333, 100_000), 33);
  });
});

describe("conversion de devises", () => {
  it("convertit EUR → XAF au taux fixe, en arithmétique exacte", () => {
    // 150,00 € × 655,957 = 98 393,55 → 98 394 (arrondi au plus proche)
    assert.equal(convertToXaf(15_000, "EUR", "655.957"), 98_394);
    // 1,00 € → 655,957 → 656
    assert.equal(convertToXaf(100, "EUR", "655.957"), 656);
    // 0,10 € (cas classique d'erreur flottante) → 65,5957 → 66
    assert.equal(convertToXaf(10, "EUR", "655.957"), 66);
  });

  it("arrondit le demi vers le haut", () => {
    // 0,01 $ × 50 = 0,5 → 1
    assert.equal(convertToXaf(1, "USD", "50"), 1);
  });

  it("impose un taux de 1 pour XAF", () => {
    assert.equal(convertToXaf(100_000, "XAF", "1"), 100_000);
    assert.throws(() => convertToXaf(100_000, "XAF", "2"));
  });

  it("valide et normalise les taux saisis", () => {
    assert.equal(normalizeRate("655,957"), "655.957");
    assert.equal(normalizeRate("600.500000"), "600.5");
    assert.equal(normalizeRate("0"), null);
    assert.equal(normalizeRate("-3"), null);
    assert.equal(normalizeRate("1.1234567"), null);
  });

  it("lit les montants saisis en unités mineures", () => {
    assert.equal(parseMinorAmount("150,50", "EUR"), 15_050);
    assert.equal(parseMinorAmount("1 250 000", "XAF"), 1_250_000);
    assert.equal(parseMinorAmount("12,5", "XAF"), null);
    assert.equal(parseMinorAmount("abc", "EUR"), null);
  });
});

describe("ventilation d'un versement", () => {
  it("accepte une ventilation exacte entre engagements, don et avance", () => {
    const result = checkPaymentLines(300_000, [
      { kind: "COMMITMENT", commitmentId: "a", amount: 100_000 },
      { kind: "COMMITMENT", commitmentId: "b", amount: 100_000 },
      { kind: "DONATION", amount: 50_000 },
      { kind: "ADVANCE", amount: 50_000 },
    ]);
    assert.deepEqual(result, { ok: true });
  });

  it("accepte un don sans engagement", () => {
    assert.deepEqual(checkPaymentLines(20_000, [{ kind: "DONATION", amount: 20_000 }]), { ok: true });
  });

  it("refuse une somme différente du montant du versement", () => {
    const result = checkPaymentLines(300_000, [{ kind: "COMMITMENT", commitmentId: "a", amount: 250_000 }]);
    assert.equal(result.ok, false);
  });

  it("refuse un engagement en double, une ligne sans engagement ou un montant nul", () => {
    assert.equal(
      checkPaymentLines(200, [
        { kind: "COMMITMENT", commitmentId: "a", amount: 100 },
        { kind: "COMMITMENT", commitmentId: "a", amount: 100 },
      ]).ok,
      false,
    );
    assert.equal(checkPaymentLines(100, [{ kind: "COMMITMENT", amount: 100 }]).ok, false);
    assert.equal(checkPaymentLines(0, [{ kind: "DONATION", amount: 0 }]).ok, false);
    assert.equal(checkPaymentLines(100, []).ok, false);
  });
});

describe("dépenses collectives", () => {
  it("génère des parts égales cohérentes", () => {
    const allocations = equalAllocations(100_000, ["a", "b", "c"]);
    assert.deepEqual(
      allocations.map((a) => a.amount),
      [33_334, 33_333, 33_333],
    );
    assert.deepEqual(checkExpenseAllocations(100_000, "COLLECTIVE", "EQUAL", allocations), { ok: true });
  });

  it("refuse une répartition manuelle dont la somme diffère du montant", () => {
    const result = checkExpenseAllocations(100_000, "COLLECTIVE", "MANUAL", [
      { childId: "a", amount: 60_000 },
      { childId: "b", amount: 30_000 },
    ]);
    assert.equal(result.ok, false);
  });

  it("accepte une répartition manuelle exacte", () => {
    const result = checkExpenseAllocations(100_000, "COLLECTIVE", "MANUAL", [
      { childId: "a", amount: 70_000 },
      { childId: "b", amount: 30_000 },
    ]);
    assert.deepEqual(result, { ok: true });
  });

  it("contrôle la cohérence portée / allocations", () => {
    assert.equal(checkExpenseAllocations(5_000, "GENERAL", null, []).ok, true);
    assert.equal(checkExpenseAllocations(5_000, "GENERAL", null, [{ childId: "a", amount: 5_000 }]).ok, false);
    assert.equal(checkExpenseAllocations(5_000, "INDIVIDUAL", null, [{ childId: "a", amount: 5_000 }]).ok, true);
    assert.equal(checkExpenseAllocations(5_000, "COLLECTIVE", "MANUAL", [{ childId: "a", amount: 5_000 }]).ok, false);
  });
});

describe("engagements", () => {
  it("distingue engagé, attendu, reçu et restant", () => {
    assert.deepEqual(computeCommitmentFigures(100_000, 100_000, 0), {
      committed: 100_000,
      expected: 100_000,
      received: 0,
      remaining: 100_000,
      state: "UNPAID",
    });
    assert.equal(computeCommitmentFigures(100_000, 100_000, 40_000).state, "PARTIAL");
    assert.equal(computeCommitmentFigures(100_000, 100_000, 40_000).remaining, 60_000);
    assert.equal(computeCommitmentFigures(100_000, 80_000, 80_000).state, "SETTLED");
    assert.equal(computeCommitmentFigures(100_000, 80_000, 80_000).remaining, 0);
  });
});

describe("caisse et arriérés", () => {
  it("calcule la clôture : ouverture + contributions + dons + avances − dépenses", () => {
    const closing = computeClosingBalance({
      openingBalance: 500_000,
      contributions: 1_200_000,
      donations: 100_000,
      advances: 300_000,
      expenses: 900_000,
    });
    assert.equal(closing, 1_200_000);
  });

  it("reporte la clôture d'une année comme ouverture de la suivante, sans recompter l'avance affectée", () => {
    // Année N : avance de 300 000 encaissée (trésorerie).
    const yearN = computeClosingBalance({ openingBalance: 0, contributions: 0, donations: 0, advances: 300_000, expenses: 0 });
    // Année N+1 : l'avance est affectée à un engagement (affectation pure) → aucune recette nouvelle.
    const yearN1 = computeClosingBalance({ openingBalance: yearN, contributions: 0, donations: 0, advances: 0, expenses: 50_000 });
    assert.equal(yearN, 300_000);
    assert.equal(yearN1, 250_000);
  });

  it("accepte un solde d'ouverture nul et refuse les montants non entiers", () => {
    assert.equal(computeClosingBalance({ openingBalance: 0, contributions: 0, donations: 0, advances: 0, expenses: 0 }), 0);
    assert.throws(() => computeClosingBalance({ openingBalance: 0, contributions: 10.5, donations: 0, advances: 0, expenses: 0 }));
    assert.throws(() => computeClosingBalance({ openingBalance: 0, contributions: 0, donations: 0, advances: 0, expenses: -1 }));
  });

  it("qualifie un règlement tardif, courant ou futur", () => {
    const y2025 = new Date("2025-09-01T00:00:00Z");
    const y2026 = new Date("2026-09-01T00:00:00Z");
    assert.equal(settlementTiming(y2026, y2025), "LATE");
    assert.equal(settlementTiming(y2026, y2026), "CURRENT");
    assert.equal(settlementTiming(y2025, y2026), "FUTURE");
  });
});
