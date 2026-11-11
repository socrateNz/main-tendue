import "server-only";

import { Types } from "mongoose";

import { AuditLog } from "@/features/audit/model";
import { User } from "@/features/auth/model";
import { Child } from "@/features/children/model";
import { allocatedByCommitment } from "@/features/commitments/allocations";
import { Commitment } from "@/features/commitments/model";
import { CreditApplication, Payment } from "@/features/contributions/model";
import { advanceSources } from "@/features/contributions/service";
import { SchoolYear } from "@/features/school-years/model";
import { Sponsor } from "@/features/sponsors/model";
import { signedAssetUrl, type StoredAsset } from "@/lib/cloudinary";
import { connectDB } from "@/lib/db/mongoose";
import { searchFilter, toPaginated, type ListParams, type Paginated } from "@/lib/db/pagination";
import type { CurrencyCode } from "@/lib/money";
import { fullName, normalizeSearch } from "@/lib/text";

import type { MovementStatus, PaymentLineKind, PaymentMethod } from "./types";

/* ------------------------------------------------------------------ Liste */

export const PAYMENT_SORTS = ["receivedAt", "amountXaf", "number"] as const;
export type PaymentSort = (typeof PAYMENT_SORTS)[number];

export type PaymentFilters = { yearId: string | null; status: MovementStatus | "ALL"; method: PaymentMethod | null; sponsorId?: string | null };

export type PaymentListItem = {
  id: string;
  number: string;
  receivedAt: string;
  sponsor: { id: string; name: string };
  method: PaymentMethod;
  reference: string | null;
  amountXaf: number;
  currency: { code: CurrencyCode; originalAmountMinor: number };
  breakdown: { contributions: number; late: number; donation: number; advance: number };
  status: MovementStatus;
  yearLabel: string;
};

function breakdownOf(lines: Array<{ kind: PaymentLineKind; amount: number; lateSettlement?: boolean | null }>) {
  return lines.reduce(
    (sum, line) => ({
      contributions: sum.contributions + (line.kind === "COMMITMENT" ? line.amount : 0),
      late: sum.late + (line.kind === "COMMITMENT" && line.lateSettlement ? line.amount : 0),
      donation: sum.donation + (line.kind === "DONATION" ? line.amount : 0),
      advance: sum.advance + (line.kind === "ADVANCE" ? line.amount : 0),
    }),
    { contributions: 0, late: 0, donation: 0, advance: 0 },
  );
}

export async function listPayments(
  params: ListParams<PaymentSort>,
  filters: PaymentFilters,
): Promise<Paginated<PaymentListItem> & { totals: { amount: number; contributions: number; donation: number; advance: number } }> {
  await connectDB();
  const query: Record<string, unknown> = {};
  if (filters.yearId && Types.ObjectId.isValid(filters.yearId)) query.schoolYear = new Types.ObjectId(filters.yearId);
  if (filters.status !== "ALL") query.status = filters.status;
  if (filters.method) query.method = filters.method;
  if (filters.sponsorId && Types.ObjectId.isValid(filters.sponsorId)) query.sponsor = new Types.ObjectId(filters.sponsorId);
  if (params.q) {
    const sponsorIds = await Sponsor.distinct("_id", searchFilter(params.q, "searchText", normalizeSearch));
    const raw = params.q.trim();
    query.$or = [{ sponsor: { $in: sponsorIds } }, { number: raw.toUpperCase() }, { reference: raw }];
  }
  const direction = params.dir === "asc" ? 1 : -1;
  const [payments, total, sums] = await Promise.all([
    Payment.find(query).sort({ [params.sort]: direction, _id: -1 }).skip((params.page - 1) * params.pageSize).limit(params.pageSize).lean(),
    Payment.countDocuments(query),
    // Totaux de la sélection, hors versements annulés.
    Payment.aggregate<{ _id: string; total: number }>([
      { $match: { ...query, status: "VALID" } },
      { $unwind: "$lines" },
      { $group: { _id: "$lines.kind", total: { $sum: "$lines.amount" } } },
    ]),
  ]);
  const [sponsors, years] = await Promise.all([
    Sponsor.find({ _id: { $in: payments.map((p) => p.sponsor) } }, { displayName: 1 }).lean(),
    SchoolYear.find({ _id: { $in: payments.map((p) => p.schoolYear) } }, { label: 1 }).lean(),
  ]);
  const names = new Map(sponsors.map((s) => [s._id.toString(), s.displayName]));
  const labels = new Map(years.map((y) => [y._id.toString(), y.label]));
  const byKind = new Map(sums.map((row) => [row._id, row.total]));

  const items = payments.map<PaymentListItem>((p) => ({
    id: p._id.toString(),
    number: p.number,
    receivedAt: p.receivedAt.toISOString(),
    sponsor: { id: p.sponsor.toString(), name: names.get(p.sponsor.toString()) ?? "—" },
    method: p.method,
    reference: p.reference ?? null,
    amountXaf: p.amountXaf,
    currency: { code: p.currency.code, originalAmountMinor: p.currency.originalAmountMinor },
    breakdown: breakdownOf(p.lines),
    status: p.status,
    yearLabel: labels.get(p.schoolYear.toString()) ?? "—",
  }));
  const contributions = byKind.get("COMMITMENT") ?? 0;
  const donation = byKind.get("DONATION") ?? 0;
  const advance = byKind.get("ADVANCE") ?? 0;
  return { ...toPaginated(items, total, params), totals: { amount: contributions + donation + advance, contributions, donation, advance } };
}

/* ------------------------------------------------------------------ Détail */

export type PaymentDetail = PaymentListItem & {
  currency: { code: CurrencyCode; originalAmountMinor: number; rate: string; convertedAt: string };
  note: string | null;
  lines: Array<{
    id: string;
    kind: PaymentLineKind;
    amount: number;
    lateSettlement: boolean;
    commitment: { id: string; childId: string; childName: string; yearLabel: string } | null;
    /** Pour une avance : montant déjà affecté et affectations. */
    applied?: number;
    applications?: Array<{ id: string; number: string; amount: number; status: MovementStatus; childName: string; yearLabel: string }>;
  }>;
  attachments: Array<{ name: string; url: string | null; isPdf: boolean }>;
  cancellation: { reason: string; at: string; by: string } | null;
  createdBy: string;
  createdAt: string;
  yearStatus: string;
  history: Array<{ id: string; at: string; actor: string; summary: string }>;
};

export async function getPaymentDetail(paymentId: string): Promise<PaymentDetail | null> {
  if (!Types.ObjectId.isValid(paymentId)) return null;
  await connectDB();
  const payment = await Payment.findById(paymentId).lean();
  if (!payment) return null;

  const commitmentIds = payment.lines.filter((l) => l.commitment).map((l) => l.commitment as Types.ObjectId);
  const applications = await CreditApplication.find({ sourcePayment: payment._id }).lean();
  const allCommitmentIds = [...commitmentIds, ...applications.map((a) => a.commitment)];
  const [sponsor, year, commitments, users, history] = await Promise.all([
    Sponsor.findById(payment.sponsor, { displayName: 1 }).lean(),
    SchoolYear.findById(payment.schoolYear, { label: 1, status: 1 }).lean(),
    Commitment.find({ _id: { $in: allCommitmentIds } }, { child: 1, schoolYear: 1 }).lean(),
    User.find({ _id: { $in: [payment.createdBy, payment.cancellation?.by].filter(Boolean) } }, { firstName: 1, lastName: 1 }).lean(),
    AuditLog.find({ entityType: "Payment", entityId: payment._id }).sort({ at: -1 }).limit(20).lean(),
  ]);
  const [children, years] = await Promise.all([
    Child.find({ _id: { $in: commitments.map((c) => c.child) } }, { firstName: 1, lastName: 1 }).lean(),
    SchoolYear.find({ _id: { $in: commitments.map((c) => c.schoolYear) } }, { label: 1 }).lean(),
  ]);
  const childName = new Map(children.map((c) => [c._id.toString(), fullName(c)]));
  const yearLabel = new Map(years.map((y) => [y._id.toString(), y.label]));
  const commitmentInfo = new Map(
    commitments.map((c) => [
      c._id.toString(),
      { id: c._id.toString(), childId: c.child.toString(), childName: childName.get(c.child.toString()) ?? "—", yearLabel: yearLabel.get(c.schoolYear.toString()) ?? "—" },
    ]),
  );
  const userName = new Map(users.map((u) => [u._id.toString(), fullName(u)]));

  return {
    id: payment._id.toString(),
    number: payment.number,
    receivedAt: payment.receivedAt.toISOString(),
    sponsor: { id: payment.sponsor.toString(), name: sponsor?.displayName ?? "—" },
    method: payment.method,
    reference: payment.reference ?? null,
    amountXaf: payment.amountXaf,
    currency: {
      code: payment.currency.code,
      originalAmountMinor: payment.currency.originalAmountMinor,
      rate: payment.currency.rate,
      convertedAt: payment.currency.convertedAt.toISOString(),
    },
    breakdown: breakdownOf(payment.lines),
    status: payment.status,
    yearLabel: year?.label ?? "—",
    yearStatus: year?.status ?? "DRAFT",
    note: payment.note ?? null,
    lines: payment.lines.map((line) => {
      const own = applications.filter((a) => a.sourceLine.equals(line._id));
      return {
        id: line._id.toString(),
        kind: line.kind,
        amount: line.amount,
        lateSettlement: Boolean(line.lateSettlement),
        commitment: line.commitment ? (commitmentInfo.get(line.commitment.toString()) ?? null) : null,
        ...(line.kind === "ADVANCE"
          ? {
              applied: own.filter((a) => a.status === "VALID").reduce((sum, a) => sum + a.amount, 0),
              applications: own.map((a) => ({
                id: a._id.toString(),
                number: a.number,
                amount: a.amount,
                status: a.status,
                childName: commitmentInfo.get(a.commitment.toString())?.childName ?? "—",
                yearLabel: commitmentInfo.get(a.commitment.toString())?.yearLabel ?? "—",
              })),
            }
          : {}),
      };
    }),
    attachments: payment.attachments.map((asset) => ({
      name: asset.originalFilename ?? "Justificatif",
      url: signedAssetUrl(asset as StoredAsset),
      isPdf: asset.format === "pdf",
    })),
    cancellation: payment.cancellation
      ? { reason: payment.cancellation.reason, at: payment.cancellation.at.toISOString(), by: userName.get(payment.cancellation.by.toString()) ?? "—" }
      : null,
    createdBy: userName.get(payment.createdBy.toString()) ?? "—",
    createdAt: payment.createdAt.toISOString(),
    history: history.map((log) => ({ id: log._id.toString(), at: log.at.toISOString(), actor: log.actorLabel, summary: log.summary })),
  };
}

/* ------------------------------------------------------------------ Saisie */

export type OpenCommitment = {
  id: string;
  childName: string;
  childCode: string;
  yearLabel: string;
  yearStartDate: string;
  yearClosed: boolean;
  expected: number;
  received: number;
  remaining: number;
};

/** Engagements actifs d'un sponsor encore partiellement dus, et son crédit d'avance disponible. */
export async function getSponsorOpenItems(sponsorId: string): Promise<{ commitments: OpenCommitment[]; advanceAvailable: number }> {
  await connectDB();
  const id = new Types.ObjectId(sponsorId);
  const commitments = await Commitment.find({ sponsor: id, status: "ACTIVE" }).lean();
  const [allocated, children, years, sources] = await Promise.all([
    allocatedByCommitment(commitments.map((c) => c._id)),
    Child.find({ _id: { $in: commitments.map((c) => c.child) } }, { firstName: 1, lastName: 1, code: 1 }).lean(),
    SchoolYear.find({ _id: { $in: commitments.map((c) => c.schoolYear) } }, { label: 1, startDate: 1, status: 1 }).lean(),
    advanceSources(id),
  ]);
  const childMap = new Map(children.map((c) => [c._id.toString(), c]));
  const yearMap = new Map(years.map((y) => [y._id.toString(), y]));
  const open = commitments
    .map<OpenCommitment>((c) => {
      const received = allocated.get(c._id.toString()) ?? 0;
      const child = childMap.get(c.child.toString());
      const year = yearMap.get(c.schoolYear.toString());
      return {
        id: c._id.toString(),
        childName: child ? fullName(child) : "—",
        childCode: child?.code ?? "",
        yearLabel: year?.label ?? "—",
        yearStartDate: year?.startDate.toISOString() ?? "",
        yearClosed: year?.status === "CLOSED",
        expected: c.expectedAmount,
        received,
        remaining: Math.max(0, c.expectedAmount - received),
      };
    })
    .filter((c) => c.remaining > 0)
    .sort((a, b) => a.yearStartDate.localeCompare(b.yearStartDate) || a.childName.localeCompare(b.childName, "fr"));
  return { commitments: open, advanceAvailable: sources.reduce((sum, s) => sum + s.available, 0) };
}

/* ------------------------------------------------------------------ Fiches sponsor / enfant */

export type AdvanceRegistry = {
  received: number;
  applied: number;
  available: number;
  sources: Array<{ paymentId: string; paymentNumber: string; receivedAt: string; amount: number; applied: number; available: number }>;
  applications: Array<{ id: string; number: string; amount: number; status: MovementStatus; validatedAt: string; childName: string; yearLabel: string; late: boolean }>;
};

/** Registre des avances d'un sponsor : encaissé, affecté, disponible et historique des affectations. */
export async function getAdvanceRegistry(sponsorId: string): Promise<AdvanceRegistry> {
  await connectDB();
  const id = new Types.ObjectId(sponsorId);
  const [sources, applications] = await Promise.all([advanceSources(id), CreditApplication.find({ sponsor: id }).sort({ validatedAt: -1 }).lean()]);
  const commitments = await Commitment.find({ _id: { $in: applications.map((a) => a.commitment) } }, { child: 1, schoolYear: 1 }).lean();
  const [children, years] = await Promise.all([
    Child.find({ _id: { $in: commitments.map((c) => c.child) } }, { firstName: 1, lastName: 1 }).lean(),
    SchoolYear.find({ _id: { $in: commitments.map((c) => c.schoolYear) } }, { label: 1 }).lean(),
  ]);
  const commitmentMap = new Map(commitments.map((c) => [c._id.toString(), c]));
  const childName = new Map(children.map((c) => [c._id.toString(), fullName(c)]));
  const yearLabel = new Map(years.map((y) => [y._id.toString(), y.label]));
  return {
    received: sources.reduce((sum, s) => sum + s.amount, 0),
    applied: sources.reduce((sum, s) => sum + s.applied, 0),
    available: sources.reduce((sum, s) => sum + s.available, 0),
    sources: sources.map((s) => ({
      paymentId: s.paymentId.toString(),
      paymentNumber: s.paymentNumber,
      receivedAt: s.receivedAt.toISOString(),
      amount: s.amount,
      applied: s.applied,
      available: s.available,
    })),
    applications: applications.map((a) => {
      const commitment = commitmentMap.get(a.commitment.toString());
      return {
        id: a._id.toString(),
        number: a.number,
        amount: a.amount,
        status: a.status,
        validatedAt: a.validatedAt.toISOString(),
        childName: commitment ? (childName.get(commitment.child.toString()) ?? "—") : "—",
        yearLabel: commitment ? (yearLabel.get(commitment.schoolYear.toString()) ?? "—") : "—",
        late: a.lateSettlement,
      };
    }),
  };
}

/** Contributions reçues pour un enfant (lignes de versements et affectations d'avances vers ses engagements). */
export async function listChildContributions(childId: string) {
  await connectDB();
  const commitments = await Commitment.find({ child: new Types.ObjectId(childId) }, { _id: 1, schoolYear: 1, sponsor: 1 }).lean();
  const ids = commitments.map((c) => c._id);
  const [payments, applications] = await Promise.all([
    Payment.find({ "lines.commitment": { $in: ids } }, { number: 1, receivedAt: 1, sponsor: 1, lines: 1, status: 1 }).sort({ receivedAt: -1 }).lean(),
    CreditApplication.find({ commitment: { $in: ids } }).sort({ validatedAt: -1 }).lean(),
  ]);
  const [sponsors, years] = await Promise.all([
    Sponsor.find({ _id: { $in: [...payments.map((p) => p.sponsor), ...applications.map((a) => a.sponsor)] } }, { displayName: 1 }).lean(),
    SchoolYear.find({ _id: { $in: commitments.map((c) => c.schoolYear) } }, { label: 1 }).lean(),
  ]);
  const sponsorName = new Map(sponsors.map((s) => [s._id.toString(), s.displayName]));
  const yearOf = new Map(commitments.map((c) => [c._id.toString(), years.find((y) => y._id.equals(c.schoolYear))?.label ?? "—"]));
  const idSet = new Set(ids.map(String));

  const rows = [
    ...payments.flatMap((p) =>
      p.lines
        .filter((line) => line.commitment && idSet.has(line.commitment.toString()))
        .map((line) => ({
          id: `${p._id.toString()}-${line._id.toString()}`,
          href: `/contributions/${p._id.toString()}`,
          date: p.receivedAt.toISOString(),
          label: `Versement ${p.number}`,
          sponsorName: sponsorName.get(p.sponsor.toString()) ?? "—",
          yearLabel: yearOf.get(line.commitment?.toString() ?? "") ?? "—",
          amount: line.amount,
          late: Boolean(line.lateSettlement),
          cancelled: p.status === "CANCELLED",
        })),
    ),
    ...applications.map((a) => ({
      id: a._id.toString(),
      href: `/contributions/${a.sourcePayment.toString()}`,
      date: a.validatedAt.toISOString(),
      label: `Avance affectée ${a.number}`,
      sponsorName: sponsorName.get(a.sponsor.toString()) ?? "—",
      yearLabel: yearOf.get(a.commitment.toString()) ?? "—",
      amount: a.amount,
      late: a.lateSettlement,
      cancelled: a.status === "CANCELLED",
    })),
  ];
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}
export type ChildContributionRow = Awaited<ReturnType<typeof listChildContributions>>[number];
