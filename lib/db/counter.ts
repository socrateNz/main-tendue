import "server-only";

import { Schema, type ClientSession } from "mongoose";

import { registerModel } from "@/lib/db/schema-helpers";

/**
 * Compteurs séquentiels atomiques (numéros lisibles : VRS-2025-000123, ENF-00042…).
 * Utilisés dans la même transaction que l'écriture du document numéroté : un numéro n'est consommé
 * que si l'écriture aboutit.
 */

const counterSchema = new Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { versionKey: false, collection: "counters" },
);

const Counter = registerModel("Counter", counterSchema);

export async function nextSequence(key: string, session?: ClientSession): Promise<number> {
  const doc = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after", session },
  ).lean();
  if (!doc) throw new Error(`Compteur ${key} indisponible.`);
  return doc.seq;
}

export function formatNumber(prefix: string, seq: number, digits = 6): string {
  return `${prefix}-${String(seq).padStart(digits, "0")}`;
}
