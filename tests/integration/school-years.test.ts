/**
 * Tests d'intégration — années scolaires, solde initial et trésorerie.
 * Base dédiée `parrainage_test_<horodatage>`, supprimée en fin d'exécution.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

const TEST_DB = `parrainage_test_${Date.now()}`;
process.env.MONGODB_DB = TEST_DB;

const mongoose = (await import("mongoose")).default;
const { Types } = mongoose;
const { connectDB } = await import("@/lib/db/mongoose");
const { SchoolYear } = await import("@/features/school-years/model");
const { Payment, CreditApplication } = await import("@/features/contributions/model");
const { Expense } = await import("@/features/expenses/model");
const { AuditLog } = await import("@/features/audit/model");
const years = await import("@/features/school-years/service");
const cashbox = await import("@/features/cashbox/service");
const { computeTreasuryOverview } = await import("@/features/school-years/treasury");
const { BusinessRuleError, ConflictError } = await import("@/lib/errors");
type SessionUser = import("@/features/auth/service").SessionUser;

const actor: SessionUser = {
  id: new Types.ObjectId().toString(),
  sessionId: new Types.ObjectId().toString(),
  email: "sa@test.local",
  firstName: "Super",
  lastName: "Admin",
  name: "Super ADMIN",
  role: "SUPER_ADMIN",
  mustChangePassword: false,
};
const ctx = { ip: "127.0.0.1", userAgent: "tests" };
const ids: Record<string, string> = {};

before(async () => {
  const instance = await connectDB();
  assert.equal(instance.connection.name, TEST_DB);
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()));
});

after(async () => {
  if (mongoose.connection.name === TEST_DB && /^parrainage_test_\d+$/.test(TEST_DB)) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

let sequence = 0;
async function insertPayment(yearId: string, receivedAt: string, lines: Array<{ kind: "COMMITMENT" | "DONATION" | "ADVANCE"; amount: number; commitmentYear?: string; late?: boolean }>, status: "VALID" | "CANCELLED" = "VALID") {
  const amountXaf = lines.reduce((sum, line) => sum + line.amount, 0);
  sequence += 1;
  const [payment] = await Payment.create([{
    number: `VRS-T-${sequence}`,
    sponsor: new Types.ObjectId(),
    schoolYear: new Types.ObjectId(yearId),
    receivedAt: new Date(`${receivedAt}T00:00:00Z`),
    method: "CASH",
    currency: { code: "XAF", originalAmountMinor: amountXaf, rate: "1", convertedAt: new Date() },
    amountXaf,
    lines: lines.map((line) => ({
      kind: line.kind,
      amount: line.amount,
      ...(line.kind === "COMMITMENT"
        ? { commitment: new Types.ObjectId(), commitmentYear: new Types.ObjectId(line.commitmentYear ?? yearId), lateSettlement: Boolean(line.late) }
        : {}),
    })),
    status,
    cancellation: status === "CANCELLED" ? { reason: "Erreur de saisie test", by: new Types.ObjectId(actor.id), at: new Date() } : null,
    createdBy: new Types.ObjectId(actor.id),
  }]);
  return payment;
}

describe("années scolaires et solde initial", () => {
  it("crée une année et refuse chevauchement et doublon", async () => {
    ids.y2025 = await years.createSchoolYear(actor, { label: "2025-2026", startDate: "2025-09-01", endDate: "2026-06-30" }, ctx);
    await assert.rejects(years.createSchoolYear(actor, { label: "2026-2027", startDate: "2026-06-15", endDate: "2027-06-30" }, ctx), BusinessRuleError);
    await assert.rejects(years.createSchoolYear(actor, { label: "2025-2026", startDate: "2025-08-01", endDate: "2025-08-30" }, ctx), ConflictError);
  });

  it("enregistre le solde initial une seule fois, dans la période de la première année", async () => {
    await assert.rejects(cashbox.createCashOpening(actor, { yearId: ids.y2025, amount: 500_000, date: "2025-07-01", reason: "Ouverture" }, ctx), BusinessRuleError);
    await cashbox.createCashOpening(actor, { yearId: ids.y2025, amount: 500_000, date: "2025-09-01", reason: "Reprise de la caisse existante" }, ctx);
    await assert.rejects(cashbox.createCashOpening(actor, { yearId: ids.y2025, amount: 0, date: "2025-09-02", reason: "Doublon" }, ctx), ConflictError);
    assert.equal(await AuditLog.countDocuments({ action: "cashOpening.create" }), 1);
  });

  it("refuse une année antérieure à celle du solde initial", async () => {
    await assert.rejects(years.createSchoolYear(actor, { label: "2024-2025", startDate: "2024-09-01", endDate: "2025-06-30" }, ctx), BusinessRuleError);
  });

  it("n'autorise qu'une année active et exige l'activation des années antérieures", async () => {
    ids.y2026 = await years.createSchoolYear(actor, { label: "2026-2027", startDate: "2026-09-01", endDate: "2027-06-30" }, ctx);
    await assert.rejects(years.activateSchoolYear(actor, ids.y2026, ctx), BusinessRuleError); // 2025 jamais activée
    await years.activateSchoolYear(actor, ids.y2025, ctx);
    await assert.rejects(years.activateSchoolYear(actor, ids.y2026, ctx), BusinessRuleError); // 2025 encore active
  });

  it("détermine l'année d'un mouvement par sa date et refuse les dates non couvertes", async () => {
    assert.equal((await years.resolveMovementYear(new Date("2025-10-01T15:30:00Z"))).label, "2025-2026");
    assert.equal((await years.resolveMovementYear(new Date("2026-06-30T23:00:00Z"))).label, "2025-2026");
    await assert.rejects(years.resolveMovementYear(new Date("2026-07-15T00:00:00Z")), BusinessRuleError);
  });

  it("refuse de déplacer une période si des mouvements en sortiraient", async () => {
    await insertPayment(ids.y2025, "2025-09-15", [{ kind: "DONATION", amount: 1 }], "CANCELLED"); // annulé : ignoré
    await insertPayment(ids.y2025, "2026-06-20", [{ kind: "DONATION", amount: 20_000 }]);
    await assert.rejects(
      years.updateSchoolYear(actor, { yearId: ids.y2025, label: "2025-2026", startDate: "2025-09-01", endDate: "2026-06-10" }, ctx),
      BusinessRuleError,
    );
  });
});

describe("trésorerie, clôture et arriérés", () => {
  it("calcule la caisse sur les seuls mouvements de trésorerie (sans les affectations d'avances)", async () => {
    await insertPayment(ids.y2025, "2025-10-05", [
      { kind: "COMMITMENT", amount: 100_000 },
      { kind: "ADVANCE", amount: 50_000 },
    ]);
    await insertPayment(ids.y2025, "2025-11-01", [{ kind: "DONATION", amount: 999_999 }], "CANCELLED");
    await Expense.create([{
      number: "DEP-T-1", schoolYear: new Types.ObjectId(ids.y2025), category: new Types.ObjectId(), amount: 30_000,
      spentAt: new Date("2025-10-10T00:00:00Z"), description: "Fournitures", scope: "GENERAL", createdBy: new Types.ObjectId(actor.id),
    }]);
    // Affectation d'avance : affectation pure, sans effet sur la caisse.
    const source = await Payment.findOne({ "lines.kind": "ADVANCE" }).lean();
    assert.ok(source);
    await CreditApplication.create([{
      number: "AFF-T-1", sponsor: source.sponsor, sourcePayment: source._id, sourceLine: source.lines[1]._id,
      sourceYear: source.schoolYear, commitment: new Types.ObjectId(), schoolYear: new Types.ObjectId(ids.y2025),
      amount: 50_000, validatedBy: new Types.ObjectId(actor.id), validatedAt: new Date(),
    }]);

    const overview = await computeTreasuryOverview();
    const y2025 = overview.years.find((year) => year.yearId === ids.y2025);
    assert.ok(y2025);
    assert.deepEqual(
      { ...y2025.figures },
      { openingBalance: 500_000, contributions: 100_000, lateContributions: 0, donations: 20_000, advances: 50_000, expenses: 30_000, closingBalance: 640_000 },
    );
    assert.equal(y2025.commitmentsNow.allocated, 150_000); // 100 000 versés + 50 000 d'avance affectée
    assert.equal(overview.advancesAvailable, 0);
  });

  it("refuse la clôture d'une année dont la période n'est pas terminée", async () => {
    const preview = await years.getClosingPreview(ids.y2026);
    assert.equal(preview.canClose, false);
  });

  it("clôture avec un instantané immuable, reporté en ouverture de l'année suivante", async () => {
    await years.closeSchoolYear(actor, ids.y2025, ctx);
    const closed = await SchoolYear.findById(ids.y2025).lean();
    assert.equal(closed?.status, "CLOSED");
    assert.equal(closed?.closing?.closingBalance, 640_000);
    assert.equal(closed?.closing?.commitmentsAllocatedAtClosing, 150_000);

    await assert.rejects(years.resolveMovementYear(new Date("2025-10-01T00:00:00Z")), BusinessRuleError);
    await assert.rejects(cashbox.correctCashOpening(actor, { amount: 400_000, reason: "Correction après contrôle" }, ctx), BusinessRuleError);
    await assert.rejects(years.createSchoolYear(actor, { label: "2024-2025", startDate: "2024-09-01", endDate: "2025-06-30" }, ctx), BusinessRuleError);
  });

  it("compte un règlement tardif dans la caisse de l'année d'encaissement sans toucher l'instantané", async () => {
    await years.activateSchoolYear(actor, ids.y2026, ctx);
    await insertPayment(ids.y2026, "2026-10-01", [{ kind: "COMMITMENT", amount: 40_000, commitmentYear: ids.y2025, late: true }]);

    const overview = await computeTreasuryOverview();
    const y2025 = overview.years.find((year) => year.yearId === ids.y2025);
    const y2026 = overview.years.find((year) => year.yearId === ids.y2026);
    assert.ok(y2025 && y2026);
    assert.equal(y2025.source, "snapshot");
    assert.equal(y2025.figures.closingBalance, 640_000, "instantané inchangé");
    assert.equal(y2025.commitmentsAtClosing?.allocated, 150_000);
    assert.equal(y2025.commitmentsNow.allocated, 190_000, "situation à date : arriéré inclus");
    assert.equal(y2026.figures.openingBalance, 640_000);
    assert.equal(y2026.figures.contributions, 40_000);
    assert.equal(y2026.figures.lateContributions, 40_000);
    assert.equal(y2026.figures.closingBalance, 680_000);
  });

  it("ne rouvre que la dernière année clôturée et conserve l'ancien instantané", async () => {
    await assert.rejects(years.reopenSchoolYear(actor, ids.y2026, "Pas clôturée donc refus", ctx), BusinessRuleError);
    await years.reopenSchoolYear(actor, ids.y2025, "Justificatif de dépense oublié", ctx);
    const reopened = await SchoolYear.findById(ids.y2025).lean();
    assert.equal(reopened?.status, "REOPENED");
    assert.equal(reopened?.closing, null);
    assert.equal(reopened?.reopenings[0].previousClosing.closingBalance, 640_000);

    // Correction du solde initial désormais possible, puis nouvelle clôture.
    await cashbox.correctCashOpening(actor, { amount: 450_000, reason: "Écart constaté au comptage" }, ctx);
    await years.closeSchoolYear(actor, ids.y2025, ctx);
    const reclosed = await SchoolYear.findById(ids.y2025).lean();
    assert.equal(reclosed?.closing?.closingBalance, 590_000);
    assert.equal((await computeTreasuryOverview()).years.find((y) => y.yearId === ids.y2026)?.figures.openingBalance, 590_000);
  });

  it("archive une année clôturée et ne supprime qu'une année en préparation vide", async () => {
    await years.setSchoolYearArchived(actor, ids.y2025, true, ctx);
    await assert.rejects(years.setSchoolYearArchived(actor, ids.y2026, true, ctx), BusinessRuleError);
    const draft = await years.createSchoolYear(actor, { label: "2027-2028", startDate: "2027-09-01", endDate: "2028-06-30" }, ctx);
    await years.deleteDraftSchoolYear(actor, draft, ctx);
    assert.equal(await SchoolYear.exists({ _id: draft }), null);
    await assert.rejects(years.deleteDraftSchoolYear(actor, ids.y2026, ctx), BusinessRuleError);
  });
});
