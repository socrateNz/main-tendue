/**
 * Tests d'intégration — engagements, versements, avances, caisse (règles validées).
 * Base dédiée `parrainage_test_<horodatage>`, supprimée en fin d'exécution.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

const TEST_DB = `parrainage_test_${Date.now()}`;
process.env.MONGODB_DB = TEST_DB;

const mongoose = (await import("mongoose")).default;
const { Types } = mongoose;
const { connectDB } = await import("@/lib/db/mongoose");
const { Payment, CreditApplication } = await import("@/features/contributions/model");
const { SchoolYear } = await import("@/features/school-years/model");
const { childSchema } = await import("@/features/children/schemas");
const { sponsorSchema } = await import("@/features/sponsors/schemas");
const { createSponsorshipSchema } = await import("@/features/sponsorships/schemas");
const { paymentSchema } = await import("@/features/contributions/schemas");
const children = await import("@/features/children/service");
const sponsors = await import("@/features/sponsors/service");
const sponsorships = await import("@/features/sponsorships/service");
const commitments = await import("@/features/commitments/service");
const contributions = await import("@/features/contributions/service");
const years = await import("@/features/school-years/service");
const cashbox = await import("@/features/cashbox/service");
const { listCommitments } = await import("@/features/commitments/queries");
const { computeTreasuryOverview } = await import("@/features/school-years/treasury");
const { BusinessRuleError, ConflictError } = await import("@/lib/errors");
type SessionUser = import("@/features/auth/service").SessionUser;

const actor: SessionUser = {
  id: new Types.ObjectId().toString(),
  sessionId: new Types.ObjectId().toString(),
  email: "fm@test.local",
  firstName: "Fanny",
  lastName: "Finance",
  name: "Fanny FINANCE",
  role: "SUPER_ADMIN",
  mustChangePassword: false,
};
const ctx = { ip: "127.0.0.1", userAgent: "tests" };
const ids: Record<string, string> = {};

const pay = (overrides: Record<string, unknown>) =>
  paymentSchema.parse({
    sponsorId: ids.sponsor,
    receivedAt: "2025-10-01",
    method: "BANK_TRANSFER",
    currency: "XAF",
    originalAmount: "0",
    lines: [],
    donationAmount: 0,
    advanceAmount: 0,
    ...overrides,
  });
const situation = async (commitmentId: string) => (await listCommitments({ includeCancelled: true })).find((c) => c.id === commitmentId);

before(async () => {
  const instance = await connectDB();
  assert.equal(instance.connection.name, TEST_DB);
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()));
  ids.y25 = await years.createSchoolYear(actor, { label: "2025-2026", startDate: "2025-09-01", endDate: "2026-06-30" }, ctx);
  ids.y26 = await years.createSchoolYear(actor, { label: "2026-2027", startDate: "2026-09-01", endDate: "2027-06-30" }, ctx);
  await cashbox.createCashOpening(actor, { yearId: ids.y25, amount: 200_000, date: "2025-09-01", reason: "Reprise de caisse" }, ctx);
  await years.activateSchoolYear(actor, ids.y25, ctx);
  ids.sponsor = await sponsors.createSponsor(actor, sponsorSchema.parse({ kind: "PERSON", firstName: "Claire", lastName: "Dupont", email: "c@d.fr", address: { country: "FR" } }), ctx);
  ids.other = await sponsors.createSponsor(actor, sponsorSchema.parse({ kind: "PERSON", firstName: "Paul", lastName: "Autre", email: "p@a.fr", address: { country: "FR" } }), ctx);
  ids.child = await children.createChild(actor, childSchema.parse({ firstName: "Awa", lastName: "Mbarga", birthDate: "2014-02-01", sex: "F", guardians: [] }), ctx);
  const link = (year: string, start: string) => createSponsorshipSchema.parse({ sponsorId: ids.sponsor, childId: ids.child, schoolYearId: year, startDate: start });
  ids.sp25 = await sponsorships.createSponsorship(actor, link(ids.y25, "2025-09-01"), ctx);
  ids.sp26 = await sponsorships.createSponsorship(actor, link(ids.y26, "2026-09-01"), ctx);
});

after(async () => {
  if (mongoose.connection.name === TEST_DB && /^parrainage_test_\d+$/.test(TEST_DB)) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe("engagements", () => {
  it("crée un engagement par parrainage (attendu = engagé)", async () => {
    ids.c25 = await commitments.createCommitment(actor, { sponsorshipId: ids.sp25, committedAmount: 100_000, notes: undefined }, ctx);
    ids.c26 = await commitments.createCommitment(actor, { sponsorshipId: ids.sp26, committedAmount: 120_000, notes: undefined }, ctx);
    await assert.rejects(commitments.createCommitment(actor, { sponsorshipId: ids.sp25, committedAmount: 5_000, notes: undefined }, ctx), ConflictError);
    const view = await situation(ids.c25);
    assert.deepEqual({ committed: view?.committed, expected: view?.expected, received: view?.received, state: view?.state }, { committed: 100_000, expected: 100_000, received: 0, state: "UNPAID" });
  });
});

describe("versements et ventilation", () => {
  it("affecte un versement partiel et calcule le reste dû", async () => {
    ids.p1 = await contributions.createPayment(actor, pay({ originalAmount: "60000", reference: "VIR-001", lines: [{ commitmentId: ids.c25, amount: 60_000 }] }), ctx);
    const view = await situation(ids.c25);
    assert.deepEqual({ received: view?.received, remaining: view?.remaining, state: view?.state }, { received: 60_000, remaining: 40_000, state: "PARTIAL" });
    assert.equal((await Payment.findById(ids.p1).lean())?.number, "VRS-2025-000001");
  });

  it("refuse une affectation au-delà du reste dû, et accepte l'excédent placé explicitement en don", async () => {
    await assert.rejects(contributions.createPayment(actor, pay({ originalAmount: "50000", lines: [{ commitmentId: ids.c25, amount: 50_000 }] }), ctx), BusinessRuleError);
    await assert.rejects(contributions.createPayment(actor, pay({ originalAmount: "50000", lines: [{ commitmentId: ids.c25, amount: 40_000 }] }), ctx), BusinessRuleError, "ventilation incomplète");
    ids.p2 = await contributions.createPayment(actor, pay({ originalAmount: "50000", lines: [{ commitmentId: ids.c25, amount: 40_000 }], donationAmount: 10_000 }), ctx);
    assert.equal((await situation(ids.c25))?.state, "SETTLED");
  });

  it("refuse un engagement d'une année future et un engagement d'un autre sponsor", async () => {
    await assert.rejects(contributions.createPayment(actor, pay({ originalAmount: "1000", lines: [{ commitmentId: ids.c26, amount: 1_000 }] }), ctx), BusinessRuleError);
    await assert.rejects(contributions.createPayment(actor, pay({ sponsorId: ids.other, originalAmount: "1000", lines: [{ commitmentId: ids.c25, amount: 1_000 }] }), ctx), BusinessRuleError);
  });

  it("convertit un versement en euros au taux saisi", async () => {
    // 150,00 € × 655,957 = 98 394 FCFA → avance intégrale.
    ids.p3 = await contributions.createPayment(actor, pay({ currency: "EUR", originalAmount: "150,00", rate: "655,957", advanceAmount: 98_394, method: "CARD" }), ctx);
    const payment = await Payment.findById(ids.p3).lean();
    assert.equal(payment?.amountXaf, 98_394);
    assert.deepEqual({ ...payment?.currency, convertedAt: undefined }, { code: "EUR", originalAmountMinor: 15_000, rate: "655.957", convertedAt: undefined });
  });

  it("refuse une référence en double tant que le premier versement est valide", async () => {
    await assert.rejects(contributions.createPayment(actor, pay({ originalAmount: "1000", reference: "VIR-001", donationAmount: 1_000 }), ctx), ConflictError);
    const temp = await contributions.createPayment(actor, pay({ originalAmount: "1000", reference: "VIR-999", donationAmount: 1_000 }), ctx);
    await contributions.cancelPayment(actor, temp, "Erreur de saisie test", ctx);
    await contributions.createPayment(actor, pay({ originalAmount: "1000", reference: "VIR-999", donationAmount: 1_000 }), ctx);
    await assert.rejects(contributions.cancelPayment(actor, temp, "Deuxième annulation", ctx), BusinessRuleError, "pas de réactivation");
  });

  it("refuse une date future ou hors de toute année", async () => {
    await assert.rejects(contributions.createPayment(actor, pay({ receivedAt: "2099-01-01", originalAmount: "1000", donationAmount: 1_000 }), ctx));
    await assert.rejects(contributions.createPayment(actor, pay({ receivedAt: "2026-07-15", originalAmount: "1000", donationAmount: 1_000 }), ctx), BusinessRuleError);
  });

  it("ne laisse passer qu'un seul de deux versements simultanés qui épuisent le même engagement", async () => {
    const extra = await sponsorships.createSponsorship(actor, createSponsorshipSchema.parse({ sponsorId: ids.other, childId: ids.child, schoolYearId: ids.y25, startDate: "2025-09-01" }), ctx);
    const commitment = await commitments.createCommitment(actor, { sponsorshipId: extra, committedAmount: 30_000, notes: undefined }, ctx);
    const attempt = () => contributions.createPayment(actor, pay({ sponsorId: ids.other, originalAmount: "30000", lines: [{ commitmentId: commitment, amount: 30_000 }] }), ctx);
    const results = await Promise.allSettled([attempt(), attempt()]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await situation(commitment))?.received, 30_000);
  });
});

describe("engagements : modifications sous contrainte", () => {
  it("refuse un engagé ou un attendu sous le montant reçu, et l'annulation d'un engagement déjà payé", async () => {
    await assert.rejects(commitments.updateCommitment(actor, { commitmentId: ids.c25, committedAmount: 90_000, notes: undefined }, ctx), BusinessRuleError);
    await assert.rejects(commitments.adjustExpected(actor, { commitmentId: ids.c26, expectedAmount: 130_000, reason: "Plus que l'engagé" }, ctx), BusinessRuleError);
    await commitments.adjustExpected(actor, { commitmentId: ids.c26, expectedAmount: 80_000, reason: "Fin anticipée prévue" }, ctx);
    await assert.rejects(commitments.cancelCommitment(actor, ids.c25, "Test interdit", ctx), BusinessRuleError);
  });
});

describe("avances", () => {
  it("affecte une avance (FIFO) sans dépasser le crédit ni le reste dû", async () => {
    await assert.rejects(contributions.applyAdvance(actor, { sponsorId: ids.sponsor, commitmentId: ids.c26, amount: 99_000, note: undefined }, ctx), BusinessRuleError);
    await contributions.applyAdvance(actor, { sponsorId: ids.sponsor, commitmentId: ids.c26, amount: 70_000, note: undefined }, ctx);
    const sources = await contributions.advanceSources(new Types.ObjectId(ids.sponsor));
    assert.equal(sources.reduce((sum, s) => sum + s.available, 0), 28_394);
    assert.equal((await situation(ids.c26))?.received, 70_000);
    await assert.rejects(contributions.applyAdvance(actor, { sponsorId: ids.sponsor, commitmentId: ids.c26, amount: 20_000, note: undefined }, ctx), BusinessRuleError, "reste dû 10 000");
  });

  it("bloque l'annulation d'un versement dont l'avance est affectée, jusqu'à l'annulation de l'affectation", async () => {
    await assert.rejects(contributions.cancelPayment(actor, ids.p3, "Erreur de saisie", ctx), BusinessRuleError);
    const application = await CreditApplication.findOne({ status: "VALID" }).lean();
    assert.ok(application);
    await contributions.cancelCreditApplication(actor, application._id.toString(), "Mauvais engagement", ctx);
    assert.equal((await situation(ids.c26))?.received, 0);
    await contributions.applyAdvance(actor, { sponsorId: ids.sponsor, commitmentId: ids.c26, amount: 70_000, note: "Réaffectation" }, ctx);
  });
});

describe("caisse : trésorerie et affectations distinctes", () => {
  it("compte l'avance à l'encaissement, jamais à son affectation", async () => {
    const y25 = (await computeTreasuryOverview()).years.find((y) => y.yearId === ids.y25);
    // ouverture 200 000 + contributions 100 000 + dons 10 000 + 1 000 (+ 1 000 annulé exclu) + avance 98 394 (+ 30 000 Paul)
    assert.deepEqual(
      { contributions: y25?.figures.contributions, donations: y25?.figures.donations, advances: y25?.figures.advances, closing: y25?.figures.closingBalance },
      { contributions: 130_000, donations: 11_000, advances: 98_394, closing: 439_394 },
    );
    assert.equal(y25?.commitmentsNow.allocated, 130_000, "les avances affectées à 2026 ne comptent pas pour 2025");
  });

  it("accepte un règlement tardif vers une année clôturée sans modifier son instantané", async () => {
    // Nouvel engagement 2025 resté impayé, puis clôture de 2025 et versement en 2026.
    const third = await sponsorships.createSponsorship(
      actor,
      createSponsorshipSchema.parse({ sponsorId: ids.sponsor, childId: await children.createChild(actor, childSchema.parse({ firstName: "Binta", lastName: "Fouda", birthDate: "2015-01-01", sex: "F", guardians: [] }), ctx), schoolYearId: ids.y25, startDate: "2025-09-01" }),
      ctx,
    );
    const unpaid = await commitments.createCommitment(actor, { sponsorshipId: third, committedAmount: 50_000, notes: undefined }, ctx);
    await years.closeSchoolYear(actor, ids.y25, ctx);
    await years.activateSchoolYear(actor, ids.y26, ctx);
    const snapshot = (await SchoolYear.findById(ids.y25).lean())?.closing?.closingBalance;

    await assert.rejects(contributions.createPayment(actor, pay({ receivedAt: "2025-12-01", originalAmount: "1000", donationAmount: 1_000 }), ctx), BusinessRuleError, "année clôturée");
    const late = await contributions.createPayment(actor, pay({ receivedAt: "2026-10-01", originalAmount: "50000", lines: [{ commitmentId: unpaid, amount: 50_000 }] }), ctx);
    const line = (await Payment.findById(late).lean())?.lines[0];
    assert.equal(line?.lateSettlement, true);
    assert.equal(line?.commitmentYear?.toString(), ids.y25);

    const overview = await computeTreasuryOverview();
    assert.equal((await SchoolYear.findById(ids.y25).lean())?.closing?.closingBalance, snapshot, "instantané inchangé");
    assert.equal(overview.years.find((y) => y.yearId === ids.y26)?.figures.lateContributions, 50_000);
    assert.equal((await situation(unpaid))?.state, "SETTLED");
    await assert.rejects(contributions.cancelPayment(actor, ids.p1, "Année clôturée", ctx), BusinessRuleError);
  });
});
