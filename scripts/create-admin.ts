/**
 * Création du PREMIER super administrateur.
 *
 *   npm run create-admin -- --email admin@exemple.org --first-name Awa --last-name Mbarga
 *
 * Le mot de passe est demandé de façon masquée (ou lu sur l'entrée standard avec --password-stdin).
 * Il n'est jamais passé en argument (il apparaîtrait dans l'historique du terminal).
 * La commande est refusée dès qu'un super administrateur existe.
 */
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";

import mongoose from "mongoose";

import { createUserSchema, newPasswordSchema } from "@/features/auth/schemas";
import { bootstrapSuperAdmin } from "@/features/users/service";
import { isAppError } from "@/lib/errors";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    "first-name": { type: "string" },
    "last-name": { type: "string" },
    "password-stdin": { type: "boolean", default: false },
  },
});

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

const identity = createUserSchema.omit({ role: true }).safeParse({
  email: values.email,
  firstName: values["first-name"],
  lastName: values["last-name"],
});
if (!identity.success) {
  fail(
    "Arguments invalides : " +
      identity.error.issues.map((issue) => `${String(issue.path[0])} — ${issue.message}`).join(" ; ") +
      "\nUsage : npm run create-admin -- --email <e-mail> --first-name <prénom> --last-name <nom>",
  );
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

/** Saisie masquée dans un terminal interactif. */
function prompt(question: string): Promise<string> {
  if (!process.stdin.isTTY) fail("Terminal non interactif : utilisez --password-stdin.");
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const output = rl as unknown as { _writeToOutput: (text: string) => void };
    let muted = false;
    output._writeToOutput = (text: string) => {
      if (!muted || text.includes("\n")) process.stdout.write(muted ? "\n" : text);
    };
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
    muted = true;
  });
}

let password: string;
if (values["password-stdin"]) {
  password = await readStdin();
} else {
  password = await prompt("Mot de passe (12 caractères min., lettres et chiffres) : ");
  const confirmation = await prompt("Confirmez le mot de passe : ");
  if (password !== confirmation) fail("Les mots de passe ne correspondent pas.");
}

const policy = newPasswordSchema.safeParse(password);
if (!policy.success) fail(`Mot de passe refusé : ${policy.error.issues.map((issue) => issue.message).join(" ")}`);

try {
  await bootstrapSuperAdmin(identity.data, policy.data);
  console.log(`✔ Super administrateur créé : ${identity.data.email}. Connectez-vous sur /connexion.`);
} catch (error) {
  fail(isAppError(error) ? error.message : `Échec : ${error instanceof Error ? error.message : "erreur inconnue"}`);
} finally {
  await mongoose.disconnect();
}
