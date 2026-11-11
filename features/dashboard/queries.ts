import "server-only";

import { Types } from "mongoose";

import { AuditLog } from "@/features/audit/model";
import { Child } from "@/features/children/model";
import { listCommitments, totalsOf } from "@/features/commitments/queries";
import { Payment } from "@/features/contributions/model";
import { Expense } from "@/features/expenses/model";
import { computeTreasuryOverview } from "@/features/school-years/treasury";
import { Sponsor } from "@/features/sponsors/model";
import { Sponsorship } from "@/features/sponsorships/model";
import { connectDB } from "@/lib/db/mongoose";
import { coverageRate } from "@/lib/money";

/**
 * Indicateurs du tableau de bord — calculés sur les données réelles de MongoDB, jamais simulés.
 * Les indicateurs financiers suivent les règles de la caisse (mouvements annulés exclus).
 */

export type DashboardData = {
  counts: { children: number; activeSponsors: number; activeSponsorships: number };
  finance: {
    expected: number;
    received: number;
    remaining: number;
    coverage: number;
    contributions: number;
    donations: number;
    advances: number;
    expenses: number;
    yearClosing: number;
    currentBalance: number;
    source: "snapshot" | "live";
  } | null;
  monthlyExpenses: Array<{ month: string; label: string; amount: number }>;
  recentOperations: Array<{ id: string; kind: "payment" | "expense"; href: string; date: string; label: string; amount: number; cancelled: boolean }>;
  recentActivity: Array<{ id: string; at: string; actor: string; summary: string }>;
};

/** Mois de la période de l'année scolaire (« 2026-09 », …), pour un axe continu sans trou. */
function monthsBetween(start: Date, end: Date): string[] {
  const months: string[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor <= end && months.length < 14) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

export async function getDashboard(
  year: { id: string; startDate: string; endDate: string } | null,
  options: { withFinance: boolean; withActivity: boolean },
): Promise<DashboardData> {
  await connectDB();
  const yearId = year ? new Types.ObjectId(year.id) : null;

  const [children, activeSponsors, activeSponsorships] = await Promise.all([
    Child.countDocuments({ status: "ACTIVE" }),
    Sponsor.countDocuments({ status: "ACTIVE" }),
    yearId ? Sponsorship.countDocuments({ schoolYear: yearId, status: "ACTIVE" }) : Promise.resolve(0),
  ]);

  let finance: DashboardData["finance"] = null;
  let monthlyExpenses: DashboardData["monthlyExpenses"] = [];
  let recentOperations: DashboardData["recentOperations"] = [];

  if (options.withFinance && year && yearId) {
    const [overview, commitments, byMonth, payments, expenses] = await Promise.all([
      computeTreasuryOverview(),
      listCommitments({ yearId: year.id }),
      Expense.aggregate<{ _id: string; total: number }>([
        { $match: { schoolYear: yearId, status: "VALID" } },
        { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$spentAt" } }, total: { $sum: "$amount" } } },
      ]),
      Payment.find({ schoolYear: yearId }, { number: 1, receivedAt: 1, amountXaf: 1, sponsor: 1, status: 1 }).sort({ receivedAt: -1, _id: -1 }).limit(6).lean(),
      Expense.find({ schoolYear: yearId }, { number: 1, spentAt: 1, amount: 1, description: 1, status: 1 }).sort({ spentAt: -1, _id: -1 }).limit(6).lean(),
    ]);
    const entry = overview.years.find((y) => y.yearId === year.id);
    const totals = totalsOf(commitments);
    finance = {
      expected: totals.expected,
      received: totals.received,
      remaining: totals.remaining,
      coverage: coverageRate(totals.received, totals.expected),
      contributions: entry?.figures.contributions ?? 0,
      donations: entry?.figures.donations ?? 0,
      advances: entry?.figures.advances ?? 0,
      expenses: entry?.figures.expenses ?? 0,
      yearClosing: entry?.figures.closingBalance ?? 0,
      currentBalance: overview.currentBalance,
      source: entry?.source ?? "live",
    };

    const totalsByMonth = new Map(byMonth.map((m) => [m._id, m.total]));
    const monthLabel = new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" });
    monthlyExpenses = monthsBetween(new Date(year.startDate), new Date(year.endDate)).map((month) => ({
      month,
      label: monthLabel.format(new Date(`${month}-01T00:00:00Z`)).replace(".", ""),
      amount: totalsByMonth.get(month) ?? 0,
    }));

    const sponsorNames = new Map(
      (await Sponsor.find({ _id: { $in: payments.map((p) => p.sponsor) } }, { displayName: 1 }).lean()).map((s) => [s._id.toString(), s.displayName]),
    );
    recentOperations = [
      ...payments.map((p) => ({
        id: p._id.toString(),
        kind: "payment" as const,
        href: `/contributions/${p._id.toString()}`,
        date: p.receivedAt.toISOString(),
        label: `${p.number} · ${sponsorNames.get(p.sponsor.toString()) ?? "Sponsor"}`,
        amount: p.amountXaf,
        cancelled: p.status === "CANCELLED",
      })),
      ...expenses.map((e) => ({
        id: e._id.toString(),
        kind: "expense" as const,
        href: `/depenses/${e._id.toString()}`,
        date: e.spentAt.toISOString(),
        label: `${e.number} · ${e.description}`,
        amount: e.amount,
        cancelled: e.status === "CANCELLED",
      })),
    ]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 8);
  }

  const recentActivity = options.withActivity
    ? (await AuditLog.find({ action: { $not: /^auth\./ } }).sort({ at: -1 }).limit(10).lean()).map((log) => ({
        id: log._id.toString(),
        at: log.at.toISOString(),
        actor: log.actorLabel,
        summary: log.summary,
      }))
    : [];

  return { counts: { children, activeSponsors, activeSponsorships }, finance, monthlyExpenses, recentOperations, recentActivity };
}
