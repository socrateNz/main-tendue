import "server-only";

import { Schema, type InferSchemaType } from "mongoose";

import { assetSchema, registerModel } from "@/lib/db/schema-helpers";
import { buildSearchText, normalizeSearch } from "@/lib/text";

import { COUNTRY_CODE_PATTERN, SPONSOR_KINDS, SPONSOR_STATUSES, sponsorDisplayName } from "./types";

const addressSchema = new Schema(
  {
    line1: { type: String, trim: true, maxlength: 200 },
    line2: { type: String, trim: true, maxlength: 200 },
    postalCode: { type: String, trim: true, maxlength: 20 },
    city: { type: String, trim: true, maxlength: 100 },
    country: { type: String, trim: true, uppercase: true, match: COUNTRY_CODE_PATTERN },
  },
  { _id: false },
);

const sponsorSchema = new Schema(
  {
    /** Identifiant lisible, ex. SPN-00012. */
    code: { type: String, required: true },
    kind: { type: String, enum: SPONSOR_KINDS, required: true, default: "PERSON" },
    firstName: { type: String, trim: true, maxlength: 100 },
    lastName: { type: String, trim: true, maxlength: 100 },
    organizationName: { type: String, trim: true, maxlength: 200 },
    email: { type: String, trim: true, lowercase: true, maxlength: 254 },
    phone: { type: String, trim: true, maxlength: 30 },
    secondaryPhone: { type: String, trim: true, maxlength: 30 },
    address: { type: addressSchema, default: () => ({}) },
    photo: { type: assetSchema, default: null },
    notes: { type: String, maxlength: 5000 },
    status: { type: String, enum: SPONSOR_STATUSES, required: true, default: "ACTIVE" },
    statusChangedAt: { type: Date },
    statusReason: { type: String, maxlength: 500 },
    /** Nom affiché (« Prénom NOM » ou raison sociale) et clé de tri normalisée, calculés. */
    displayName: { type: String, required: true },
    sortName: { type: String, required: true },
    searchText: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "sponsors" },
);

sponsorSchema.index({ code: 1 }, { unique: true });
sponsorSchema.index({ status: 1, sortName: 1 });
sponsorSchema.index({ searchText: 1 });
sponsorSchema.index({ email: 1 }, { sparse: true });
sponsorSchema.index({ "address.country": 1 });

sponsorSchema.pre("validate", function () {
  if (this.kind === "PERSON" && (!this.firstName || !this.lastName)) {
    this.invalidate("lastName", "Le nom et le prénom sont obligatoires pour un particulier.");
  }
  if (this.kind === "ORGANIZATION" && !this.organizationName) {
    this.invalidate("organizationName", "Le nom de l'organisation est obligatoire.");
  }
  this.displayName = sponsorDisplayName(this);
  this.sortName = normalizeSearch(this.kind === "ORGANIZATION" ? (this.organizationName ?? "") : `${this.lastName ?? ""} ${this.firstName ?? ""}`);
  this.searchText = buildSearchText([this.code, this.firstName, this.lastName, this.organizationName, this.email, this.phone]);
});

export type SponsorDoc = InferSchemaType<typeof sponsorSchema>;
export const Sponsor = registerModel("Sponsor", sponsorSchema);
