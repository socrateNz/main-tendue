import "server-only";

import { Types } from "mongoose";

import { AuditLog } from "@/features/audit/model";
import { User } from "@/features/auth/model";
import { CASH_OPENING_ID, CashOpening } from "@/features/cashbox/model";
import { Enrollment } from "@/features/children/model";
import { SchoolYear } from "@/features/school-years/model";
import { Sponsorship } from "@/features/sponsorships/model";
import { connectDB } from "@/lib/db/mongoose";
import { fullName } from "@/lib/text";

import { computeTreasuryOverview, type YearCommitmentsFigures, type YearTreasuryFigures } from "./treasury";
import type { SchoolYearStatus } from "./types";

/** Objets sérialisables transmis aux composants (dates en ISO). */

export type SchoolYearListItem = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  status: SchoolYearStatus;
  archived: boolean;
  sponsorships: number;
  enrollments: number;
  figures: YearTreasuryFigures;
  source: "snapshot" | "live";
  isFirstYear: boolean;
};

export type SchoolYearsOverview = {
  items: SchoolYearListItem[];
  archivedCount: number;
  currentBalance: number;
  hasCashOpening: boolean;
};

async function countByYear(model: typeof Sponsorship | typeof Enrollment): Promise<Map<string, number>> {
  const rows = await model.aggregate<{ _id: Types.ObjectId; count: number }>([{ $group: { _id: "$schoolYear", count: { $sum: 1 } } }]);
  return new Map(rows.map((row) => [row._id.toString(), row.count]));
}

export async function getSchoolYearsOverview(options: { includeArchived: boolean }): Promise<SchoolYearsOverview> {
  await connectDB();
  const [years, overview, sponsorships, enrollments] = await Promise.all([
    SchoolYear.find({}, { label: 1, startDate: 1, endDate: 1, status: 1, archived: 1 }).sort({ startDate: -1 }).lean(),
    computeTreasuryOverview(),
    countByYear(Sponsorship),
    countByYear(Enrollment),
  ]);
  const treasury = new Map(overview.years.map((year) => [year.yearId, year]));

  const all = years.map<SchoolYearListItem>((year) => {
    const id = year._id.toString();
    const entry = treasury.get(id);
    return {
      id,
      label: year.label,
      startDate: year.startDate.toISOString(),
      endDate: year.endDate.toISOString(),
      status: year.status,
      archived: year.archived,
      sponsorships: sponsorships.get(id) ?? 0,
      enrollments: enrollments.get(id) ?? 0,
      figures: entry?.figures ?? { openingBalance: 0, contributions: 0, lateContributions: 0, donations: 0, advances: 0, expenses: 0, closingBalance: 0 },
      source: entry?.source ?? "live",
      isFirstYear: entry?.isFirstYear ?? false,
    };
  });

  return {
    items: options.includeArchived ? all : all.filter((year) => !year.archived),
    archivedCount: all.filter((year) => year.archived).length,
    currentBalance: overview.currentBalance,
    hasCashOpening: overview.cashOpening !== null,
  };
}

/* ------------------------------------------------------------------ Détail */

export type SchoolYearDetail = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  status: SchoolYearStatus;
  archived: boolean;
  notes: string | null;
  activatedAt: string | null;
  isFirstYear: boolean;
  isLatestClosed: boolean;
  previousLabel: string | null;
  figures: YearTreasuryFigures;
  source: "snapshot" | "live";
  commitmentsNow: YearCommitmentsFigures;
  commitmentsAtClosing: YearCommitmentsFigures | null;
  closing: { closedAt: string; closedBy: string; advancesAvailableAtClosing: number } | null;
  reopenings: Array<{ at: string; by: string; reason: string; previousClosingBalance: number }>;
  cashOpening: {
    amount: number;
    date: string;
    reason: string;
    createdAt: string;
    createdBy: string;
    corrections: Array<{ from: number; to: number; reason: string; at: string; by: string }>;
  } | null;
  /** Une année « première » sans solde initial attend son enregistrement. */
  awaitingCashOpening: boolean;
  history: Array<{ id: string; at: string; actor: string; action: string; summary: string }>;
  counts: { sponsorships: number; enrollments: number };
};

export async function getSchoolYearDetail(yearId: string): Promise<SchoolYearDetail | null> {
  if (!Types.ObjectId.isValid(yearId)) return null;
  await connectDB();
  const id = new Types.ObjectId(yearId);

  const [year, overview, opening, history, sponsorships, enrollments] = await Promise.all([
    SchoolYear.findById(id).lean(),
    computeTreasuryOverview(),
    CashOpening.findById(CASH_OPENING_ID).lean(),
    AuditLog.find({ $or: [{ entityType: "SchoolYear", entityId: id }, { entityType: "CashOpening", schoolYear: id }] })
      .sort({ at: -1 })
      .limit(30)
      .lean(),
    Sponsorship.countDocuments({ schoolYear: id }),
    Enrollment.countDocuments({ schoolYear: id }),
  ]);
  if (!year) return null;

  const index = overview.years.findIndex((entry) => entry.yearId === yearId);
  const entry = overview.years[index];
  const isOpeningYear = opening?.schoolYear.equals(id) ?? false;

  // Noms des auteurs, en une seule requête.
  const userIds = [
    year.closing?.closedBy,
    ...year.reopenings.map((r) => r.by),
    ...(isOpeningYear && opening ? [opening.createdBy, ...opening.corrections.map((c) => c.by)] : []),
  ].filter((value): value is Types.ObjectId => Boolean(value));
  const users = await User.find({ _id: { $in: userIds } }, { firstName: 1, lastName: 1 }).lean();
  const names = new Map(users.map((user) => [user._id.toString(), fullName(user)]));
  const nameOf = (value: Types.ObjectId | undefined | null) => (value ? (names.get(value.toString()) ?? "Utilisateur supprimé") : "—");

  const laterClosed = overview.years.slice(index + 1).some((other) => other.status === "CLOSED");

  return {
    id: yearId,
    label: year.label,
    startDate: year.startDate.toISOString(),
    endDate: year.endDate.toISOString(),
    status: year.status,
    archived: year.archived,
    notes: year.notes ?? null,
    activatedAt: year.activatedAt?.toISOString() ?? null,
    isFirstYear: entry?.isFirstYear ?? false,
    isLatestClosed: year.status === "CLOSED" && !laterClosed,
    previousLabel: index > 0 ? overview.years[index - 1].label : null,
    figures: entry.figures,
    source: entry.source,
    commitmentsNow: entry.commitmentsNow,
    commitmentsAtClosing: entry.commitmentsAtClosing,
    closing: year.closing
      ? {
          closedAt: year.closing.closedAt.toISOString(),
          closedBy: nameOf(year.closing.closedBy),
          advancesAvailableAtClosing: year.closing.advancesAvailableAtClosing,
        }
      : null,
    reopenings: year.reopenings
      .map((r) => ({ at: r.at.toISOString(), by: nameOf(r.by), reason: r.reason, previousClosingBalance: r.previousClosing.closingBalance }))
      .reverse(),
    cashOpening:
      isOpeningYear && opening
        ? {
            amount: opening.amount,
            date: opening.date.toISOString(),
            reason: opening.reason,
            createdAt: opening.createdAt.toISOString(),
            createdBy: nameOf(opening.createdBy),
            corrections: opening.corrections.map((c) => ({ from: c.from, to: c.to, reason: c.reason, at: c.at.toISOString(), by: nameOf(c.by) })).reverse(),
          }
        : null,
    awaitingCashOpening: (entry?.isFirstYear ?? false) && !opening,
    history: history.map((log) => ({ id: log._id.toString(), at: log.at.toISOString(), actor: log.actorLabel, action: log.action, summary: log.summary })),
    counts: { sponsorships, enrollments },
  };
}
