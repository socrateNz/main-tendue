import "server-only";

import { Types, mongo } from "mongoose";
import type { z } from "zod";

import { actorOf, type RequestContext, type SessionUser } from "@/features/auth/service";
import { Child } from "@/features/children/model";
import { Expense, ExpenseCategory } from "@/features/expenses/model";
import type { categorySchema, ExpenseData } from "@/features/expenses/schemas";
import { SchoolYear } from "@/features/school-years/model";
import { resolveMovementYear } from "@/features/school-years/service";
import { recordAudit } from "@/lib/audit";
import { CLOUDINARY_FOLDERS, destroyAsset, detectDocumentType, readDocumentFile, uploadPrivateDocument } from "@/lib/cloudinary";
import { formatNumber, nextSequence } from "@/lib/db/counter";
import { connectDB, withTransaction } from "@/lib/db/mongoose";
import { formatDate, parseDateInput, startOfUtcDay } from "@/lib/dates";
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatXaf } from "@/lib/money";

import { EXPENSE_SCOPE_LABELS, checkExpenseAllocations, equalAllocations } from "./types";

/**
 * Dépenses de la caisse centrale (docs/modele-donnees.md § 8, § 9).
 * Une dépense = UN mouvement de trésorerie (`amount`). Les allocations ne servent qu'à identifier la
 * part de chaque enfant ; elles ne sont jamais additionnées dans les totaux financiers.
 */

/* ------------------------------------------------------------------ Catégories */

export async function createCategory(actor: SessionUser, data: z.output<typeof categorySchema>, ctx: RequestContext): Promise<string> {
  try {
    return await withTransaction(async (session) => {
      const [category] = await ExpenseCategory.create([data], { session });
      await recordAudit(actorOf(actor, ctx), { action: "expenseCategory.create", summary: `Création de la catégorie de dépenses « ${data.name} ».`, entityType: "ExpenseCategory", entityId: category._id }, session);
      return category._id.toString();
    });
  } catch (error) {
    if (error instanceof mongo.MongoServerError && error.code === 11000) throw new ConflictError("Cette catégorie existe déjà.", { name: ["Déjà existante."] });
    throw error;
  }
}

export async function updateCategory(actor: SessionUser, categoryId: string, data: z.output<typeof categorySchema>, active: boolean, ctx: RequestContext): Promise<void> {
  try {
    await withTransaction(async (session) => {
      const category = await ExpenseCategory.findById(categoryId).session(session);
      if (!category) throw new NotFoundError("Catégorie introuvable.");
      category.set({ name: data.name, description: data.description ?? "", active });
      await category.save({ session });
      await recordAudit(actorOf(actor, ctx), { action: "expenseCategory.update", summary: `Modification de la catégorie « ${data.name} »${active ? "" : " (désactivée)"}.`, entityType: "ExpenseCategory", entityId: category._id }, session);
    });
  } catch (error) {
    if (error instanceof mongo.MongoServerError && error.code === 11000) throw new ConflictError("Une catégorie porte déjà ce nom.", { name: ["Déjà existante."] });
    throw error;
  }
}

/* ------------------------------------------------------------------ Dépenses */

export async function createExpense(actor: SessionUser, data: ExpenseData, ctx: RequestContext): Promise<string> {
  const spentAt = parseDateInput(data.spentAt);
  if (!spentAt) throw new ValidationError("Date invalide.", { spentAt: ["Date invalide."] });
  if (spentAt > startOfUtcDay(new Date())) throw new BusinessRuleError("La date de la dépense ne peut pas être dans le futur.", { spentAt: ["Date future."] });

  // Parts égales recalculées par le serveur (le reste va au premier enfant de la liste).
  const allocations =
    data.scope === "COLLECTIVE" && data.allocationMode === "EQUAL"
      ? equalAllocations(data.amount, data.allocations.map((a) => a.childId))
      : data.scope === "GENERAL"
        ? []
        : data.allocations;
  const check = checkExpenseAllocations(data.amount, data.scope, data.scope === "COLLECTIVE" ? data.allocationMode : null, allocations);
  if (!check.ok) throw new BusinessRuleError(check.message, { allocations: [check.message] });

  return withTransaction(async (session) => {
    const year = await resolveMovementYear(spentAt, session);
    const category = await ExpenseCategory.findById(data.categoryId, { name: 1, active: 1 }).session(session).lean();
    if (!category || !category.active) throw new BusinessRuleError("Catégorie introuvable ou désactivée.", { categoryId: ["Catégorie invalide."] });
    if (allocations.length > 0) {
      const found = await Child.countDocuments({ _id: { $in: allocations.map((a) => new Types.ObjectId(a.childId)) } }).session(session);
      if (found !== allocations.length) throw new NotFoundError("Un des enfants est introuvable.");
    }

    const number = formatNumber(`DEP-${year.label.slice(0, 4)}`, await nextSequence(`expense:${year.label}`, session));
    const [expense] = await Expense.create(
      [
        {
          number,
          schoolYear: year._id,
          category: category._id,
          amount: data.amount,
          spentAt,
          description: data.description,
          supplier: data.supplier,
          reference: data.reference,
          scope: data.scope,
          allocationMode: data.scope === "COLLECTIVE" ? data.allocationMode : undefined,
          allocations: allocations.map((a) => ({ child: new Types.ObjectId(a.childId), amount: a.amount })),
          createdBy: new Types.ObjectId(actor.id),
        },
      ],
      { session },
    );
    await recordAudit(actorOf(actor, ctx), {
      action: "expense.create",
      summary: `Dépense ${number} : ${formatXaf(data.amount)} le ${formatDate(spentAt)} (${category.name}, ${EXPENSE_SCOPE_LABELS[data.scope].toLowerCase()}${allocations.length > 1 ? `, ${allocations.length} enfants` : ""}).`,
      entityType: "Expense",
      entityId: expense._id,
      schoolYear: year._id,
      details: { amount: data.amount, scope: data.scope, allocationMode: data.allocationMode, allocations },
    }, session);
    return expense._id.toString();
  });
}

export async function cancelExpense(actor: SessionUser, expenseId: string, reason: string, ctx: RequestContext): Promise<void> {
  await withTransaction(async (session) => {
    const expense = await Expense.findById(expenseId).session(session).lean();
    if (!expense) throw new NotFoundError("Dépense introuvable.");
    if (expense.status === "CANCELLED") throw new BusinessRuleError("Cette dépense est déjà annulée : elle ne peut être ni réactivée ni modifiée.");
    const year = await SchoolYear.findById(expense.schoolYear, { label: 1, status: 1 }).session(session).lean();
    if (year?.status === "CLOSED") throw new BusinessRuleError(`L'année ${year.label} est clôturée : ses mouvements ne peuvent plus être annulés.`);
    await Expense.updateOne(
      { _id: expense._id, status: "VALID" },
      { $set: { status: "CANCELLED", cancellation: { reason, by: new Types.ObjectId(actor.id), at: new Date() } } },
      { session },
    );
    await recordAudit(actorOf(actor, ctx), {
      action: "expense.cancel",
      summary: `Annulation de la dépense ${expense.number} (${formatXaf(expense.amount)}).`,
      entityType: "Expense",
      entityId: expense._id,
      schoolYear: expense.schoolYear,
      details: { reason },
    }, session);
  });
}

export async function addExpenseAttachment(actor: SessionUser, expenseId: string, file: File, ctx: RequestContext): Promise<void> {
  const buffer = await readDocumentFile(file);
  await connectDB();
  const expense = await Expense.findById(expenseId, { number: 1, attachments: 1, schoolYear: 1 }).lean();
  if (!expense) throw new NotFoundError("Dépense introuvable.");
  if (expense.attachments.length >= 5) throw new BusinessRuleError("5 justificatifs maximum par dépense.");
  const asset = await uploadPrivateDocument(buffer, detectDocumentType(buffer), CLOUDINARY_FOLDERS.receipts, file.name);
  try {
    await withTransaction(async (session) => {
      await Expense.updateOne({ _id: expense._id }, { $push: { attachments: asset } }, { session });
      await recordAudit(actorOf(actor, ctx), {
        action: "expense.attachment.add",
        summary: `Justificatif ajouté à la dépense ${expense.number} (${file.name.slice(0, 80)}).`,
        entityType: "Expense",
        entityId: expense._id,
        schoolYear: expense.schoolYear,
      }, session);
    });
  } catch (error) {
    await destroyAsset(asset);
    throw error;
  }
}
