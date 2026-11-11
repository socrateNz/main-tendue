/**
 * Tests d'intégration — enfants, établissements, scolarité.
 * Base dédiée `parrainage_test_<horodatage>`, supprimée en fin d'exécution.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

const TEST_DB = `parrainage_test_${Date.now()}`;
process.env.MONGODB_DB = TEST_DB;

const mongoose = (await import("mongoose")).default;
const { Types } = mongoose;
const { connectDB } = await import("@/lib/db/mongoose");
const { Child, Enrollment } = await import("@/features/children/model");
const { Sponsorship } = await import("@/features/sponsorships/model");
const { childSchema, schoolSchema, enrollmentSchema } = await import("@/features/children/schemas");
const children = await import("@/features/children/service");
const { listChildren, getChildDetail } = await import("@/features/children/queries");
const years = await import("@/features/school-years/service");
const { BusinessRuleError, ConflictError } = await import("@/lib/errors");
type SessionUser = import("@/features/auth/service").SessionUser;

const actor: SessionUser = {
  id: new Types.ObjectId().toString(),
  sessionId: new Types.ObjectId().toString(),
  email: "cm@test.local",
  firstName: "Chloe",
  lastName: "Test",
  name: "Chloe TEST",
  role: "CHILD_MANAGER",
  mustChangePassword: false,
};
const ctx = { ip: "127.0.0.1", userAgent: "tests" };
const ids: Record<string, string> = {};

before(async () => {
  const instance = await connectDB();
  assert.equal(instance.connection.name, TEST_DB);
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()));
  ids.year = await years.createSchoolYear({ ...actor, role: "ADMIN" }, { label: "2025-2026", startDate: "2025-09-01", endDate: "2026-06-30" }, ctx);
});

after(async () => {
  if (mongoose.connection.name === TEST_DB && /^parrainage_test_\d+$/.test(TEST_DB)) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const listParams = { page: 1, pageSize: 20, q: "", sort: "name" as const, dir: "asc" as const };
const noFilters = { status: "ALL" as const, sex: null, yearId: null, enrolledOnly: false, schoolId: null };

function child(overrides: Record<string, unknown> = {}) {
  return childSchema.parse({
    firstName: "Éloïse",
    lastName: "Mbarga",
    birthDate: "2015-03-12",
    sex: "F",
    city: "Yaoundé",
    phone: "",
    email: "",
    guardians: [{ relationship: "MOTHER", firstName: "Marie", lastName: "Mbarga", phone: "+237 6 99 00 00 00", isPrimaryContact: true }],
    ...overrides,
  });
}

describe("fiches enfants", () => {
  it("crée une fiche numérotée et refuse un doublon (nom, prénom, naissance), même sans accents", async () => {
    ids.eloise = await children.createChild(actor, child(), ctx);
    const created = await Child.findById(ids.eloise).lean();
    assert.equal(created?.code, "ENF-00001");
    assert.equal(created?.phone, undefined, "un champ vide n'est pas stocké");
    await assert.rejects(children.createChild(actor, child({ firstName: "Eloise", lastName: "MBARGA" }), ctx), ConflictError);
    ids.paul = await children.createChild(actor, child({ firstName: "Paul", lastName: "Nkomo", birthDate: "2013-07-01", sex: "M", guardians: [] }), ctx);
  });

  it("valide les données (date future, contact principal unique)", () => {
    assert.equal(childSchema.safeParse({ ...child(), birthDate: "2999-01-01" }).success, false);
    const twoPrimary = { ...child(), guardians: [child().guardians[0], { ...child().guardians[0], firstName: "Jean", relationship: "FATHER" }] };
    assert.equal(childSchema.safeParse(twoPrimary).success, false);
  });

  it("recherche sans tenir compte des accents ni de la casse, y compris par tuteur", async () => {
    const byName = await listChildren({ ...listParams, q: "eloise" }, noFilters);
    assert.deepEqual(byName.items.map((c) => c.code), ["ENF-00001"]);
    const byGuardian = await listChildren({ ...listParams, q: "marie" }, noFilters);
    assert.equal(byGuardian.total, 1);
  });

  it("met à jour la fiche et efface un champ facultatif vidé", async () => {
    await children.updateChild(actor, ids.eloise, child({ city: "", notes: "Allergie aux arachides" }), ctx);
    const updated = await Child.findById(ids.eloise).lean();
    assert.equal(updated?.city, undefined);
    assert.equal(updated?.notes, "Allergie aux arachides");
  });

  it("bloque l'archivage tant qu'un parrainage est actif, puis archive et réactive", async () => {
    await Sponsorship.create({ sponsor: new Types.ObjectId(), child: ids.paul, schoolYear: ids.year, startDate: new Date("2025-09-01") });
    await assert.rejects(children.archiveChild(actor, ids.paul, "Départ de la région", ctx), BusinessRuleError);

    await children.archiveChild(actor, ids.eloise, "Départ de la région", ctx);
    assert.equal((await Child.findById(ids.eloise).lean())?.status, "ARCHIVED");
    await assert.rejects(children.updateChild(actor, ids.eloise, child(), ctx), BusinessRuleError);
    assert.equal((await listChildren(listParams, { ...noFilters, status: "ACTIVE" })).total, 1);
    await children.unarchiveChild(actor, ids.eloise, ctx);
    assert.equal((await Child.findById(ids.eloise).lean())?.status, "ACTIVE");
  });
});

describe("établissements et scolarité", () => {
  it("refuse un établissement en double dans la même ville", async () => {
    ids.school = await children.createSchool(actor, schoolSchema.parse({ name: "École publique de Bastos", type: "PRIMARY", city: "Yaoundé" }), ctx);
    await assert.rejects(children.createSchool(actor, schoolSchema.parse({ name: "ECOLE PUBLIQUE DE BASTOS", type: "PRIMARY", city: "yaounde" }), ctx), ConflictError);
    ids.lycee = await children.createSchool(actor, schoolSchema.parse({ name: "Lycée de Mimboman", type: "HIGH_SCHOOL", city: "Yaoundé" }), ctx);
  });

  it("n'accepte qu'une scolarité par enfant et par année", async () => {
    const data = enrollmentSchema.parse({ schoolYearId: ids.year, schoolId: ids.school, className: "CM2", outcome: "PENDING" });
    await children.saveEnrollment(actor, ids.eloise, undefined, data, ctx);
    await assert.rejects(children.saveEnrollment(actor, ids.eloise, undefined, { ...data, className: "6e" }, ctx), ConflictError);
    await children.saveEnrollment(actor, ids.paul, undefined, { ...data, schoolId: ids.lycee, className: "5e" }, ctx);
  });

  it("filtre par année et par établissement et affiche la classe de l'année consultée", async () => {
    const inSchool = await listChildren(listParams, { ...noFilters, yearId: ids.year, schoolId: ids.school });
    assert.deepEqual(inSchool.items.map((c) => c.code), ["ENF-00001"]);
    assert.equal(inSchool.items[0].enrollment?.className, "CM2");
    const enrolled = await listChildren(listParams, { ...noFilters, yearId: ids.year, enrolledOnly: true });
    assert.equal(enrolled.total, 2);
  });

  it("refuse une inscription dans un établissement désactivé et expose l'historique scolaire", async () => {
    await children.updateSchool(actor, ids.lycee, schoolSchema.parse({ name: "Lycée de Mimboman", type: "HIGH_SCHOOL", city: "Yaoundé" }), false, ctx);
    const other = await children.createChild(actor, child({ firstName: "Awa", lastName: "Fouda", birthDate: "2014-01-01", guardians: [] }), ctx);
    await assert.rejects(
      children.saveEnrollment(actor, other, undefined, enrollmentSchema.parse({ schoolYearId: ids.year, schoolId: ids.lycee, className: "6e", outcome: "PENDING" }), ctx),
      BusinessRuleError,
    );
    const detail = await getChildDetail(ids.eloise);
    assert.equal(detail?.enrollments[0].yearLabel, "2025-2026");
    assert.equal(detail?.enrollments[0].schoolName, "École publique de Bastos");
    assert.ok((detail?.history.length ?? 0) >= 4, "les opérations sont auditées");

    const enrollment = await Enrollment.findOne({ child: ids.eloise }).lean();
    assert.ok(enrollment);
    await children.deleteEnrollment(actor, ids.eloise, enrollment._id.toString(), ctx);
    assert.equal(await Enrollment.countDocuments({ child: ids.eloise }), 0);
  });
});
