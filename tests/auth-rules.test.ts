import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { newPasswordSchema } from "@/features/auth/schemas";
import { HOME_PATH, safeRedirectPath } from "@/lib/auth/config";
import { hasPermission, PERMISSIONS, ROLES, type Permission, type Role } from "@/lib/auth/permissions";
import { readSessionToken, signSessionToken } from "@/lib/auth/token";

const SECRET = "a".repeat(48);

describe("matrice des permissions", () => {
  const allowed = (permission: Permission): Role[] => ROLES.filter((role) => hasPermission(role, permission));

  it("réserve la gestion des comptes, le solde initial et la réouverture au SUPER_ADMIN", () => {
    assert.deepEqual(allowed("users:manage"), ["SUPER_ADMIN"]);
    assert.deepEqual(allowed("cashbox:initialize"), ["SUPER_ADMIN"]);
    assert.deepEqual(allowed("schoolYears:reopen"), ["SUPER_ADMIN"]);
  });

  it("réserve l'annulation des mouvements financiers au FINANCE_MANAGER et au SUPER_ADMIN", () => {
    assert.deepEqual(allowed("finance:cancel"), ["SUPER_ADMIN", "FINANCE_MANAGER"]);
  });

  it("interdit les opérations financières aux gestionnaires des enfants et des médias", () => {
    for (const permission of ["payments:write", "expenses:write", "commitments:write", "reports:finance"] as const) {
      assert.equal(hasPermission("CHILD_MANAGER", permission), false, permission);
      assert.equal(hasPermission("MEDIA_MANAGER", permission), false, permission);
    }
  });

  it("limite les vidéos aux rôles média et administration", () => {
    assert.deepEqual(allowed("videos:write"), ["SUPER_ADMIN", "ADMIN", "MEDIA_MANAGER"]);
  });

  it("limite la modification des fiches enfants", () => {
    assert.deepEqual(allowed("children:write"), ["SUPER_ADMIN", "ADMIN", "CHILD_MANAGER"]);
    assert.equal(hasPermission("FINANCE_MANAGER", "children:read"), true);
  });

  it("donne toutes les permissions au SUPER_ADMIN et l'accès au tableau de bord à tous", () => {
    for (const permission of PERMISSIONS) assert.equal(hasPermission("SUPER_ADMIN", permission), true, permission);
    for (const role of ROLES) assert.equal(hasPermission(role, "dashboard:read"), true, role);
  });
});

describe("cookie de session signé", () => {
  it("accepte un jeton valide", async () => {
    const token = await signSessionToken("sid-123", new Date(Date.now() + 60_000), SECRET);
    assert.equal(await readSessionToken(token, SECRET), "sid-123");
  });

  it("rejette un jeton falsifié, signé avec un autre secret ou expiré", async () => {
    const token = await signSessionToken("sid-123", new Date(Date.now() + 60_000), SECRET);
    const [header, payload, signature] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ sid: "autre", iss: "parrainage", aud: "parrainage-admin" })).toString("base64url");
    assert.equal(await readSessionToken(`${header}.${forgedPayload}.${signature}`, SECRET), null);
    assert.equal(await readSessionToken(token, "b".repeat(48)), null);
    const expired = await signSessionToken("sid-123", new Date(Date.now() - 1_000), SECRET);
    assert.equal(await readSessionToken(expired, SECRET), null);
    assert.equal(await readSessionToken(`${payload}`, SECRET), null);
    assert.equal(await readSessionToken(undefined, SECRET), null);
    assert.equal(await readSessionToken(token, undefined), null);
  });
});

describe("redirection après connexion", () => {
  it("n'accepte que des chemins internes", () => {
    assert.equal(safeRedirectPath("/utilisateurs?page=2"), "/utilisateurs?page=2");
    assert.equal(safeRedirectPath("https://malveillant.example"), HOME_PATH);
    assert.equal(safeRedirectPath("//malveillant.example"), HOME_PATH);
    assert.equal(safeRedirectPath("/\\malveillant.example"), HOME_PATH);
    assert.equal(safeRedirectPath("/connexion"), HOME_PATH);
    assert.equal(safeRedirectPath(undefined), HOME_PATH);
  });
});

describe("politique de mot de passe", () => {
  it("exige 12 caractères, une lettre et un chiffre", () => {
    assert.equal(newPasswordSchema.safeParse("court1").success, false);
    assert.equal(newPasswordSchema.safeParse("seulementdeslettres").success, false);
    assert.equal(newPasswordSchema.safeParse("123456789012").success, false);
    assert.equal(newPasswordSchema.safeParse("phrase de passe 2026").success, true);
    assert.equal(newPasswordSchema.safeParse("é".repeat(40) + "1").success, false); // > 72 octets
  });
});
