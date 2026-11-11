import "server-only";

import { Types } from "mongoose";

import { Child } from "@/features/children/model";
import { allocatedByCommitment } from "@/features/commitments/allocations";
import { Commitment } from "@/features/commitments/model";
import { SchoolYear } from "@/features/school-years/model";
import { Sponsor } from "@/features/sponsors/model";
import { connectDB } from "@/lib/db/mongoose";
import { fullName } from "@/lib/text";

import { computeCommitmentFigures, type CommitmentFigures } from "./types";

/** Engagement avec sa situation calculée (attendu / affecté / restant / état). */
export type CommitmentView = CommitmentFigures & {
  id: string;
  sponsorshipId: string;
  status: "ACTIVE" | "CANCELLED";
  year: { id: string; label: string; status: string; startDate: string };
  sponsor: { id: string; code: string; name: string };
  child: { id: string; code: string; name: string };
  notes: string | null;
  cancelReason: string | null;
  adjustments: Array<{ from: number; to: number; reason: string; at: string }>;
};

export type CommitmentFilters = {
  yearId?: string | null;
  sponsorId?: string | null;
  childId?: string | null;
  /** Inclure les engagements annulés (fiches) ; exclus des totaux. */
  includeCancelled?: boolean;
};

/** Engagements filtrés avec leur situation : 5 requêtes, quel que soit le nombre d'engagements. */
export async function listCommitments(filters: CommitmentFilters): Promise<CommitmentView[]> {
  await connectDB();
  const query: Record<string, unknown> = {};
  const oid = (value?: string | null) => (value && Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null);
  if (oid(filters.yearId)) query.schoolYear = oid(filters.yearId);
  if (oid(filters.sponsorId)) query.sponsor = oid(filters.sponsorId);
  if (oid(filters.childId)) query.child = oid(filters.childId);
  if (!filters.includeCancelled) query.status = "ACTIVE";

  const commitments = await Commitment.find(query).lean();
  if (commitments.length === 0) return [];
  const [allocated, sponsors, children, years] = await Promise.all([
    allocatedByCommitment(commitments.map((c) => c._id)),
    Sponsor.find({ _id: { $in: commitments.map((c) => c.sponsor) } }, { code: 1, displayName: 1 }).lean(),
    Child.find({ _id: { $in: commitments.map((c) => c.child) } }, { code: 1, firstName: 1, lastName: 1 }).lean(),
    SchoolYear.find({ _id: { $in: commitments.map((c) => c.schoolYear) } }, { label: 1, status: 1, startDate: 1 }).lean(),
  ]);
  const sponsorMap = new Map(sponsors.map((s) => [s._id.toString(), s]));
  const childMap = new Map(children.map((c) => [c._id.toString(), c]));
  const yearMap = new Map(years.map((y) => [y._id.toString(), y]));

  return commitments
    .map<CommitmentView>((c) => {
      const sponsor = sponsorMap.get(c.sponsor.toString());
      const child = childMap.get(c.child.toString());
      const year = yearMap.get(c.schoolYear.toString());
      return {
        ...computeCommitmentFigures(c.committedAmount, c.expectedAmount, allocated.get(c._id.toString()) ?? 0),
        id: c._id.toString(),
        sponsorshipId: c.sponsorship.toString(),
        status: c.status,
        year: { id: c.schoolYear.toString(), label: year?.label ?? "—", status: year?.status ?? "DRAFT", startDate: year?.startDate.toISOString() ?? "" },
        sponsor: { id: c.sponsor.toString(), code: sponsor?.code ?? "—", name: sponsor?.displayName ?? "—" },
        child: { id: c.child.toString(), code: child?.code ?? "—", name: child ? fullName(child) : "—" },
        notes: c.notes ?? null,
        cancelReason: c.cancelReason ?? null,
        adjustments: c.expectedAdjustments.map((a) => ({ from: a.from, to: a.to, reason: a.reason, at: a.at.toISOString() })),
      };
    })
    .sort((a, b) => b.year.startDate.localeCompare(a.year.startDate) || a.child.name.localeCompare(b.child.name, "fr"));
}

export type CommitmentTotals = { committed: number; expected: number; received: number; remaining: number; count: number };

export function totalsOf(views: readonly CommitmentView[]): CommitmentTotals {
  return views
    .filter((v) => v.status === "ACTIVE")
    .reduce<CommitmentTotals>(
      (sum, v) => ({
        committed: sum.committed + v.committed,
        expected: sum.expected + v.expected,
        received: sum.received + v.received,
        remaining: sum.remaining + v.remaining,
        count: sum.count + 1,
      }),
      { committed: 0, expected: 0, received: 0, remaining: 0, count: 0 },
    );
}
