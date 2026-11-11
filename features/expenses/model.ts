import "server-only";

import { Schema, type InferSchemaType } from "mongoose";

import { assetSchema, cancellationSchema, forbidDeletion, registerModel, xafField } from "@/lib/db/schema-helpers";
import { normalizeSearch } from "@/lib/text";

import { MOVEMENT_STATUSES } from "@/features/contributions/types";

import { ALLOCATION_MODES, EXPENSE_SCOPES, checkExpenseAllocations } from "./types";

/* ------------------------------------------------------------------ Catégories */

const expenseCategorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 500 },
    active: { type: Boolean, required: true, default: true },
    nameKey: { type: String, required: true },
  },
  { timestamps: true, collection: "expense_categories" },
);

expenseCategorySchema.index({ nameKey: 1 }, { unique: true });
expenseCategorySchema.pre("validate", function () {
  this.nameKey = normalizeSearch(this.name ?? "");
});

export type ExpenseCategoryDoc = InferSchemaType<typeof expenseCategorySchema>;
export const ExpenseCategory = registerModel("ExpenseCategory", expenseCategorySchema);

/* ------------------------------------------------------------------ Dépenses */

const allocationSchema = new Schema(
  {
    child: { type: Schema.Types.ObjectId, ref: "Child", required: true },
    amount: xafField(0),
  },
  { _id: false },
);

/**
 * Dépense de la caisse centrale (docs/modele-donnees.md § 8).
 * `amount` est le SEUL montant comptabilisé ; les allocations identifient la part de chaque enfant
 * et ne doivent jamais être additionnées dans les totaux financiers.
 */
const expenseSchema = new Schema(
  {
    number: { type: String, required: true },
    schoolYear: { type: Schema.Types.ObjectId, ref: "SchoolYear", required: true },
    category: { type: Schema.Types.ObjectId, ref: "ExpenseCategory", required: true },
    amount: xafField(1),
    spentAt: { type: Date, required: true },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    supplier: { type: String, trim: true, maxlength: 200 },
    reference: { type: String, trim: true, maxlength: 100 },
    scope: { type: String, enum: EXPENSE_SCOPES, required: true },
    allocationMode: { type: String, enum: ALLOCATION_MODES },
    allocations: { type: [allocationSchema], default: [] },
    attachments: { type: [assetSchema], default: [] },
    status: { type: String, enum: MOVEMENT_STATUSES, required: true, default: "VALID" },
    cancellation: { type: cancellationSchema, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, collection: "expenses" },
);

expenseSchema.index({ number: 1 }, { unique: true });
expenseSchema.index({ schoolYear: 1, status: 1, spentAt: -1 });
expenseSchema.index({ category: 1, spentAt: -1 });
expenseSchema.index({ "allocations.child": 1, status: 1 });

expenseSchema.pre("validate", function () {
  const check = checkExpenseAllocations(
    this.amount,
    this.scope,
    this.allocationMode,
    this.allocations.map((a) => ({ childId: a.child.toString(), amount: a.amount })),
  );
  if (!check.ok) this.invalidate("allocations", check.message);

  if (this.status === "CANCELLED" && !this.cancellation) {
    this.invalidate("cancellation", "Une annulation doit comporter un motif, un auteur et une date.");
  }
});

forbidDeletion(expenseSchema, "dépense");

export type ExpenseDoc = InferSchemaType<typeof expenseSchema>;
export const Expense = registerModel("Expense", expenseSchema);
