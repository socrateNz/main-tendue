import "server-only";

import { Schema, type InferSchemaType } from "mongoose";

import { registerModel, xafField } from "@/lib/db/schema-helpers";

import { COMMITMENT_STATUSES } from "./types";

/**
 * Engagement financier d'UN parrainage (docs/modele-donnees.md § 4).
 * Le montant reçu et le restant dû sont calculés (versements + affectations d'avances), jamais stockés.
 */

const expectedAdjustmentSchema = new Schema(
  {
    from: xafField(0),
    to: xafField(0),
    reason: { type: String, required: true, trim: true, minlength: 5, maxlength: 500 },
    by: { type: Schema.Types.ObjectId, ref: "User", required: true },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const commitmentSchema = new Schema(
  {
    sponsorship: { type: Schema.Types.ObjectId, ref: "Sponsorship", required: true },
    // Dénormalisés depuis le parrainage pour les filtres et agrégations ; toujours identiques.
    sponsor: { type: Schema.Types.ObjectId, ref: "Sponsor", required: true },
    child: { type: Schema.Types.ObjectId, ref: "Child", required: true },
    schoolYear: { type: Schema.Types.ObjectId, ref: "SchoolYear", required: true },
    /** Montant engagé par le sponsor. */
    committedAmount: xafField(1),
    /** Montant attendu (= engagé par défaut, ajustable avec motif). */
    expectedAmount: xafField(0),
    expectedAdjustments: { type: [expectedAdjustmentSchema], default: [] },
    status: { type: String, enum: COMMITMENT_STATUSES, required: true, default: "ACTIVE" },
    cancelledAt: { type: Date },
    cancelledBy: { type: Schema.Types.ObjectId, ref: "User" },
    cancelReason: { type: String, maxlength: 500 },
    notes: { type: String, maxlength: 2000 },
    /**
     * Incrémenté à chaque affectation (versement ou avance), dans la transaction qui l'écrit :
     * deux affectations simultanées sur le même engagement entrent en conflit d'écriture et l'une
     * est rejouée avec les montants à jour — le plafond « affecté ≤ attendu » ne peut pas être dépassé.
     */
    allocationVersion: { type: Number, required: true, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "commitments" },
);

commitmentSchema.index({ sponsorship: 1 }, { unique: true });
commitmentSchema.index({ sponsor: 1, schoolYear: 1, status: 1 });
commitmentSchema.index({ child: 1, schoolYear: 1 });
commitmentSchema.index({ schoolYear: 1, status: 1 });

commitmentSchema.pre("validate", function () {
  if (this.expectedAmount > this.committedAmount) {
    this.invalidate("expectedAmount", "Le montant attendu ne peut pas dépasser le montant engagé.");
  }
});

export type CommitmentDoc = InferSchemaType<typeof commitmentSchema>;
export const Commitment = registerModel("Commitment", commitmentSchema);
