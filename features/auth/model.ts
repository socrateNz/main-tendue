import "server-only";

import { Schema, type InferSchemaType } from "mongoose";

import { ROLES } from "@/lib/auth/permissions";
import { registerModel } from "@/lib/db/schema-helpers";

/* ------------------------------------------------------------------ Utilisateurs */

export const USER_STATUSES = ["ACTIVE", "DISABLED"] as const;

const userSchema = new Schema(
  {
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    firstName: { type: String, required: true, trim: true, maxlength: 100 },
    lastName: { type: String, required: true, trim: true, maxlength: 100 },
    role: { type: String, enum: ROLES, required: true },
    status: { type: String, enum: USER_STATUSES, required: true, default: "ACTIVE" },
    /** Empreinte bcrypt — jamais renvoyée par défaut. */
    passwordHash: { type: String, required: true, select: false },
    passwordChangedAt: { type: Date },
    /** Mot de passe temporaire (création / réinitialisation) : changement obligatoire à la connexion. */
    mustChangePassword: { type: Boolean, required: true, default: true },
    lastLoginAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "users" },
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ role: 1, status: 1 });

export type UserDoc = InferSchemaType<typeof userSchema>;
export const User = registerModel("User", userSchema);

/* ------------------------------------------------------------------ Sessions */

const sessionSchema = new Schema(
  {
    /** SHA-256 du jeton de session (le jeton en clair n'existe que dans le cookie). */
    tokenHash: { type: String, required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    expiresAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    revokedAt: { type: Date },
    ip: { type: String, maxlength: 64 },
    userAgent: { type: String, maxlength: 512 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: "sessions" },
);

sessionSchema.index({ tokenHash: 1 }, { unique: true });
sessionSchema.index({ user: 1, revokedAt: 1 });
/** Purge automatique des sessions expirées par MongoDB. */
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type SessionDoc = InferSchemaType<typeof sessionSchema>;
export const Session = registerModel("Session", sessionSchema);

/* ------------------------------------------------------------------ Limitation des tentatives */

const loginAttemptSchema = new Schema(
  {
    /** Clé de limitation : `email:<adresse>` ou `ip:<adresse>`. */
    key: { type: String, required: true },
    count: { type: Number, required: true, default: 0 },
    windowStart: { type: Date, required: true },
    lockedUntil: { type: Date },
    expiresAt: { type: Date, required: true },
  },
  { collection: "login_attempts", versionKey: false },
);

loginAttemptSchema.index({ key: 1 }, { unique: true });
loginAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const LoginAttempt = registerModel("LoginAttempt", loginAttemptSchema);
