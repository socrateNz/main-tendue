import "server-only";

import type { ClientSession, Types } from "mongoose";

import { CASH_OPENING_ID, CashOpening } from "@/features/cashbox/model";
import { Commitment } from "@/features/commitments/model";
import { CreditApplication, Payment } from "@/features/contributions/model";
import { Expense } from "@/features/expenses/model";
import { SchoolYear } from "@/features/school-years/model";
import { connectDB } from "@/lib/db/mongoose";

import { computeClosingBalance, type SchoolYearStatus } from "./types";

/**
 * Trésorerie de la caisse centrale, par année (docs/modele-donnees.md § 8).
 *
 * Seuls les MOUVEMENTS DE TRÉSORERIE (solde initial, versements, dépenses) entrent dans le solde.
 * Les affectations d'avances (`credit_applications`) n'y figurent jamais : elles n'apparaissent que
 * dans la situation des engagements. Une année clôturée reprend son instantané immuable.
 */

export type YearTreasuryFigures = {
  openingBalance: number;
  contributions: number;
  lateContributions: number;
  donations: number;
  advances: number;
  expenses: number;
  closingBalance: number;
};

export type YearCommitmentsFigures = { expected: number; allocated: number };

export type YearTreasury = {
  yearId: string;
  label: string;
  status: SchoolYearStatus;
  startDate: Date;
  endDate: Date;
  /** `snapshot` : figé à la clôture ; `live` : calculé à l'instant. */
  source: "snapshot" | "live";
  figures: YearTreasuryFigures;
  /** Situation des engagements de l'année, calculée à l'instant (règlements tardifs inclus). */
  commitmentsNow: YearCommitmentsFigures;
  /** Situation des engagements figée à la clôture (années clôturées uniquement). */
  commitmentsAtClosing: YearCommitmentsFigures | null;
  isFirstYear: boolean;
};

export type TreasuryOverview = {
  years: YearTreasury[];
  cashOpening: { yearId: string; amount: number } | null;
  /** Crédit d'avances encaissé et non encore affecté (tous sponsors). */
  advancesAvailable: number;
  /** Solde de caisse actuel : clôture calculée de la dernière année. */
  currentBalance: number;
};

type Key = string;
const key = (id: Types.ObjectId | null | undefined): Key => (id ? id.toString() : "");

/** Calcule la trésorerie de toutes les années, dans l'ordre chronologique. */
export async function computeTreasuryOverview(session?: ClientSession): Promise<TreasuryOverview> {
  await connectDB();

  const [years, cashOpening, lineTotals, expenseTotals, commitmentTotals, allocatedByLines, allocatedByCredits, advanceBalance] =
    await Promise.all([
      SchoolYear.find({}, { label: 1, status: 1, startDate: 1, endDate: 1, closing: 1 }).sort({ startDate: 1 }).session(session ?? null).lean(),
      CashOpening.findById(CASH_OPENING_ID, { schoolYear: 1, amount: 1 }).session(session ?? null).lean(),
      // Encaissements par année du MOUVEMENT et par nature de ligne.
      Payment.aggregate<{ _id: { year: Types.ObjectId; kind: string; late: boolean }; total: number }>([
        { $match: { status: "VALID" } },
        { $unwind: "$lines" },
        {
          $group: {
            _id: { year: "$schoolYear", kind: "$lines.kind", late: { $ifNull: ["$lines.lateSettlement", false] } },
            total: { $sum: "$lines.amount" },
          },
        },
      ]).session(session ?? null),
      Expense.aggregate<{ _id: Types.ObjectId; total: number }>([
        { $match: { status: "VALID" } },
        { $group: { _id: "$schoolYear", total: { $sum: "$amount" } } },
      ]).session(session ?? null),
      Commitment.aggregate<{ _id: Types.ObjectId; total: number }>([
        { $match: { status: "ACTIVE" } },
        { $group: { _id: "$schoolYear", total: { $sum: "$expectedAmount" } } },
      ]).session(session ?? null),
      // Affectations par année de l'ENGAGEMENT (et non du mouvement).
      Payment.aggregate<{ _id: Types.ObjectId; total: number }>([
        { $match: { status: "VALID" } },
        { $unwind: "$lines" },
        { $match: { "lines.kind": "COMMITMENT" } },
        { $group: { _id: "$lines.commitmentYear", total: { $sum: "$lines.amount" } } },
      ]).session(session ?? null),
      CreditApplication.aggregate<{ _id: Types.ObjectId; total: number }>([
        { $match: { status: "VALID" } },
        { $group: { _id: "$schoolYear", total: { $sum: "$amount" } } },
      ]).session(session ?? null),
      CreditApplication.aggregate<{ _id: null; total: number }>([
        { $match: { status: "VALID" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]).session(session ?? null),
    ]);

  const lines = new Map<Key, { contributions: number; late: number; donations: number; advances: number }>();
  for (const row of lineTotals) {
    const entry = lines.get(key(row._id.year)) ?? { contributions: 0, late: 0, donations: 0, advances: 0 };
    if (row._id.kind === "COMMITMENT") {
      entry.contributions += row.total;
      if (row._id.late) entry.late += row.total;
    } else if (row._id.kind === "DONATION") entry.donations += row.total;
    else if (row._id.kind === "ADVANCE") entry.advances += row.total;
    lines.set(key(row._id.year), entry);
  }
  const toMap = (rows: Array<{ _id: Types.ObjectId | null; total: number }>) => new Map(rows.map((r) => [key(r._id), r.total]));
  const expenses = toMap(expenseTotals);
  const expected = toMap(commitmentTotals);
  const allocatedLines = toMap(allocatedByLines);
  const allocatedCredits = toMap(allocatedByCredits);

  const totalAdvances = [...lines.values()].reduce((sum, entry) => sum + entry.advances, 0);
  const advancesAvailable = totalAdvances - (advanceBalance[0]?.total ?? 0);

  const result: YearTreasury[] = [];
  let previousClosing = 0;
  years.forEach((year, index) => {
    const id = key(year._id);
    const isFirstYear = index === 0;
    const commitmentsNow = {
      expected: expected.get(id) ?? 0,
      allocated: (allocatedLines.get(id) ?? 0) + (allocatedCredits.get(id) ?? 0),
    };

    let figures: YearTreasuryFigures;
    let source: YearTreasury["source"];
    if (year.status === "CLOSED" && year.closing) {
      const c = year.closing;
      figures = {
        openingBalance: c.openingBalance,
        contributions: c.contributions,
        lateContributions: c.lateContributions,
        donations: c.donations,
        advances: c.advances,
        expenses: c.expenses,
        closingBalance: c.closingBalance,
      };
      source = "snapshot";
    } else {
      const entry = lines.get(id) ?? { contributions: 0, late: 0, donations: 0, advances: 0 };
      const openingBalance = isFirstYear ? (cashOpening?.amount ?? 0) : previousClosing;
      const treasury = {
        openingBalance,
        contributions: entry.contributions,
        donations: entry.donations,
        advances: entry.advances,
        expenses: expenses.get(id) ?? 0,
      };
      figures = { ...treasury, lateContributions: entry.late, closingBalance: computeClosingBalance(treasury) };
      source = "live";
    }
    previousClosing = figures.closingBalance;

    result.push({
      yearId: id,
      label: year.label,
      status: year.status,
      startDate: year.startDate,
      endDate: year.endDate,
      source,
      figures,
      commitmentsNow,
      commitmentsAtClosing:
        year.status === "CLOSED" && year.closing
          ? { expected: year.closing.commitmentsExpected, allocated: year.closing.commitmentsAllocatedAtClosing }
          : null,
      isFirstYear,
    });
  });

  return {
    years: result,
    cashOpening: cashOpening ? { yearId: key(cashOpening.schoolYear), amount: cashOpening.amount } : null,
    advancesAvailable,
    currentBalance: result.at(-1)?.figures.closingBalance ?? cashOpening?.amount ?? 0,
  };
}
