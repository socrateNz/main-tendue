import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isValidSchoolYearLabel } from "@/features/school-years/types";
import { createSchoolYearSchema } from "@/features/school-years/schemas";
import { isWithinPeriod, parseDateInput, periodsOverlap, toDateInput } from "@/lib/dates";

const d = (value: string) => {
  const date = parseDateInput(value);
  assert.ok(date, value);
  return date;
};

describe("dates calendaires", () => {
  it("lit et réécrit une date sans décalage de fuseau", () => {
    assert.equal(toDateInput(d("2025-09-01")), "2025-09-01");
    assert.equal(parseDateInput("2025-02-30"), null);
    assert.equal(parseDateInput("01/09/2025"), null);
  });

  it("inclut les deux bornes d'une période, au jour près", () => {
    assert.equal(isWithinPeriod(new Date("2026-06-30T23:59:00Z"), d("2025-09-01"), d("2026-06-30")), true);
    assert.equal(isWithinPeriod(new Date("2025-09-01T00:00:00Z"), d("2025-09-01"), d("2026-06-30")), true);
    assert.equal(isWithinPeriod(new Date("2026-07-01T00:00:00Z"), d("2025-09-01"), d("2026-06-30")), false);
  });

  it("détecte les chevauchements, y compris d'un seul jour", () => {
    assert.equal(periodsOverlap(d("2025-09-01"), d("2026-06-30"), d("2026-06-30"), d("2027-06-30")), true);
    assert.equal(periodsOverlap(d("2025-09-01"), d("2026-06-30"), d("2026-07-01"), d("2027-06-30")), false);
  });
});

describe("validation d'une année scolaire", () => {
  it("exige deux années consécutives", () => {
    assert.equal(isValidSchoolYearLabel("2025-2026"), true);
    assert.equal(isValidSchoolYearLabel("2025-2027"), false);
    assert.equal(isValidSchoolYearLabel("25-26"), false);
  });

  it("refuse une fin avant le début, un début hors de la première année du libellé ou une durée excessive", () => {
    const ok = createSchoolYearSchema.safeParse({ label: "2025-2026", startDate: "2025-09-01", endDate: "2026-06-30" });
    assert.equal(ok.success, true);
    assert.equal(createSchoolYearSchema.safeParse({ label: "2025-2026", startDate: "2025-09-01", endDate: "2025-08-01" }).success, false);
    assert.equal(createSchoolYearSchema.safeParse({ label: "2025-2026", startDate: "2026-01-01", endDate: "2026-06-30" }).success, false);
    assert.equal(createSchoolYearSchema.safeParse({ label: "2025-2026", startDate: "2025-01-01", endDate: "2026-12-31" }).success, false);
  });
});
