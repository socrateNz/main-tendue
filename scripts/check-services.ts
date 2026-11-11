/**
 * Vérifie la configuration et la connexion aux services externes (MongoDB Atlas, Cloudinary)
 * sans afficher aucune valeur sensible.
 *   npm run check:services
 */
import mongoose from "mongoose";

import { pingCloudinary } from "@/lib/cloudinary";
import { pingDatabase } from "@/lib/db/mongoose";
import { getEnvStatus } from "@/lib/env";

let ok = true;

for (const status of getEnvStatus()) {
  if (status.ok) {
    console.log(`✔ Variables « ${status.group} » valides`);
  } else {
    ok = false;
    console.error(`✖ Variables « ${status.group} » : ${status.problems.join(", ")}`);
  }
}

const database = await pingDatabase();
if (database.ok) {
  const db = mongoose.connection.db;
  const collections = db ? (await db.listCollections({}, { nameOnly: true }).toArray()).length : 0;
  console.log(`✔ MongoDB : connecté en ${database.latencyMs} ms — base « ${mongoose.connection.name} », ${collections} collection(s)`);
} else {
  ok = false;
  console.error(`✖ MongoDB : ${database.reason}`);
}

const cloudinary = await pingCloudinary();
if (cloudinary.ok) {
  console.log("✔ Cloudinary : identifiants acceptés");
} else {
  ok = false;
  console.error(`✖ Cloudinary : ${cloudinary.reason}`);
}

await mongoose.disconnect();
process.exit(ok ? 0 : 1);
