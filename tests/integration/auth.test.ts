/**
 * Tests d'intégration de l'authentification contre MongoDB.
 *
 * Isolation : chaque exécution crée sa PROPRE base `parrainage_test_<horodatage>` sur le cluster
 * configuré, et la supprime à la fin. La base applicative (MONGODB_DB) n'est jamais lue ni modifiée.
 *   npm run test:integration
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

const TEST_DB = `parrainage_test_${Date.now()}`;
process.env.MONGODB_DB = TEST_DB; // avant tout accès à la configuration

const mongoose = (await import("mongoose")).default;
const { connectDB } = await import("@/lib/db/mongoose");
const { Session, User } = await import("@/features/auth/model");
const { AuditLog } = await import("@/features/audit/model");
const { authenticate, changeOwnPassword, resolveSession, revokeSessionByToken } = await import("@/features/auth/service");
const users = await import("@/features/users/service");
const { BusinessRuleError, RateLimitError, ValidationError, ConflictError } = await import("@/lib/errors");

const ctx = { ip: "203.0.113.7", userAgent: "tests" };
const ADMIN = { email: "admin@test.local", firstName: "Awa", lastName: "Test" };
const ADMIN_PASSWORD = "phrase de passe admin 2026";

before(async () => {
  const instance = await connectDB();
  assert.equal(instance.connection.name, TEST_DB, "les tests doivent tourner sur la base de test");
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()));
});

after(async () => {
  // Suppression de la base créée par CETTE exécution uniquement.
  if (mongoose.connection.name === TEST_DB && /^parrainage_test_\d+$/.test(TEST_DB)) {
    await mongoose.connection.dropDatabase();
  }
  await mongoose.disconnect();
});

async function loginAs(email: string, password: string, ip = ctx.ip) {
  return authenticate({ email, password }, { ip, userAgent: "tests" });
}

describe("premier super administrateur", () => {
  it("est créé une seule fois", async () => {
    await users.bootstrapSuperAdmin(ADMIN, ADMIN_PASSWORD);
    await assert.rejects(users.bootstrapSuperAdmin({ ...ADMIN, email: "autre@test.local" }, ADMIN_PASSWORD), BusinessRuleError);
    assert.equal(await User.countDocuments({ role: "SUPER_ADMIN" }), 1);
    assert.equal(await AuditLog.countDocuments({ action: "user.bootstrap" }), 1);
  });
});

describe("connexion et sessions", () => {
  it("ouvre une session valide, stockée hachée, puis la révoque à la déconnexion", async () => {
    const { token, user } = await loginAs(ADMIN.email, ADMIN_PASSWORD);
    assert.equal(user.role, "SUPER_ADMIN");
    assert.equal(await Session.countDocuments({ tokenHash: token }), 0, "le jeton ne doit jamais être stocké en clair");

    const resolved = await resolveSession(token);
    assert.equal(resolved?.email, ADMIN.email);

    await revokeSessionByToken(token, ctx);
    assert.equal(await resolveSession(token), null);
  });

  it("refuse un mauvais mot de passe ou un compte inconnu avec le même message", async () => {
    const wrong = await loginAs(ADMIN.email, "mauvais mot de passe 1").catch((error: unknown) => error);
    const unknown = await loginAs("inconnu@test.local", "mauvais mot de passe 1").catch((error: unknown) => error);
    assert.ok(wrong instanceof ValidationError && unknown instanceof ValidationError);
    assert.equal(wrong.message, unknown.message);
    assert.ok((await AuditLog.countDocuments({ action: "auth.login.failed" })) >= 2);
  });

  it("verrouille le compte après 5 échecs, même avec le bon mot de passe ensuite", async () => {
    const email = "verrou@test.local";
    const admin = await resolveAdmin();
    await users.createUser(admin, { email, firstName: "Verrou", lastName: "Test", role: "ADMIN" }, ctx);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await assert.rejects(loginAs(email, "mauvais mot de passe 1", "198.51.100.1"), ValidationError);
    }
    await assert.rejects(loginAs(email, "nimporte quoi 123", "198.51.100.2"), RateLimitError);
    assert.equal(await AuditLog.countDocuments({ action: "auth.login.blocked" }), 1);
  });
});

/** Session SUPER_ADMIN servant d'acteur aux opérations de gestion. */
async function resolveAdmin() {
  const { token } = await loginAs(ADMIN.email, ADMIN_PASSWORD, "192.0.2.10");
  const user = await resolveSession(token);
  assert.ok(user);
  return user;
}

describe("gestion des comptes", () => {
  it("crée un compte avec mot de passe temporaire à changer, puis refuse le doublon", async () => {
    const admin = await resolveAdmin();
    const { temporaryPassword } = await users.createUser(
      admin,
      { email: "finance@test.local", firstName: "Paul", lastName: "Finance", role: "FINANCE_MANAGER" },
      ctx,
    );
    const { user } = await loginAs("finance@test.local", temporaryPassword, "192.0.2.11");
    assert.equal(user.mustChangePassword, true);
    await assert.rejects(
      users.createUser(admin, { email: "finance@test.local", firstName: "X", lastName: "Y", role: "ADMIN" }, ctx),
      ConflictError,
    );
  });

  it("change le mot de passe, lève l'obligation et ferme les autres sessions", async () => {
    const admin = await resolveAdmin();
    const { temporaryPassword } = await users.createUser(
      admin,
      { email: "media@test.local", firstName: "Lea", lastName: "Media", role: "MEDIA_MANAGER" },
      ctx,
    );
    const first = await loginAs("media@test.local", temporaryPassword, "192.0.2.12");
    const second = await loginAs("media@test.local", temporaryPassword, "192.0.2.12");
    const current = await resolveSession(second.token);
    assert.ok(current);

    await assert.rejects(
      changeOwnPassword(current, { currentPassword: "faux mot de passe 1", newPassword: "nouvelle phrase 2026", confirmPassword: "nouvelle phrase 2026" }, ctx),
      ValidationError,
    );
    await changeOwnPassword(current, { currentPassword: temporaryPassword, newPassword: "nouvelle phrase 2026", confirmPassword: "nouvelle phrase 2026" }, ctx);

    assert.equal(await resolveSession(first.token), null, "l'autre session doit être fermée");
    assert.equal((await resolveSession(second.token))?.mustChangePassword, false);
    await assert.rejects(loginAs("media@test.local", temporaryPassword, "192.0.2.13"), ValidationError);
  });

  it("désactive un compte : sessions fermées et connexion refusée", async () => {
    const admin = await resolveAdmin();
    const { userId, temporaryPassword } = await users.createUser(
      admin,
      { email: "enfants@test.local", firstName: "Ines", lastName: "Enfants", role: "CHILD_MANAGER" },
      ctx,
    );
    const { token } = await loginAs("enfants@test.local", temporaryPassword, "192.0.2.14");
    await users.setUserStatus(admin, userId, "DISABLED", ctx);
    assert.equal(await resolveSession(token), null);
    await assert.rejects(loginAs("enfants@test.local", temporaryPassword, "192.0.2.15"), ValidationError);
  });

  it("protège le dernier super administrateur et interdit l'auto-modification", async () => {
    const admin = await resolveAdmin();
    await assert.rejects(users.setUserStatus(admin, admin.id, "DISABLED", ctx), BusinessRuleError);
    await assert.rejects(
      users.updateUser(admin, { userId: admin.id, firstName: "Awa", lastName: "Test", role: "ADMIN" }, ctx),
      BusinessRuleError,
    );
    await assert.rejects(users.resetUserPassword(admin, admin.id, ctx), BusinessRuleError);
    assert.equal(await User.countDocuments({ role: "SUPER_ADMIN", status: "ACTIVE" }), 1);
  });

  it("réinitialise un mot de passe : l'ancien ne fonctionne plus", async () => {
    const admin = await resolveAdmin();
    const { userId, temporaryPassword } = await users.createUser(
      admin,
      { email: "reset@test.local", firstName: "Rita", lastName: "Reset", role: "ADMIN" },
      ctx,
    );
    const { token } = await loginAs("reset@test.local", temporaryPassword, "192.0.2.16");
    const { temporaryPassword: next } = await users.resetUserPassword(admin, userId, ctx);
    assert.equal(await resolveSession(token), null);
    await assert.rejects(loginAs("reset@test.local", temporaryPassword, "192.0.2.17"), ValidationError);
    assert.equal((await loginAs("reset@test.local", next, "192.0.2.18")).user.mustChangePassword, true);
  });
});
