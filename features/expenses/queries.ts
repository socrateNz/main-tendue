import "server-only";

import { Types } from "mongoose";

import { AuditLog } from "@/features/audit/model";
import { User } from "@/features/auth/model";
import { Child } from "@/features/children/model";
import { Expense, ExpenseCategory } from "@/features/expenses/model";
import type { MovementStatus } from "@/features/contributions/types";
import { SchoolYear } from "@/features/school-years/model";
import { signedAssetUrl, type StoredAsset } from "@/lib/cloudinary";
import { connectDB } from "@/lib/db/mongoose";
import { searchFilter, toPaginated, type ListParams, type Paginated } from "@/lib/db/pagination";
import { fullName, normalizeSearch } from "@/lib/text";

import type { AllocationMode, ExpenseScope } from "./types";

export type CategoryItem = { id: string; name: string; description: string | null; active: boolean; total: number; count: number };

/** Catégories avec le total des dépenses valides (toutes années). */
export async function listCategories(): Promise<CategoryItem[]> {
  await connectDB();
  const [categories, totals] = await Promise.all([
    ExpenseCategory.find({}).sort({ active: -1, name: 1 }).lean(),
    Expense.aggregate<{ _id: Types.ObjectId; total: number; count: number }>([
      { $match: { status: "VALID" } },
      { $group: { _id: "$category", total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
  ]);
  const byId = new Map(totals.map((t) => [t._id.toString(), t]));
  return categories.map((c) => ({
    id: c._id.toString(),
    name: c.name,
    description: c.description ?? null,
    active: c.active,
    total: byId.get(c._id.toString())?.total ?? 0,
    count: byId.get(c._id.toString())?.count ?? 0,
  }));
}

export const EXPENSE_SORTS = ["spentAt", "amount", "number"] as const;
export type ExpenseSort = (typeof EXPENSE_SORTS)[number];
export type ExpenseFilters = { yearId: string | null; categoryId: string | null; scope: ExpenseScope | null; status: MovementStatus | "ALL" };

export type ExpenseListItem = {
  id: string;
  number: string;
  spentAt: string;
  categoryName: string;
  description: string;
  supplier: string | null;
  amount: number;
  scope: ExpenseScope;
  childrenCount: number;
  status: MovementStatus;
};

export async function listExpenses(
  params: ListParams<ExpenseSort>,
  filters: ExpenseFilters,
): Promise<Paginated<ExpenseListItem> & { total: number; totalAmount: number; byCategory: Array<{ name: string; amount: number }> }> {
  await connectDB();
  const query: Record<string, unknown> = {};
  if (filters.yearId && Types.ObjectId.isValid(filters.yearId)) query.schoolYear = new Types.ObjectId(filters.yearId);
  if (filters.categoryId && Types.ObjectId.isValid(filters.categoryId)) query.category = new Types.ObjectId(filters.categoryId);
  if (filters.scope) query.scope = filters.scope;
  if (filters.status !== "ALL") query.status = filters.status;
  if (params.q) {
    const words = searchFilter(params.q, "searchText", normalizeSearch);
    const childIds = await Child.distinct("_id", words);
    const raw = params.q.trim();
    query.$or = [{ "allocations.child": { $in: childIds } }, { number: raw.toUpperCase() }, { description: { $regex: raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } }];
  }
  const direction = params.dir === "asc" ? 1 : -1;
  const [expenses, total, sums] = await Promise.all([
    Expense.find(query).sort({ [params.sort]: direction, _id: -1 }).skip((params.page - 1) * params.pageSize).limit(params.pageSize).lean(),
    Expense.countDocuments(query),
    // Totaux : montant de la dépense UNIQUEMENT (jamais les allocations), hors annulées.
    Expense.aggregate<{ _id: Types.ObjectId; total: number }>([{ $match: { ...query, status: "VALID" } }, { $group: { _id: "$category", total: { $sum: "$amount" } } }]),
  ]);
  const categories = await ExpenseCategory.find({ _id: { $in: [...expenses.map((e) => e.category), ...sums.map((s) => s._id)] } }, { name: 1 }).lean();
  const names = new Map(categories.map((c) => [c._id.toString(), c.name]));
  const items = expenses.map<ExpenseListItem>((e) => ({
    id: e._id.toString(),
    number: e.number,
    spentAt: e.spentAt.toISOString(),
    categoryName: names.get(e.category.toString()) ?? "—",
    description: e.description,
    supplier: e.supplier ?? null,
    amount: e.amount,
    scope: e.scope,
    childrenCount: e.allocations.length,
    status: e.status,
  }));
  return {
    ...toPaginated(items, total, params),
    totalAmount: sums.reduce((sum, s) => sum + s.total, 0),
    byCategory: sums.map((s) => ({ name: names.get(s._id.toString()) ?? "—", amount: s.total })).sort((a, b) => b.amount - a.amount),
  };
}

export type ExpenseDetail = ExpenseListItem & {
  yearLabel: string;
  yearStatus: string;
  reference: string | null;
  allocationMode: AllocationMode | null;
  allocations: Array<{ childId: string; childName: string; childCode: string; amount: number }>;
  attachments: Array<{ name: string; url: string | null; isPdf: boolean }>;
  cancellation: { reason: string; at: string; by: string } | null;
  createdBy: string;
  createdAt: string;
  history: Array<{ id: string; at: string; actor: string; summary: string }>;
};

export async function getExpenseDetail(expenseId: string): Promise<ExpenseDetail | null> {
  if (!Types.ObjectId.isValid(expenseId)) return null;
  await connectDB();
  const expense = await Expense.findById(expenseId).lean();
  if (!expense) return null;
  const [category, year, children, users, history] = await Promise.all([
    ExpenseCategory.findById(expense.category, { name: 1 }).lean(),
    SchoolYear.findById(expense.schoolYear, { label: 1, status: 1 }).lean(),
    Child.find({ _id: { $in: expense.allocations.map((a) => a.child) } }, { firstName: 1, lastName: 1, code: 1 }).lean(),
    User.find({ _id: { $in: [expense.createdBy, expense.cancellation?.by].filter(Boolean) } }, { firstName: 1, lastName: 1 }).lean(),
    AuditLog.find({ entityType: "Expense", entityId: expense._id }).sort({ at: -1 }).limit(20).lean(),
  ]);
  const childMap = new Map(children.map((c) => [c._id.toString(), c]));
  const userName = new Map(users.map((u) => [u._id.toString(), fullName(u)]));
  return {
    id: expense._id.toString(),
    number: expense.number,
    spentAt: expense.spentAt.toISOString(),
    categoryName: category?.name ?? "—",
    description: expense.description,
    supplier: expense.supplier ?? null,
    reference: expense.reference ?? null,
    amount: expense.amount,
    scope: expense.scope,
    childrenCount: expense.allocations.length,
    status: expense.status,
    yearLabel: year?.label ?? "—",
    yearStatus: year?.status ?? "DRAFT",
    allocationMode: expense.allocationMode ?? null,
    allocations: expense.allocations.map((a) => {
      const child = childMap.get(a.child.toString());
      return { childId: a.child.toString(), childName: child ? fullName(child) : "—", childCode: child?.code ?? "", amount: a.amount };
    }),
    attachments: expense.attachments.map((asset) => ({ name: asset.originalFilename ?? "Justificatif", url: signedAssetUrl(asset as StoredAsset), isPdf: asset.format === "pdf" })),
    cancellation: expense.cancellation
      ? { reason: expense.cancellation.reason, at: expense.cancellation.at.toISOString(), by: userName.get(expense.cancellation.by.toString()) ?? "—" }
      : null,
    createdBy: userName.get(expense.createdBy.toString()) ?? "—",
    createdAt: expense.createdAt.toISOString(),
    history: history.map((log) => ({ id: log._id.toString(), at: log.at.toISOString(), actor: log.actorLabel, summary: log.summary })),
  };
}

/** Part de l'enfant dans chaque dépense (individuelle ou collective). */
export async function listChildExpenses(childId: string) {
  await connectDB();
  const id = new Types.ObjectId(childId);
  const expenses = await Expense.find({ "allocations.child": id }).sort({ spentAt: -1 }).lean();
  const [categories, years] = await Promise.all([
    ExpenseCategory.find({ _id: { $in: expenses.map((e) => e.category) } }, { name: 1 }).lean(),
    SchoolYear.find({ _id: { $in: expenses.map((e) => e.schoolYear) } }, { label: 1 }).lean(),
  ]);
  const categoryName = new Map(categories.map((c) => [c._id.toString(), c.name]));
  const yearLabel = new Map(years.map((y) => [y._id.toString(), y.label]));
  return expenses.map((e) => ({
    id: e._id.toString(),
    number: e.number,
    spentAt: e.spentAt.toISOString(),
    description: e.description,
    categoryName: categoryName.get(e.category.toString()) ?? "—",
    yearLabel: yearLabel.get(e.schoolYear.toString()) ?? "—",
    scope: e.scope,
    share: e.allocations.find((a) => a.child.equals(id))?.amount ?? 0,
    total: e.amount,
    cancelled: e.status === "CANCELLED",
  }));
}
export type ChildExpenseRow = Awaited<ReturnType<typeof listChildExpenses>>[number];
