import "server-only";

import { Schema, type InferSchemaType } from "mongoose";

import { registerModel } from "@/lib/db/schema-helpers";

/**
 * Journal d'audit — en ajout seul : aucune mise à jour ni suppression n'est permise par le modèle.
 */
const auditLogSchema = new Schema(
  {
    at: { type: Date, required: true, default: () => new Date() },
    actor: { type: Schema.Types.ObjectId, ref: "User" },
    /** Libellé figé de l'auteur (« Système », « Sponsor via lien vidéo », nom de l'utilisateur…). */
    actorLabel: { type: String, required: true, maxlength: 200 },
    /** Action normalisée, ex. `payment.create`, `payment.cancel`, `auth.login.failed`. */
    action: { type: String, required: true, maxlength: 100 },
    entityType: { type: String, maxlength: 50 },
    entityId: { type: Schema.Types.ObjectId },
    schoolYear: { type: Schema.Types.ObjectId, ref: "SchoolYear" },
    summary: { type: String, required: true, maxlength: 500 },
    /** Données utiles à la reconstitution (avant / après, montants…), jamais de secret. */
    details: { type: Schema.Types.Mixed },
    ip: { type: String, maxlength: 64 },
    userAgent: { type: String, maxlength: 512 },
  },
  { collection: "audit_logs", versionKey: false },
);

auditLogSchema.index({ at: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1, at: -1 });
auditLogSchema.index({ actor: 1, at: -1 });
auditLogSchema.index({ action: 1, at: -1 });

const immutable = () => {
  throw new Error("Le journal d'audit est en ajout seul.");
};
auditLogSchema.pre(
  ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete"],
  immutable,
);

export type AuditLogDoc = InferSchemaType<typeof auditLogSchema>;
export const AuditLog = registerModel("AuditLog", auditLogSchema);
