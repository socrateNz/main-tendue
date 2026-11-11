/**
 * Crée les collections et index déclarés dans les modèles (à lancer après chaque évolution des
 * schémas, et avant la mise en production). Opération non destructive pour les données :
 * `createIndexes` ajoute les index manquants et ne supprime ni document ni index existant.
 *   npm run db:indexes
 */
import mongoose from "mongoose";

import { connectDB } from "@/lib/db/mongoose";

// Enregistrement de tous les modèles.
import "@/lib/db/counter";
import "@/features/auth/model";
import "@/features/audit/model";
import "@/features/school-years/model";
import "@/features/cashbox/model";
import "@/features/children/model";
import "@/features/sponsors/model";
import "@/features/sponsorships/model";
import "@/features/commitments/model";
import "@/features/contributions/model";
import "@/features/expenses/model";
import "@/features/videos/model";

await connectDB();
let failures = 0;
for (const name of mongoose.modelNames()) {
  const model = mongoose.model(name);
  try {
    await model.createCollection();
    await model.createIndexes();
    console.log(`✔ ${model.collection.collectionName}`);
  } catch (error) {
    failures += 1;
    console.error(`✖ ${model.collection.collectionName} : ${error instanceof Error ? error.message : "erreur"}`);
  }
}
await mongoose.disconnect();
process.exit(failures === 0 ? 0 : 1);
