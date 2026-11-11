import "server-only";

import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";

/**
 * Mots de passe : empreintes bcrypt (coût 12). Aucun mot de passe n'est stocké ni journalisé en clair.
 */

const BCRYPT_COST = 12;

/**
 * Empreinte factice : on compare quand même le mot de passe quand le compte n'existe pas, pour que la
 * durée de réponse ne révèle pas l'existence d'une adresse.
 */
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing-equalization", BCRYPT_COST);

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
  const ok = await bcrypt.compare(password, hash ?? DUMMY_HASH);
  return Boolean(hash) && ok;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/**
 * Mot de passe temporaire (réinitialisation par un administrateur) : 16 caractères sans caractères
 * ambigus, contenant au moins une lettre et un chiffre. Il doit être changé à la première connexion.
 */
export function generateTemporaryPassword(): string {
  for (;;) {
    const value = Array.from({ length: 16 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    if (/[A-Za-z]/.test(value) && /\d/.test(value)) return value;
  }
}
