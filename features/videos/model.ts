import "server-only";

import { Schema, type InferSchemaType } from "mongoose";

import { assetSchema, registerModel } from "@/lib/db/schema-helpers";

import { VIDEO_STATUSES } from "./types";

/* ------------------------------------------------------------------ Vidéos */

const deletionSchema = new Schema(
  {
    attempts: { type: Number, required: true, default: 0 },
    lastAttemptAt: { type: Date },
    /** Message d'erreur résumé (aucune donnée sensible). */
    lastError: { type: String, maxlength: 500 },
    /** Renseigné UNIQUEMENT après confirmation de la suppression par Cloudinary. */
    deletedAt: { type: Date },
  },
  { _id: false },
);

/** Vidéo de remerciement (docs/modele-donnees.md § 10). Les métadonnées survivent au fichier. */
const videoSchema = new Schema(
  {
    child: { type: Schema.Types.ObjectId, ref: "Child", required: true },
    schoolYear: { type: Schema.Types.ObjectId, ref: "SchoolYear", required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    message: { type: String, trim: true, maxlength: 2000 },
    asset: { type: assetSchema, required: true },
    status: { type: String, enum: VIDEO_STATUSES, required: true, default: "PROCESSING" },
    availableAt: { type: Date },
    expiresAt: { type: Date },
    revokedAt: { type: Date },
    revokedBy: { type: Schema.Types.ObjectId, ref: "User" },
    revokeReason: { type: String, maxlength: 500 },
    deletion: { type: deletionSchema, default: () => ({ attempts: 0 }) },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, collection: "videos" },
);

videoSchema.index({ child: 1, schoolYear: 1 });
videoSchema.index({ status: 1, expiresAt: 1 });
videoSchema.index({ "asset.publicId": 1 }, { unique: true });

videoSchema.pre("validate", function () {
  if (this.availableAt && this.expiresAt && this.expiresAt <= this.availableAt) {
    this.invalidate("expiresAt", "La date d'expiration doit être postérieure à la mise à disposition.");
  }
});

export type VideoDoc = InferSchemaType<typeof videoSchema>;
export const Video = registerModel("Video", videoSchema);

/* ------------------------------------------------------------------ Liens d'accès privés */

/** Un lien par sponsor et par vidéo. Le jeton n'est jamais stocké en clair. */
const videoAccessLinkSchema = new Schema(
  {
    video: { type: Schema.Types.ObjectId, ref: "Video", required: true },
    sponsor: { type: Schema.Types.ObjectId, ref: "Sponsor", required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    /** false dès que le lien est révoqué (manuellement, par régénération ou à l'échéance). */
    active: { type: Boolean, required: true, default: true },
    revokedAt: { type: Date },
    revokedBy: { type: Schema.Types.ObjectId, ref: "User" },
    lastAccessAt: { type: Date },
    accessCount: { type: Number, required: true, default: 0 },
    downloadCount: { type: Number, required: true, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, collection: "video_access_links" },
);

videoAccessLinkSchema.index({ tokenHash: 1 }, { unique: true });
/** Un seul lien actif par sponsor et par vidéo (régénérer = révoquer l'ancien). */
videoAccessLinkSchema.index(
  { video: 1, sponsor: 1 },
  { unique: true, partialFilterExpression: { active: true } },
);

export type VideoAccessLinkDoc = InferSchemaType<typeof videoAccessLinkSchema>;
export const VideoAccessLink = registerModel("VideoAccessLink", videoAccessLinkSchema);
