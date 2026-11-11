import "server-only";

import mongoose, { Schema } from "mongoose";

import { MAX_XAF_AMOUNT } from "@/lib/money";

/**
 * Briques de schéma partagées par les modèles Mongoose.
 */

/** Montant XAF : entier, borné. `min` vaut 1 pour un montant strictement positif. */
export function xafField(min: 0 | 1 = 1) {
  return {
    type: Number,
    required: true as const,
    min,
    max: MAX_XAF_AMOUNT,
    validate: {
      validator: (value: number) => Number.isSafeInteger(value),
      message: "Le montant doit être un nombre entier de FCFA.",
    },
  };
}

/** Annulation d'un mouvement financier : motif, auteur et horodatage obligatoires. */
export const cancellationSchema = new Schema(
  {
    reason: { type: String, required: true, trim: true, minlength: 5, maxlength: 500 },
    by: { type: Schema.Types.ObjectId, ref: "User", required: true },
    at: { type: Date, required: true },
  },
  { _id: false },
);

/** Référence vers une ressource Cloudinary (jamais d'URL publique stockée). */
export const assetSchema = new Schema(
  {
    publicId: { type: String, required: true },
    resourceType: { type: String, enum: ["image", "video", "raw"], required: true },
    deliveryType: { type: String, enum: ["authenticated", "private", "upload"], required: true, default: "authenticated" },
    format: { type: String },
    bytes: { type: Number, min: 0 },
    width: { type: Number },
    height: { type: Number },
    duration: { type: Number },
    originalFilename: { type: String, maxlength: 255 },
    version: { type: Number },
  },
  { _id: false },
);

/**
 * Enregistre un modèle en tolérant le rechargement à chaud : en développement, un module de modèle
 * peut être réévalué ; on remplace alors l'ancien modèle au lieu de lever OverwriteModelError.
 */
export function registerModel<TSchema extends Schema>(name: string, schema: TSchema) {
  if (mongoose.models[name]) mongoose.deleteModel(name);
  return mongoose.model(name, schema);
}

/** Les mouvements financiers ne sont jamais supprimés : on bloque les suppressions au niveau du modèle. */
export function forbidDeletion(schema: Schema, label: string): void {
  const reject = () => {
    throw new Error(`Suppression interdite : ${label}. Utilisez une annulation.`);
  };
  schema.pre(["deleteOne", "deleteMany", "findOneAndDelete"], reject);
}
