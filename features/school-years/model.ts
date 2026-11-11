import "server-only";

import { Schema, type InferSchemaType } from "mongoose";

import { MAX_XAF_AMOUNT } from "@/lib/money";
import { registerModel, xafField } from "@/lib/db/schema-helpers";

import { SCHOOL_YEAR_LABEL_PATTERN, SCHOOL_YEAR_STATUSES } from "./types";

/**
 * Année scolaire : contexte de gestion indépendant (docs/modele-donnees.md § 2 et § 8).
 * Le solde initial de caisse est porté par `cash_openings`, pas par l'année.
 * Le non-chevauchement des périodes et la clôture séquentielle sont vérifiés par le service métier.
 */

const balanceField = { type: Number, required: true as const, min: -MAX_XAF_AMOUNT, max: MAX_XAF_AMOUNT };

/**
 * Instantané IMMUABLE figé à la clôture. Les règlements tardifs ultérieurs ne le modifient jamais ;
 * une réouverture l'archive dans `reopenings[]` avant toute nouvelle clôture.
 */
const closingSchema = new Schema(
  {
    // Trésorerie de l'année
    openingBalance: balanceField,
    contributions: xafField(0),
    lateContributions: xafField(0),
    donations: xafField(0),
    advances: xafField(0),
    expenses: xafField(0),
    closingBalance: balanceField,
    // Situation des engagements de l'année à la date de clôture
    commitmentsExpected: xafField(0),
    commitmentsAllocatedAtClosing: xafField(0),
    advancesAvailableAtClosing: xafField(0),
    closedAt: { type: Date, required: true },
    closedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { _id: false },
);

const reopeningSchema = new Schema(
  {
    reason: { type: String, required: true, trim: true, minlength: 10, maxlength: 1000 },
    by: { type: Schema.Types.ObjectId, ref: "User", required: true },
    at: { type: Date, required: true },
    /** Instantané de clôture remplacé par la réouverture (conservé pour l'historique). */
    previousClosing: { type: closingSchema, required: true },
  },
  { _id: false },
);

const schoolYearSchema = new Schema(
  {
    label: { type: String, required: true, trim: true, match: SCHOOL_YEAR_LABEL_PATTERN },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: { type: String, enum: SCHOOL_YEAR_STATUSES, required: true, default: "DRAFT" },
    activatedAt: { type: Date },
    /** Archivage logique (années clôturées uniquement) : masquée par défaut, jamais supprimée. */
    archived: { type: Boolean, required: true, default: false },
    archivedAt: { type: Date },
    closing: { type: closingSchema, default: null },
    reopenings: { type: [reopeningSchema], default: [] },
    notes: { type: String, maxlength: 2000 },
  },
  { timestamps: true, collection: "school_years" },
);

schoolYearSchema.index({ label: 1 }, { unique: true });
schoolYearSchema.index({ startDate: 1 }, { unique: true });
/** Une seule année active à la fois. */
schoolYearSchema.index({ status: 1 }, { unique: true, partialFilterExpression: { status: "ACTIVE" } });

schoolYearSchema.pre("validate", function () {
  if (this.startDate && this.endDate && this.startDate >= this.endDate) {
    this.invalidate("endDate", "La date de fin doit être postérieure à la date de début.");
  }
});

export type SchoolYearDoc = InferSchemaType<typeof schoolYearSchema>;
export const SchoolYear = registerModel("SchoolYear", schoolYearSchema);
