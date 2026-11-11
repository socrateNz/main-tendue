import { SignJWT, jwtVerify } from "jose";

/**
 * Cookie de session signé (HS256, jose).
 *
 * Le cookie transporte le jeton de session opaque (dont seule l'empreinte est en base), signé avec
 * JWT_SECRET. La signature permet au proxy d'écarter immédiatement un cookie falsifié ou expiré sans
 * interroger la base ; la validité réelle (révocation, inactivité, compte actif) est TOUJOURS vérifiée
 * côté serveur contre la collection `sessions`.
 *
 * Module sans `server-only` : il est aussi chargé par le proxy.
 */

const ISSUER = "parrainage";
const AUDIENCE = "parrainage-admin";

export type SessionTokenPayload = { sid: string };

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(sid: string, expiresAt: Date, secret: string): Promise<string> {
  return new SignJWT({ sid })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(key(secret));
}

/** Retourne le jeton de session si la signature et l'expiration sont valides, sinon null. */
export async function readSessionToken(token: string | undefined, secret: string | undefined): Promise<string | null> {
  if (!token || !secret) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    return typeof payload.sid === "string" ? payload.sid : null;
  } catch {
    return null;
  }
}
