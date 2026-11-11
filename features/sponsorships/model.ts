import "server-only";

import { Schema, type InferSchemaType } from "mongoose";

import { registerModel } from "@/lib/db/schema-helpers";

import { SPONSORSHIP_STATUSES } from "./types";

/** Parrainage = association sponsor × enfant × année scolaire (docs/modele-donnees.md § 3). */
const sponsorshipSchema = new Schema(
  {
    sponsor: { type: Schema.Types.ObjectId, ref: "Sponsor", required: true },
    child: { type: Schema.Types.ObjectId, ref: "Child", required: true },
    schoolYear: { type: Schema.Types.ObjectId, ref: "SchoolYear", required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date },
    status: { type: String, enum: SPONSORSHIP_STATUSES, required: true, default: "ACTIVE" },
    endReason: { type: String, maxlength: 500 },
    notes: { type: String, maxlength: 2000 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "sponsorships" },
);

sponsorshipSchema.index({ sponsor: 1, child: 1, schoolYear: 1 }, { unique: true });
sponsorshipSchema.index({ child: 1, schoolYear: 1, status: 1 });
sponsorshipSchema.index({ schoolYear: 1, status: 1 });

sponsorshipSchema.pre("validate", function () {
  if (this.endDate && this.startDate && this.endDate < this.startDate) {
    this.invalidate("endDate", "La date de fin ne peut pas précéder la date de début.");
  }
});

export type SponsorshipDoc = InferSchemaType<typeof sponsorshipSchema>;
export const Sponsorship = registerModel("Sponsorship", sponsorshipSchema);
