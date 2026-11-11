import "server-only";

import { Schema, type InferSchemaType } from "mongoose";

import { registerModel, xafField } from "@/lib/db/schema-helpers";

/**
 * Solde initial de la caisse centrale (docs/modele-donnees.md § 3).
 *
 * Ouverture de caisse : ni contribution, ni don, ni avance. Document UNIQUE : son identifiant est
 * fixé à `MAIN`, si bien qu'une seconde création échoue sur la contrainte d'unicité de `_id`, y
 * compris en cas de requêtes simultanées.
 *
 * Aucune modification directe : seule la procédure de correction (SUPER_ADMIN, motif, audit) peut
 * changer le montant, en conservant l'historique dans `corrections`.
 */

export const CASH_OPENING_ID = "MAIN";

const correctionSchema = new Schema(
  {
    from: xafField(0),
    to: xafField(0),
    reason: { type: String, required: true, trim: true, minlength: 10, maxlength: 1000 },
    by: { type: Schema.Types.ObjectId, ref: "User", required: true },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const cashOpeningSchema = new Schema(
  {
    _id: { type: String, required: true, enum: [CASH_OPENING_ID], default: CASH_OPENING_ID },
    /** Première année scolaire de l'application. */
    schoolYear: { type: Schema.Types.ObjectId, ref: "SchoolYear", required: true },
    /** Montant de l'ouverture (peut être 0). */
    amount: xafField(0),
    date: { type: Date, required: true },
    reason: { type: String, required: true, trim: true, minlength: 5, maxlength: 1000 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    corrections: { type: [correctionSchema], default: [] },
  },
  { timestamps: true, collection: "cash_openings" },
);

const forbidden = () => {
  throw new Error("Le solde initial ne peut être ni supprimé ni remplacé. Utilisez la procédure de correction.");
};
cashOpeningSchema.pre(["deleteOne", "deleteMany", "findOneAndDelete", "replaceOne", "findOneAndReplace"], forbidden);

export type CashOpeningDoc = InferSchemaType<typeof cashOpeningSchema>;
export const CashOpening = registerModel("CashOpening", cashOpeningSchema);
