import "server-only";

import { Types } from "mongoose";

import { Child, Enrollment, School } from "@/features/children/model";
import { listCommitments } from "@/features/commitments/queries";
import { SETTLEMENT_STATE_LABELS } from "@/features/commitments/types";
import { Payment } from "@/features/contributions/model";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/features/contributions/types";
import { Expense, ExpenseCategory } from "@/features/expenses/model";
import { SchoolYear } from "@/features/school-years/model";
import { computeTreasuryOverview } from "@/features/school-years/treasury";
import { SCHOOL_YEAR_STATUS_LABELS } from "@/features/school-years/types";
import { Sponsor } from "@/features/sponsors/model";
import { Sponsorship } from "@/features/sponsorships/model";
import { listVideos } from "@/features/videos/queries";
import { VIDEO_STATUS_LABELS } from "@/features/videos/types";
import { countryName } from "@/lib/countries";
import { connectDB } from "@/lib/db/mongoose";
import { formatShortDate } from "@/lib/dates";
import { coverageRate, formatXaf } from "@/lib/money";
import { fullName } from "@/lib/text";

import type { Report, ReportRow, ReportType } from "./types";

/**
 * Rapports : uniquement des données réelles, mêmes règles que la caisse (mouvements annulés exclus,
 * dépenses comptées une fois, avances comptées à l'encaissement).
 */

const sum = (rows: ReportRow[], key: string) => rows.reduce((total, row) => total + (typeof row[key] === "number" ? (row[key] as number) : 0), 0);
const oid = (id: string) => new Types.ObjectId(id);

async function financial(): Promise<Report> {
  const overview = await computeTreasuryOverview();
  const rows = overview.years.map<ReportRow>((y) => ({
    year: y.label,
    status: SCHOOL_YEAR_STATUS_LABELS[y.status] + (y.source === "snapshot" ? " (instantané)" : ""),
    opening: y.figures.openingBalance,
    contributions: y.figures.contributions,
    late: y.figures.lateContributions,
    donations: y.figures.donations,
    advances: y.figures.advances,
    expenses: y.figures.expenses,
    closing: y.figures.closingBalance,
  }));
  return {
    title: "Rapport financier par année",
    description: "Trésorerie de la caisse centrale : solde d'ouverture, encaissements, dépenses et solde de clôture (cumulé d'une année à l'autre).",
    columns: [
      { key: "year", label: "Année", kind: "text" },
      { key: "status", label: "Statut", kind: "text" },
      { key: "opening", label: "Ouverture", kind: "money" },
      { key: "contributions", label: "Contributions", kind: "money" },
      { key: "late", label: "dont tardives", kind: "money" },
      { key: "donations", label: "Dons", kind: "money" },
      { key: "advances", label: "Avances", kind: "money" },
      { key: "expenses", label: "Dépenses", kind: "money" },
      { key: "closing", label: "Clôture", kind: "money" },
    ],
    rows,
    totals: { year: "Total", contributions: sum(rows, "contributions"), late: sum(rows, "late"), donations: sum(rows, "donations"), advances: sum(rows, "advances"), expenses: sum(rows, "expenses"), closing: overview.currentBalance },
    notes: [
      `Solde de caisse actuel : ${formatXaf(overview.currentBalance)}.`,
      `Crédit d'avances encaissé et non encore affecté : ${formatXaf(Math.max(0, overview.advancesAvailable))}.`,
      "Les affectations d'avances ne sont pas des recettes : elles n'apparaissent que dans la situation des engagements.",
    ],
  };
}

async function commitments(yearId: string): Promise<Report> {
  const views = await listCommitments({ yearId });
  const rows = views.map<ReportRow>((c) => ({
    sponsor: c.sponsor.name,
    child: c.child.name,
    committed: c.committed,
    expected: c.expected,
    received: c.received,
    remaining: c.remaining,
    coverage: coverageRate(c.received, c.expected),
    state: SETTLEMENT_STATE_LABELS[c.state],
  }));
  return {
    title: "Situation des engagements",
    description: "Montant engagé, attendu, reçu (versements et avances affectées, arriérés inclus) et reste à recevoir.",
    columns: [
      { key: "sponsor", label: "Sponsor", kind: "text" },
      { key: "child", label: "Enfant", kind: "text" },
      { key: "committed", label: "Engagé", kind: "money" },
      { key: "expected", label: "Attendu", kind: "money" },
      { key: "received", label: "Reçu", kind: "money" },
      { key: "remaining", label: "Restant", kind: "money" },
      { key: "coverage", label: "Couverture", kind: "percent" },
      { key: "state", label: "État", kind: "text" },
    ],
    rows,
    totals: {
      sponsor: `${rows.length} engagement(s)`,
      committed: sum(rows, "committed"),
      expected: sum(rows, "expected"),
      received: sum(rows, "received"),
      remaining: sum(rows, "remaining"),
      coverage: coverageRate(sum(rows, "received"), sum(rows, "expected")),
    },
  };
}

async function contributions(yearId: string): Promise<Report> {
  const match = { schoolYear: oid(yearId), status: "VALID" };
  const [byMonth, byMethod] = await Promise.all([
    Payment.aggregate<{ _id: { month: string; kind: string; late: boolean }; total: number; count: number }>([
      { $match: match },
      { $unwind: "$lines" },
      { $group: { _id: { month: { $dateToString: { format: "%Y-%m", date: "$receivedAt" } }, kind: "$lines.kind", late: { $ifNull: ["$lines.lateSettlement", false] } }, total: { $sum: "$lines.amount" }, count: { $sum: 1 } } },
    ]),
    Payment.aggregate<{ _id: PaymentMethod; total: number; count: number }>([{ $match: match }, { $group: { _id: "$method", total: { $sum: "$amountXaf" }, count: { $sum: 1 } } }]),
  ]);
  const months = [...new Set(byMonth.map((r) => r._id.month))].sort();
  const rows = months.map<ReportRow>((month) => {
    const of = (kind: string, late?: boolean) =>
      byMonth.filter((r) => r._id.month === month && r._id.kind === kind && (late === undefined || r._id.late === late)).reduce((s, r) => s + r.total, 0);
    const [y, m] = month.split("-");
    const label = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(Number(y), Number(m) - 1, 1)));
    const contributionsAmount = of("COMMITMENT");
    return { month: label, contributions: contributionsAmount, late: of("COMMITMENT", true), donations: of("DONATION"), advances: of("ADVANCE"), total: contributionsAmount + of("DONATION") + of("ADVANCE") };
  });
  return {
    title: "Contributions encaissées",
    description: "Versements valides de l'année, par mois de réception et par nature.",
    columns: [
      { key: "month", label: "Mois", kind: "text" },
      { key: "contributions", label: "Contributions", kind: "money" },
      { key: "late", label: "dont tardives", kind: "money" },
      { key: "donations", label: "Dons", kind: "money" },
      { key: "advances", label: "Avances", kind: "money" },
      { key: "total", label: "Total encaissé", kind: "money" },
    ],
    rows,
    totals: { month: "Total", contributions: sum(rows, "contributions"), late: sum(rows, "late"), donations: sum(rows, "donations"), advances: sum(rows, "advances"), total: sum(rows, "total") },
    notes: byMethod.sort((a, b) => b.total - a.total).map((m) => `${PAYMENT_METHOD_LABELS[m._id]} : ${formatXaf(m.total)} (${m.count} versement${m.count > 1 ? "s" : ""}).`),
  };
}

async function expenses(yearId: string): Promise<Report> {
  const totals = await Expense.aggregate<{ _id: Types.ObjectId; total: number; count: number }>([
    { $match: { schoolYear: oid(yearId), status: "VALID" } },
    { $group: { _id: "$category", total: { $sum: "$amount" }, count: { $sum: 1 } } },
  ]);
  const categories = await ExpenseCategory.find({ _id: { $in: totals.map((t) => t._id) } }, { name: 1 }).lean();
  const name = new Map(categories.map((c) => [c._id.toString(), c.name]));
  const grand = totals.reduce((s, t) => s + t.total, 0);
  const rows = totals
    .sort((a, b) => b.total - a.total)
    .map<ReportRow>((t) => ({ category: name.get(t._id.toString()) ?? "—", count: t.count, amount: t.total, share: grand ? Math.round((t.total * 100) / grand) : 0 }));
  return {
    title: "Dépenses par catégorie",
    description: "Dépenses valides de l'année. Une dépense collective est comptée une seule fois.",
    columns: [
      { key: "category", label: "Catégorie", kind: "text" },
      { key: "count", label: "Nombre", kind: "number" },
      { key: "amount", label: "Montant", kind: "money" },
      { key: "share", label: "Part", kind: "percent" },
    ],
    rows,
    totals: { category: "Total", count: sum(rows, "count"), amount: grand, share: grand ? 100 : 0 },
  };
}

async function sponsorsReport(yearId: string): Promise<Report> {
  const [views, payments] = await Promise.all([
    listCommitments({ yearId }),
    Payment.aggregate<{ _id: { sponsor: Types.ObjectId; kind: string }; total: number }>([
      { $match: { schoolYear: oid(yearId), status: "VALID" } },
      { $unwind: "$lines" },
      { $match: { "lines.kind": { $in: ["DONATION", "ADVANCE"] } } },
      { $group: { _id: { sponsor: "$sponsor", kind: "$lines.kind" }, total: { $sum: "$lines.amount" } } },
    ]),
  ]);
  const ids = [...new Set([...views.map((v) => v.sponsor.id), ...payments.map((p) => p._id.sponsor.toString())])];
  const sponsors = await Sponsor.find({ _id: { $in: ids.map(oid) } }, { displayName: 1, address: 1 }).lean();
  const rows = sponsors
    .map<ReportRow>((s) => {
      const own = views.filter((v) => v.sponsor.id === s._id.toString());
      const extra = (kind: string) => payments.filter((p) => p._id.sponsor.equals(s._id) && p._id.kind === kind).reduce((t, p) => t + p.total, 0);
      return {
        sponsor: s.displayName,
        country: countryName(s.address?.country),
        children: new Set(own.map((v) => v.child.id)).size,
        expected: own.reduce((t, v) => t + v.expected, 0),
        received: own.reduce((t, v) => t + v.received, 0),
        remaining: own.reduce((t, v) => t + v.remaining, 0),
        donations: extra("DONATION"),
        advances: extra("ADVANCE"),
      };
    })
    .sort((a, b) => String(a.sponsor).localeCompare(String(b.sponsor), "fr"));
  return {
    title: "Rapport par sponsor",
    description: "Engagements de l'année par sponsor, avec les dons et avances versés pendant l'année.",
    columns: [
      { key: "sponsor", label: "Sponsor", kind: "text" },
      { key: "country", label: "Pays", kind: "text" },
      { key: "children", label: "Enfants", kind: "number" },
      { key: "expected", label: "Attendu", kind: "money" },
      { key: "received", label: "Reçu", kind: "money" },
      { key: "remaining", label: "Restant", kind: "money" },
      { key: "donations", label: "Dons", kind: "money" },
      { key: "advances", label: "Avances", kind: "money" },
    ],
    rows,
    totals: { sponsor: `${rows.length} sponsor(s)`, expected: sum(rows, "expected"), received: sum(rows, "received"), remaining: sum(rows, "remaining"), donations: sum(rows, "donations"), advances: sum(rows, "advances") },
  };
}

async function childrenReport(yearId: string): Promise<Report> {
  const year = oid(yearId);
  const [views, enrollments, sponsorships, expenseShares] = await Promise.all([
    listCommitments({ yearId }),
    Enrollment.find({ schoolYear: year }, { child: 1, school: 1, className: 1 }).populate<{ school: { name: string } }>("school", "name").lean(),
    Sponsorship.aggregate<{ _id: Types.ObjectId; count: number }>([{ $match: { schoolYear: year, status: { $ne: "CANCELLED" } } }, { $group: { _id: "$child", count: { $sum: 1 } } }]),
    Expense.aggregate<{ _id: Types.ObjectId; total: number }>([
      { $match: { schoolYear: year, status: "VALID" } },
      { $unwind: "$allocations" },
      { $group: { _id: "$allocations.child", total: { $sum: "$allocations.amount" } } },
    ]),
  ]);
  const ids = [...new Set([...views.map((v) => v.child.id), ...enrollments.map((e) => e.child.toString()), ...sponsorships.map((s) => s._id.toString())])];
  const children = await Child.find({ _id: { $in: ids.map(oid) } }, { firstName: 1, lastName: 1, code: 1 }).lean();
  const enrollmentOf = new Map(enrollments.map((e) => [e.child.toString(), e]));
  const sponsorCount = new Map(sponsorships.map((s) => [s._id.toString(), s.count]));
  const shareOf = new Map(expenseShares.map((e) => [e._id.toString(), e.total]));
  const rows = children
    .map<ReportRow>((c) => {
      const id = c._id.toString();
      const own = views.filter((v) => v.child.id === id);
      const enrollment = enrollmentOf.get(id);
      return {
        child: fullName(c),
        code: c.code,
        school: enrollment?.school?.name ?? "—",
        className: enrollment?.className ?? "—",
        sponsors: sponsorCount.get(id) ?? 0,
        expected: own.reduce((t, v) => t + v.expected, 0),
        received: own.reduce((t, v) => t + v.received, 0),
        remaining: own.reduce((t, v) => t + v.remaining, 0),
        expenses: shareOf.get(id) ?? 0,
      };
    })
    .sort((a, b) => String(a.child).localeCompare(String(b.child), "fr"));
  return {
    title: "Rapport par enfant",
    description: "Scolarité, sponsors, engagements et part des dépenses de chaque enfant pour l'année.",
    columns: [
      { key: "child", label: "Enfant", kind: "text" },
      { key: "code", label: "Code", kind: "text" },
      { key: "school", label: "Établissement", kind: "text" },
      { key: "className", label: "Classe", kind: "text" },
      { key: "sponsors", label: "Sponsors", kind: "number" },
      { key: "expected", label: "Attendu", kind: "money" },
      { key: "received", label: "Reçu", kind: "money" },
      { key: "remaining", label: "Restant", kind: "money" },
      { key: "expenses", label: "Dépenses (part)", kind: "money" },
    ],
    rows,
    totals: { child: `${rows.length} enfant(s)`, expected: sum(rows, "expected"), received: sum(rows, "received"), remaining: sum(rows, "remaining"), expenses: sum(rows, "expenses") },
    notes: ["La part des dépenses collectives est indicative : le total des dépenses de l'année figure dans le rapport « Dépenses »."],
  };
}

async function schoolsReport(yearId: string, withFinance: boolean): Promise<Report> {
  const year = oid(yearId);
  const enrollments = await Enrollment.find({ schoolYear: year }, { child: 1, school: 1 }).lean();
  const [schools, sponsored, views, shares] = await Promise.all([
    School.find({ _id: { $in: enrollments.map((e) => e.school) } }, { name: 1, city: 1 }).lean(),
    Sponsorship.distinct("child", { schoolYear: year, status: { $ne: "CANCELLED" } }),
    withFinance ? listCommitments({ yearId }) : Promise.resolve([]),
    withFinance
      ? Expense.aggregate<{ _id: Types.ObjectId; total: number }>([
          { $match: { schoolYear: year, status: "VALID" } },
          { $unwind: "$allocations" },
          { $group: { _id: "$allocations.child", total: { $sum: "$allocations.amount" } } },
        ])
      : Promise.resolve([]),
  ]);
  const sponsoredSet = new Set(sponsored.map((id: Types.ObjectId) => id.toString()));
  const share = new Map(shares.map((s) => [s._id.toString(), s.total]));
  const rows = schools
    .map<ReportRow>((school) => {
      const kids = enrollments.filter((e) => e.school.equals(school._id)).map((e) => e.child.toString());
      const own = views.filter((v) => kids.includes(v.child.id));
      return {
        school: school.name,
        city: school.city ?? "—",
        enrolled: kids.length,
        sponsored: kids.filter((k) => sponsoredSet.has(k)).length,
        ...(withFinance ? { received: own.reduce((t, v) => t + v.received, 0), expenses: kids.reduce((t, k) => t + (share.get(k) ?? 0), 0) } : {}),
      };
    })
    .sort((a, b) => Number(b.enrolled) - Number(a.enrolled));
  return {
    title: "Rapport par établissement",
    description: "Enfants inscrits et parrainés par établissement pour l'année" + (withFinance ? ", avec les montants reçus et les dépenses qui les concernent." : "."),
    columns: [
      { key: "school", label: "Établissement", kind: "text" },
      { key: "city", label: "Ville", kind: "text" },
      { key: "enrolled", label: "Inscrits", kind: "number" },
      { key: "sponsored", label: "Parrainés", kind: "number" },
      ...(withFinance
        ? ([
            { key: "received", label: "Reçu (engagements)", kind: "money" },
            { key: "expenses", label: "Dépenses (parts)", kind: "money" },
          ] as const)
        : []),
    ],
    rows,
    totals: { school: "Total", enrolled: sum(rows, "enrolled"), sponsored: sum(rows, "sponsored"), ...(withFinance ? { received: sum(rows, "received"), expenses: sum(rows, "expenses") } : {}) },
  };
}

async function videosReport(yearId: string): Promise<Report> {
  const videos = await listVideos({ yearId, status: null });
  const rows = videos.map<ReportRow>((v) => ({
    title: v.title,
    child: v.child.name,
    status: VIDEO_STATUS_LABELS[v.status],
    availableAt: v.availableAt ? formatShortDate(v.availableAt) : "—",
    expiresAt: v.expiresAt ? formatShortDate(v.expiresAt) : "—",
    links: v.activeLinks,
    views: v.views,
    downloads: v.downloads,
  }));
  const count = (status: string) => videos.filter((v) => v.status === status).length;
  return {
    title: "Vidéos distribuées et expirées",
    description: "Vidéos de l'année, liens actifs, consultations et téléchargements par les sponsors.",
    columns: [
      { key: "title", label: "Vidéo", kind: "text" },
      { key: "child", label: "Enfant", kind: "text" },
      { key: "status", label: "Statut", kind: "text" },
      { key: "availableAt", label: "Mise à disposition", kind: "text" },
      { key: "expiresAt", label: "Échéance", kind: "text" },
      { key: "links", label: "Liens actifs", kind: "number" },
      { key: "views", label: "Consultations", kind: "number" },
      { key: "downloads", label: "Téléchargements", kind: "number" },
    ],
    rows,
    totals: { title: `${rows.length} vidéo(s)`, links: sum(rows, "links"), views: sum(rows, "views"), downloads: sum(rows, "downloads") },
    notes: [`Disponibles : ${count("AVAILABLE")} · révoquées : ${count("REVOKED")} · expirées en attente : ${count("PENDING_DELETION")} · supprimées : ${count("DELETED")}.`],
  };
}

/** Construit un rapport ; `yearId` est requis pour les rapports annuels. */
export async function buildReport(type: ReportType, yearId: string | null, options: { withFinance: boolean }): Promise<Report | null> {
  await connectDB();
  if (type === "financier") return financial();
  if (!yearId || !Types.ObjectId.isValid(yearId) || !(await SchoolYear.exists({ _id: yearId }))) return null;
  switch (type) {
    case "engagements":
      return commitments(yearId);
    case "contributions":
      return contributions(yearId);
    case "depenses":
      return expenses(yearId);
    case "sponsors":
      return sponsorsReport(yearId);
    case "enfants":
      return childrenReport(yearId);
    case "etablissements":
      return schoolsReport(yearId, options.withFinance);
    case "videos":
      return videosReport(yearId);
    default:
      return null;
  }
}
