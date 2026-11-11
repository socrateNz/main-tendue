import "server-only";

import { Schema, type InferSchemaType } from "mongoose";

import { assetSchema, registerModel } from "@/lib/db/schema-helpers";
import { buildSearchText, normalizeSearch } from "@/lib/text";

import {
  CHILD_STATUSES,
  ENROLLMENT_OUTCOMES,
  GUARDIAN_RELATIONSHIPS,
  SCHOOL_TYPES,
  SEXES,
} from "./types";

/* ------------------------------------------------------------------ Établissements */

const schoolSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    type: { type: String, enum: SCHOOL_TYPES, required: true, default: "PRIMARY" },
    city: { type: String, trim: true, maxlength: 100 },
    address: { type: String, trim: true, maxlength: 300 },
    phone: { type: String, trim: true, maxlength: 30 },
    email: { type: String, trim: true, lowercase: true, maxlength: 254 },
    active: { type: Boolean, required: true, default: true },
    /** Clé d'unicité normalisée (nom + ville, sans accents ni casse). */
    uniqueKey: { type: String, required: true },
  },
  { timestamps: true, collection: "schools" },
);

schoolSchema.index({ uniqueKey: 1 }, { unique: true });
schoolSchema.pre("validate", function () {
  this.uniqueKey = normalizeSearch(`${this.name ?? ""}|${this.city ?? ""}`);
});

export type SchoolDoc = InferSchemaType<typeof schoolSchema>;
export const School = registerModel("School", schoolSchema);

/* ------------------------------------------------------------------ Enfants */

const guardianSchema = new Schema({
  relationship: { type: String, enum: GUARDIAN_RELATIONSHIPS, required: true },
  firstName: { type: String, required: true, trim: true, maxlength: 100 },
  lastName: { type: String, required: true, trim: true, maxlength: 100 },
  phone: { type: String, trim: true, maxlength: 30 },
  email: { type: String, trim: true, lowercase: true, maxlength: 254 },
  address: { type: String, trim: true, maxlength: 300 },
  occupation: { type: String, trim: true, maxlength: 100 },
  isPrimaryContact: { type: Boolean, default: false },
});

const childSchema = new Schema(
  {
    /** Matricule lisible, ex. ENF-00042. */
    code: { type: String, required: true },
    firstName: { type: String, required: true, trim: true, maxlength: 100 },
    lastName: { type: String, required: true, trim: true, maxlength: 100 },
    birthDate: { type: Date, required: true },
    sex: { type: String, enum: SEXES, required: true },
    birthPlace: { type: String, trim: true, maxlength: 100 },
    address: { type: String, trim: true, maxlength: 300 },
    city: { type: String, trim: true, maxlength: 100 },
    phone: { type: String, trim: true, maxlength: 30 },
    email: { type: String, trim: true, lowercase: true, maxlength: 254 },
    guardians: { type: [guardianSchema], default: [] },
    photo: { type: assetSchema, default: null },
    notes: { type: String, maxlength: 5000 },
    status: { type: String, enum: CHILD_STATUSES, required: true, default: "ACTIVE" },
    archivedAt: { type: Date },
    archivedBy: { type: Schema.Types.ObjectId, ref: "User" },
    archiveReason: { type: String, maxlength: 500 },
    searchText: { type: String, required: true },
    /** Nom + prénom normalisés : détection des doublons (avec la date de naissance). */
    identityKey: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "children" },
);

childSchema.index({ code: 1 }, { unique: true });
childSchema.index({ status: 1, lastName: 1, firstName: 1 });
childSchema.index({ searchText: 1 });
childSchema.index({ identityKey: 1, birthDate: 1 });

/** Clé d'identité partagée par le modèle et le service (contrôle de doublon). */
export function childIdentityKey(firstName: string, lastName: string): string {
  return normalizeSearch(`${lastName} ${firstName}`);
}

childSchema.pre("validate", function () {
  this.searchText = buildSearchText([this.code, this.firstName, this.lastName, ...this.guardians.map((g) => `${g.firstName} ${g.lastName}`)]);
  this.identityKey = childIdentityKey(this.firstName, this.lastName);
});

export type ChildDoc = InferSchemaType<typeof childSchema>;
export const Child = registerModel("Child", childSchema);

/* ------------------------------------------------------------------ Scolarité annuelle */

/** Historique scolaire : une inscription par enfant et par année scolaire. */
const enrollmentSchema = new Schema(
  {
    child: { type: Schema.Types.ObjectId, ref: "Child", required: true },
    schoolYear: { type: Schema.Types.ObjectId, ref: "SchoolYear", required: true },
    school: { type: Schema.Types.ObjectId, ref: "School", required: true },
    className: { type: String, required: true, trim: true, maxlength: 50 },
    level: { type: String, trim: true, maxlength: 50 },
    average: { type: Number, min: 0, max: 20 },
    rank: { type: String, trim: true, maxlength: 30 },
    outcome: { type: String, enum: ENROLLMENT_OUTCOMES, required: true, default: "PENDING" },
    notes: { type: String, maxlength: 2000 },
  },
  { timestamps: true, collection: "enrollments" },
);

enrollmentSchema.index({ child: 1, schoolYear: 1 }, { unique: true });
enrollmentSchema.index({ schoolYear: 1, school: 1 });

export type EnrollmentDoc = InferSchemaType<typeof enrollmentSchema>;
export const Enrollment = registerModel("Enrollment", enrollmentSchema);
