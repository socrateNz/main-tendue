import "server-only";

import { Schema, type InferSchemaType } from "mongoose";

import { assetSchema, cancellationSchema, forbidDeletion, registerModel, xafField } from "@/lib/db/schema-helpers";
import { CURRENCY_CODES, RATE_PATTERN, convertToXaf } from "@/lib/money";

import { MOVEMENT_STATUSES, PAYMENT_LINE_KINDS, PAYMENT_METHODS, checkPaymentLines } from "./types";

/* ------------------------------------------------------------------ Versements */

/**
 * Ligne de ventilation. Pour une ligne COMMITMENT, l'année de l'ENGAGEMENT (`commitmentYear`) est
 * conservée à côté de l'année du MOUVEMENT (`payment.schoolYear`) : elles diffèrent pour un
 * règlement tardif (arriéré), signalé par `lateSettlement`.
 */
const paymentLineSchema = new Schema({
  kind: { type: String, enum: PAYMENT_LINE_KINDS, required: true },
  commitment: { type: Schema.Types.ObjectId, ref: "Commitment" },
  commitmentYear: { type: Schema.Types.ObjectId, ref: "SchoolYear" },
  lateSettlement: { type: Boolean, default: false },
  amount: xafField(1),
});

const currencySchema = new Schema(
  {
    code: { type: String, enum: CURRENCY_CODES, required: true, default: "XAF" },
    /** Montant d'origine en unités mineures (centimes EUR/USD ; FCFA pour XAF). */
    originalAmountMinor: { type: Number, required: true, min: 1 },
    /** Taux « 1 unité = rate XAF », saisi manuellement, conservé tel quel (texte décimal exact). */
    rate: { type: String, required: true, match: RATE_PATTERN },
    convertedAt: { type: Date, required: true },
  },
  { _id: false },
);

const paymentSchema = new Schema(
  {
    /** Numéro lisible unique, ex. VRS-2025-000123. */
    number: { type: String, required: true },
    sponsor: { type: Schema.Types.ObjectId, ref: "Sponsor", required: true },
    /** Date réelle d'encaissement. */
    receivedAt: { type: Date, required: true },
    /** Année du MOUVEMENT : calculée par le serveur à partir de `receivedAt`, jamais choisie par l'utilisateur. */
    schoolYear: { type: Schema.Types.ObjectId, ref: "SchoolYear", required: true },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    reference: { type: String, trim: true, maxlength: 100 },
    currency: { type: currencySchema, required: true },
    /** Montant comptable en XAF : seul montant utilisé dans les calculs. */
    amountXaf: xafField(1),
    lines: { type: [paymentLineSchema], required: true },
    note: { type: String, maxlength: 2000 },
    attachments: { type: [assetSchema], default: [] },
    status: { type: String, enum: MOVEMENT_STATUSES, required: true, default: "VALID" },
    cancellation: { type: cancellationSchema, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, collection: "payments" },
);

paymentSchema.index({ number: 1 }, { unique: true });
paymentSchema.index({ sponsor: 1, receivedAt: -1 });
paymentSchema.index({ schoolYear: 1, status: 1, receivedAt: -1 });
paymentSchema.index({ "lines.commitment": 1, status: 1 });
/** Registre des avances par sponsor. */
paymentSchema.index({ sponsor: 1, "lines.kind": 1, status: 1 });
/** Anti-doublon : une même référence de paiement ne peut exister qu'une fois parmi les versements valides. */
paymentSchema.index(
  { method: 1, reference: 1 },
  { unique: true, partialFilterExpression: { status: "VALID", reference: { $type: "string" } } },
);

/** Défense en profondeur : les invariants intrinsèques sont revérifiés à chaque écriture. */
paymentSchema.pre("validate", function () {
  const check = checkPaymentLines(
    this.amountXaf,
    this.lines.map((line) => ({ kind: line.kind, commitmentId: line.commitment?.toString(), amount: line.amount })),
  );
  if (!check.ok) this.invalidate("lines", check.message);

  for (const line of this.lines) {
    if (line.kind === "COMMITMENT" && !line.commitmentYear) {
      this.invalidate("lines", "Une contribution doit conserver l'année de l'engagement affecté.");
    }
    if (line.kind !== "COMMITMENT" && (line.commitmentYear || line.lateSettlement)) {
      this.invalidate("lines", "Un don ou une avance n'est rattaché à aucun engagement.");
    }
    if (line.kind === "COMMITMENT" && line.commitmentYear) {
      const late = !line.commitmentYear.equals(this.schoolYear);
      if (late !== Boolean(line.lateSettlement)) {
        this.invalidate("lines", "Le marquage de règlement tardif est incohérent avec les années.");
      }
    }
  }

  const { code, originalAmountMinor, rate } = this.currency;
  try {
    if (convertToXaf(originalAmountMinor, code, rate) !== this.amountXaf) {
      this.invalidate("amountXaf", "Le montant XAF ne correspond pas à la conversion du montant d'origine.");
    }
  } catch {
    this.invalidate("currency", "Montant d'origine ou taux de conversion invalide.");
  }

  if (this.status === "CANCELLED" && !this.cancellation) {
    this.invalidate("cancellation", "Une annulation doit comporter un motif, un auteur et une date.");
  }
});

forbidDeletion(paymentSchema, "versement");

export type PaymentDoc = InferSchemaType<typeof paymentSchema>;
export const Payment = registerModel("Payment", paymentSchema);

/* ------------------------------------------------------------------ Affectations d'avances */

/** Affectation explicite et validée d'une avance (crédit) à un engagement (docs/modele-donnees.md § 6). */
const creditApplicationSchema = new Schema(
  {
    number: { type: String, required: true },
    sponsor: { type: Schema.Types.ObjectId, ref: "Sponsor", required: true },
    sourcePayment: { type: Schema.Types.ObjectId, ref: "Payment", required: true },
    /** Identifiant de la ligne ADVANCE du versement source. */
    sourceLine: { type: Schema.Types.ObjectId, required: true },
    /** Année du mouvement de trésorerie d'origine (encaissement de l'avance). */
    sourceYear: { type: Schema.Types.ObjectId, ref: "SchoolYear", required: true },
    commitment: { type: Schema.Types.ObjectId, ref: "Commitment", required: true },
    /** Année de l'engagement visé. Une affectation n'est PAS un mouvement de trésorerie. */
    schoolYear: { type: Schema.Types.ObjectId, ref: "SchoolYear", required: true },
    /** Vrai si l'engagement appartient à une année antérieure à la date d'affectation (arriéré). */
    lateSettlement: { type: Boolean, required: true, default: false },
    amount: xafField(1),
    validatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    validatedAt: { type: Date, required: true },
    note: { type: String, maxlength: 1000 },
    status: { type: String, enum: MOVEMENT_STATUSES, required: true, default: "VALID" },
    cancellation: { type: cancellationSchema, default: null },
  },
  { timestamps: true, collection: "credit_applications" },
);

creditApplicationSchema.index({ number: 1 }, { unique: true });
creditApplicationSchema.index({ sourcePayment: 1, sourceLine: 1, status: 1 });
creditApplicationSchema.index({ commitment: 1, status: 1 });
creditApplicationSchema.index({ sponsor: 1, status: 1 });

creditApplicationSchema.pre("validate", function () {
  if (this.status === "CANCELLED" && !this.cancellation) {
    this.invalidate("cancellation", "Une annulation doit comporter un motif, un auteur et une date.");
  }
});

forbidDeletion(creditApplicationSchema, "affectation d'avance");

export type CreditApplicationDoc = InferSchemaType<typeof creditApplicationSchema>;
export const CreditApplication = registerModel("CreditApplication", creditApplicationSchema);
