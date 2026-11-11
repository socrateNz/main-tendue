/**
 * Tests d'intégration — sponsors et parrainages.
 * Base dédiée `parrainage_test_<horodatage>`, supprimée en fin d'exécution.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

const TEST_DB = `parrainage_test_${Date.now()}`;
process.env.MONGODB_DB = TEST_DB;

const mongoose = (await import("mongoose")).default;
const { Types } = mongoose;
const { connectDB } = await import("@/lib/db/mongoose");
const { Sponsor } = await import("@/features/sponsors/model");
const { Sponsorship } = await import("@/features/sponsorships/model");
const { Commitment } = await import("@/features/commitments/model");
const { SchoolYear } = await import("@/features/school-years/model");
const { sponsorSchema } = await import("@/features/sponsors/schemas");
const { createSponsorshipSchema, sponsorshipTransitionSchema } = await import("@/features/sponsorships/schemas");
const { childSchema } = await import("@/features/children/schemas");
const sponsors = await import("@/features/sponsors/service");
const sponsorships = await import("@/features/sponsorships/service");
const children = await import("@/features/children/service");
const years = await import("@/features/school-years/service");
const { listSponsorships, listSponsorshipsOf } = await import("@/features/sponsorships/queries");
const { listSponsors, searchSponsorOptions } = await import("@/features/sponsors/queries");
const { BusinessRuleError, ConflictError } = await import("@/lib/errors");
type SessionUser = import("@/features/auth/service").SessionUser;

const actor: SessionUser = {
  id: new Types.ObjectId().toString(),
  sessionId: new Types.ObjectId().toString(),
  email: "admin@test.local",
  firstName: "Ada",
  lastName: "Admin",
  name: "Ada ADMIN",
  role: "ADMIN",
  mustChangePassword: false,
};
const ctx = { ip: "127.0.0.1", userAgent: "tests" };
const ids: Record<string, string> = {};

const person = (overrides: Record<string, unknown> = {}) =>
  sponsorSchema.parse({ kind: "PERSON", firstName: "Claire", lastName: "Dupont", email: "claire@exemple.fr", address: { country: "FR", city: "Lyon" }, ...overrides });
const kid = (firstName: string, birthDate: string) => childSchema.parse({ firstName, lastName: "Mbarga", birthDate, sex: "F", guardians: [] });
const link = (sponsorId: string, childId: string, overrides: Record<string, unknown> = {}) =>
  createSponsorshipSchema.parse({ sponsorId, childId, schoolYearId: ids.year, startDate: "2026-09-01", ...overrides });
const transition = (sponsorshipId: string, value: Record<string, unknown>) => sponsorshipTransitionSchema.parse({ sponsorshipId, ...value });

before(async () => {
  const instance = await connectDB();
  assert.equal(instance.connection.name, TEST_DB);
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()));
  ids.year = await years.createSchoolYear(actor, { label: "2026-2027", startDate: "2026-09-01", endDate: "2027-06-30" }, ctx);
  ids.childA = await children.createChild(actor, kid("Awa", "2014-02-01"), ctx);
  ids.childB = await children.createChild(actor, kid("Binta", "2015-03-01"), ctx);
});

after(async () => {
  if (mongoose.connection.name === TEST_DB && /^parrainage_test_\d+$/.test(TEST_DB)) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe("sponsors", () => {
  it("crée particuliers et organisations, numérotés, et refuse une adresse e-mail déjà utilisée", async () => {
    ids.claire = await sponsors.createSponsor(actor, person(), ctx);
    ids.org = await sponsors.createSponsor(
      actor,
      sponsorSchema.parse({ kind: "ORGANIZATION", organizationName: "Rotary Club de Genève", phone: "+41 22 000 00 00", address: { country: "CH" } }),
      ctx,
    );
    const claire = await Sponsor.findById(ids.claire).lean();
    assert.equal(claire?.code, "SPN-00001");
    assert.equal(claire?.displayName, "Claire DUPONT");
    await assert.rejects(sponsors.createSponsor(actor, person({ firstName: "Autre", email: "CLAIRE@exemple.fr" }), ctx), ConflictError);
  });

  it("exige nom/prénom pour un particulier, raison sociale pour une organisation, et un moyen de contact", () => {
    assert.equal(sponsorSchema.safeParse({ kind: "PERSON", lastName: "X", email: "x@y.fr", address: { country: "FR" } }).success, false);
    assert.equal(sponsorSchema.safeParse({ kind: "ORGANIZATION", email: "x@y.fr", address: { country: "FR" } }).success, false);
    assert.equal(sponsorSchema.safeParse({ kind: "PERSON", firstName: "A", lastName: "B", address: { country: "FR" } }).success, false);
    assert.equal(sponsorSchema.safeParse({ kind: "PERSON", firstName: "A", lastName: "B", email: "a@b.fr", address: { country: "ZZ" } }).success, false);
  });

  it("recherche et filtre par pays", async () => {
    assert.equal((await listSponsors({ page: 1, pageSize: 20, q: "rotary geneve", sort: "name", dir: "asc" }, { status: "ALL", kind: null, country: null })).total, 1);
    assert.equal((await listSponsors({ page: 1, pageSize: 20, q: "", sort: "name", dir: "asc" }, { status: "ALL", kind: null, country: "FR" })).total, 1);
  });
});

describe("parrainages", () => {
  it("associe plusieurs sponsors à un enfant et plusieurs enfants à un sponsor", async () => {
    ids.s1 = await sponsorships.createSponsorship(actor, link(ids.claire, ids.childA), ctx);
    ids.s2 = await sponsorships.createSponsorship(actor, link(ids.claire, ids.childB), ctx);
    ids.s3 = await sponsorships.createSponsorship(actor, link(ids.org, ids.childA, { startDate: "2026-10-15" }), ctx);
    assert.equal((await listSponsorshipsOf({ childId: ids.childA })).length, 2);
    assert.equal((await listSponsorshipsOf({ sponsorId: ids.claire })).length, 2);
    const found = await listSponsorships({ page: 1, pageSize: 20, q: "binta", sort: "startDate", dir: "desc" }, { yearId: ids.year, status: "ALL" });
    assert.equal(found.total, 1);
    assert.equal(found.items[0].sponsor.name, "Claire DUPONT");
  });

  it("refuse un doublon et des dates hors de l'année", async () => {
    await assert.rejects(sponsorships.createSponsorship(actor, link(ids.claire, ids.childA), ctx), ConflictError);
    const third = await children.createChild(actor, kid("Coumba", "2016-04-01"), ctx);
    await assert.rejects(sponsorships.createSponsorship(actor, link(ids.claire, third, { startDate: "2026-08-15" }), ctx), BusinessRuleError);
    await assert.rejects(sponsorships.createSponsorship(actor, link(ids.claire, third, { endDate: "2027-07-15" }), ctx), BusinessRuleError);
  });

  it("bloque la désactivation d'un sponsor et l'archivage d'un enfant qui ont des parrainages actifs", async () => {
    await assert.rejects(sponsors.setSponsorStatus(actor, ids.org, "INACTIVE", "Ne répond plus", ctx), BusinessRuleError);
    await assert.rejects(children.archiveChild(actor, ids.childA, "Départ de la région", ctx), BusinessRuleError);
  });

  it("suspend, reprend, termine avec une date dans la période", async () => {
    await sponsorships.transitionSponsorship(actor, transition(ids.s3, { transition: "suspend", reason: "Difficultés passagères" }), ctx);
    assert.equal((await Sponsorship.findById(ids.s3).lean())?.status, "SUSPENDED");
    await sponsorships.transitionSponsorship(actor, transition(ids.s3, { transition: "resume" }), ctx);
    await assert.rejects(
      sponsorships.transitionSponsorship(actor, transition(ids.s3, { transition: "end", reason: "Fin de l'aide", endDate: "2026-10-01" }), ctx),
      BusinessRuleError,
      "fin antérieure au début",
    );
    await sponsorships.transitionSponsorship(actor, transition(ids.s3, { transition: "end", reason: "Fin de l'aide", endDate: "2027-01-31" }), ctx);
    const ended = await Sponsorship.findById(ids.s3).lean();
    assert.equal(ended?.status, "ENDED");
    assert.equal(ended?.endDate?.toISOString().slice(0, 10), "2027-01-31");
    await sponsors.setSponsorStatus(actor, ids.org, "INACTIVE", "Ne répond plus", ctx);
    await assert.rejects(sponsorships.transitionSponsorship(actor, transition(ids.s3, { transition: "resume" }), ctx), BusinessRuleError, "sponsor inactif");
  });

  it("refuse l'annulation d'un parrainage qui porte un engagement, puis réactive un parrainage annulé", async () => {
    const s1 = await Sponsorship.findById(ids.s1).lean();
    assert.ok(s1);
    const [commitment] = await Commitment.create([{ sponsorship: s1._id, sponsor: s1.sponsor, child: s1.child, schoolYear: s1.schoolYear, committedAmount: 100_000, expectedAmount: 100_000 }]);
    await assert.rejects(sponsorships.transitionSponsorship(actor, transition(ids.s1, { transition: "cancel", reason: "Créé par erreur" }), ctx), BusinessRuleError);
    await Commitment.updateOne({ _id: commitment._id }, { $set: { status: "CANCELLED" } });

    await sponsorships.transitionSponsorship(actor, transition(ids.s1, { transition: "cancel", reason: "Créé par erreur" }), ctx);
    await assert.rejects(sponsorships.createSponsorship(actor, link(ids.claire, ids.childA), ctx), ConflictError, "doit être réactivé");
    await sponsorships.transitionSponsorship(actor, transition(ids.s1, { transition: "resume" }), ctx);
    assert.equal((await Sponsorship.findById(ids.s1).lean())?.status, "ACTIVE");
  });

  it("ne propose que des sponsors actifs dans le sélecteur et fige les parrainages d'une année clôturée", async () => {
    const options = await searchSponsorOptions("");
    assert.deepEqual(options.map((o) => o.label), ["Claire DUPONT"]);
    await SchoolYear.updateOne({ _id: ids.year }, { $set: { status: "CLOSED" } });
    await assert.rejects(sponsorships.transitionSponsorship(actor, transition(ids.s2, { transition: "suspend", reason: "Test année close" }), ctx), BusinessRuleError);
  });
});
