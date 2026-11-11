/**
 * Tests d'intégration — vidéos de remerciement : liens privés, révocation, expiration.
 * Base dédiée `parrainage_test_<horodatage>`, supprimée en fin d'exécution. La suppression Cloudinary
 * vise un identifiant inexistant (réponse « not found », traitée comme une suppression confirmée).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

const TEST_DB = `parrainage_test_${Date.now()}`;
process.env.MONGODB_DB = TEST_DB;

const mongoose = (await import("mongoose")).default;
const { Types } = mongoose;
const { connectDB } = await import("@/lib/db/mongoose");
const { Video, VideoAccessLink } = await import("@/features/videos/model");
const { childSchema } = await import("@/features/children/schemas");
const { sponsorSchema } = await import("@/features/sponsors/schemas");
const { createSponsorshipSchema, sponsorshipTransitionSchema } = await import("@/features/sponsorships/schemas");
const children = await import("@/features/children/service");
const sponsors = await import("@/features/sponsors/service");
const sponsorships = await import("@/features/sponsorships/service");
const years = await import("@/features/school-years/service");
const videos = await import("@/features/videos/service");
const { hashToken } = await import("@/lib/security/tokens");
const { BusinessRuleError } = await import("@/lib/errors");
type SessionUser = import("@/features/auth/service").SessionUser;

const actor: SessionUser = { id: new Types.ObjectId().toString(), sessionId: "s", email: "m@t.l", firstName: "Mia", lastName: "Media", name: "Mia MEDIA", role: "SUPER_ADMIN", mustChangePassword: false };
const ctx = { ip: "127.0.0.1", userAgent: "tests" };
const ids: Record<string, string> = {};
const tokenOf = (url: string) => url.split("/v/")[1];

before(async () => {
  const instance = await connectDB();
  assert.equal(instance.connection.name, TEST_DB);
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()));
  ids.year = await years.createSchoolYear(actor, { label: "2026-2027", startDate: "2026-09-01", endDate: "2027-06-30" }, ctx);
  ids.child = await children.createChild(actor, childSchema.parse({ firstName: "Awa", lastName: "Test", birthDate: "2014-01-01", sex: "F", guardians: [] }), ctx);
  const sponsor = (first: string, email: string) => sponsors.createSponsor(actor, sponsorSchema.parse({ kind: "PERSON", firstName: first, lastName: "Sponsor", email, address: { country: "FR" } }), ctx);
  ids.s1 = await sponsor("Anne", "a@t.fr");
  ids.s2 = await sponsor("Bruno", "b@t.fr");
  ids.s3 = await sponsor("Carla", "c@t.fr");
  const link = (s: string) => sponsorships.createSponsorship(actor, createSponsorshipSchema.parse({ sponsorId: s, childId: ids.child, schoolYearId: ids.year, startDate: "2026-09-01" }), ctx);
  await link(ids.s1);
  await link(ids.s2);
  const cancelled = await link(ids.s3);
  await sponsorships.transitionSponsorship(actor, sponsorshipTransitionSchema.parse({ sponsorshipId: cancelled, transition: "cancel", reason: "Créé par erreur" }), ctx);
  const [video] = await Video.create([
    {
      child: ids.child,
      schoolYear: ids.year,
      title: "Merci !",
      asset: { publicId: `parrainage/videos/test-inexistant-${Date.now()}`, resourceType: "video", deliveryType: "authenticated", format: "mp4" },
      status: "PROCESSING",
      expiresAt: new Date(Date.now() + 90 * 86_400_000),
      createdBy: new Types.ObjectId(actor.id),
    },
  ]);
  ids.video = video._id.toString();
});

after(async () => {
  if (mongoose.connection.name === TEST_DB && /^parrainage_test_\d+$/.test(TEST_DB)) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe("liens privés", () => {
  it("génère un lien par sponsor concerné (pas pour un parrainage annulé) et ne stocke que l'empreinte", async () => {
    const links = await videos.publishVideo(actor, ids.video, null, ctx);
    assert.deepEqual(links.map((l) => l.sponsorName).sort(), ["Anne SPONSOR", "Bruno SPONSOR"]);
    for (const link of links) {
      const token = tokenOf(link.url);
      assert.match(token, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(await VideoAccessLink.countDocuments({ tokenHash: token }), 0, "jamais en clair");
      assert.equal(await VideoAccessLink.countDocuments({ tokenHash: hashToken(token) }), 1);
    }
    ids.token1 = tokenOf(links[0].url);
    ids.sponsorOfToken1 = links[0].sponsorId;
    const video = await Video.findById(ids.video).lean();
    assert.equal(video?.status, "AVAILABLE");
    assert.ok(video?.expiresAt && video.expiresAt.getTime() - Date.now() > 89 * 86_400_000, "échéance par défaut : 90 jours");
    await assert.rejects(videos.publishVideo(actor, ids.video, null, ctx), BusinessRuleError, "pas de double publication");
  });

  it("valide un jeton correct et refuse un jeton falsifié ou mal formé", async () => {
    assert.ok(await videos.resolveVideoLink(ids.token1));
    const tampered = (ids.token1[0] === "A" ? "B" : "A") + ids.token1.slice(1);
    assert.equal(await videos.resolveVideoLink(tampered), null);
    assert.equal(await videos.resolveVideoLink("../../etc/passwd"), null);
  });

  it("régénère un lien en invalidant l'ancien, et révoque un lien", async () => {
    const fresh = await videos.regenerateLink(actor, ids.video, ids.sponsorOfToken1, ctx);
    assert.equal(await videos.resolveVideoLink(ids.token1), null, "l'ancien lien ne fonctionne plus");
    const resolved = await videos.resolveVideoLink(tokenOf(fresh.url));
    assert.ok(resolved);
    await videos.revokeLink(actor, resolved.linkId, ctx);
    assert.equal(await videos.resolveVideoLink(tokenOf(fresh.url)), null);
    await assert.rejects(videos.regenerateLink(actor, ids.video, new Types.ObjectId().toString(), ctx), BusinessRuleError, "sponsor non concerné");
  });

  it("journalise les accès des sponsors", async () => {
    const link = await videos.regenerateLink(actor, ids.video, ids.sponsorOfToken1, ctx);
    const resolved = await videos.resolveVideoLink(tokenOf(link.url));
    assert.ok(resolved);
    await videos.recordLinkAccess(resolved.linkId, "view", ctx);
    await videos.recordLinkAccess(resolved.linkId, "download", ctx);
    const stored = await VideoAccessLink.findById(resolved.linkId).lean();
    assert.deepEqual({ views: stored?.accessCount, downloads: stored?.downloadCount }, { views: 1, downloads: 1 });
    ids.token2 = tokenOf(link.url);
  });
});

describe("expiration automatique", () => {
  it("refuse une échéance passée", async () => {
    await assert.rejects(videos.updateVideoExpiry(actor, ids.video, new Date(Date.now() - 1000), ctx), BusinessRuleError);
  });

  it("invalide les liens puis supprime le fichier à l'échéance, en conservant les métadonnées", async () => {
    await Video.updateOne({ _id: ids.video }, { $set: { expiresAt: new Date(Date.now() - 60_000) } });
    assert.equal(await videos.resolveVideoLink(ids.token2), null, "un lien échu ne fonctionne plus, même avant le passage de la tâche");
    const summary = await videos.processExpiredVideos();
    assert.deepEqual({ expired: summary.expired, deleted: summary.deleted, failed: summary.failed }, { expired: 1, deleted: 1, failed: 0 });
    const video = await Video.findById(ids.video).lean();
    assert.equal(video?.status, "DELETED");
    assert.ok(video?.deletion?.deletedAt);
    assert.equal(await VideoAccessLink.countDocuments({ video: ids.video, active: true }), 0);
    assert.equal(video?.title, "Merci !", "métadonnées conservées");
    assert.deepEqual(await videos.processExpiredVideos(), { expired: 0, deleted: 0, failed: 0, alerts: [] });
  });
});
