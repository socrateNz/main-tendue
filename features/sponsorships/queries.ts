import "server-only";

import { Types } from "mongoose";

import { Child } from "@/features/children/model";
import { Commitment } from "@/features/commitments/model";
import { SchoolYear } from "@/features/school-years/model";
import type { SchoolYearStatus } from "@/features/school-years/types";
import { Sponsor } from "@/features/sponsors/model";
import { Sponsorship } from "@/features/sponsorships/model";
import { signedImageUrl, type StoredAsset } from "@/lib/cloudinary";
import { connectDB } from "@/lib/db/mongoose";
import { searchFilter, toPaginated, type ListParams, type Paginated } from "@/lib/db/pagination";
import { fullName, normalizeSearch } from "@/lib/text";

import type { SponsorshipStatus } from "./types";

/** Parrainage tel qu'affiché (listes, fiches enfant et sponsor). */
export type SponsorshipView = {
  id: string;
  status: SponsorshipStatus;
  startDate: string;
  endDate: string | null;
  endReason: string | null;
  notes: string | null;
  year: { id: string; label: string; status: SchoolYearStatus };
  sponsor: { id: string; code: string; name: string; photoUrl: string | null; status: string };
  child: { id: string; code: string; name: string; photoUrl: string | null; status: string };
  /** Engagement financier rattaché (module Engagements) ; null s'il n'est pas encore défini. */
  commitment: { id: string; committedAmount: number; expectedAmount: number; status: string } | null;
};

type RawSponsorship = {
  _id: Types.ObjectId;
  sponsor: Types.ObjectId;
  child: Types.ObjectId;
  schoolYear: Types.ObjectId;
  status: SponsorshipStatus;
  startDate: Date;
  endDate?: Date | null;
  endReason?: string | null;
  notes?: string | null;
};

/** Résout sponsors, enfants, années et engagements d'un lot de parrainages : 4 requêtes, quelle que soit la taille du lot. */
async function hydrate(rows: RawSponsorship[]): Promise<SponsorshipView[]> {
  if (rows.length === 0) return [];
  const unique = (ids: Types.ObjectId[]) => [...new Set(ids.map(String))].map((id) => new Types.ObjectId(id));
  const [sponsors, children, years, commitments] = await Promise.all([
    Sponsor.find({ _id: { $in: unique(rows.map((r) => r.sponsor)) } }, { code: 1, displayName: 1, photo: 1, status: 1 }).lean(),
    Child.find({ _id: { $in: unique(rows.map((r) => r.child)) } }, { code: 1, firstName: 1, lastName: 1, photo: 1, status: 1 }).lean(),
    SchoolYear.find({ _id: { $in: unique(rows.map((r) => r.schoolYear)) } }, { label: 1, status: 1 }).lean(),
    Commitment.find({ sponsorship: { $in: rows.map((r) => r._id) } }, { sponsorship: 1, committedAmount: 1, expectedAmount: 1, status: 1 }).lean(),
  ]);
  const sponsorMap = new Map(sponsors.map((s) => [s._id.toString(), s]));
  const childMap = new Map(children.map((c) => [c._id.toString(), c]));
  const yearMap = new Map(years.map((y) => [y._id.toString(), y]));
  const commitmentMap = new Map(commitments.map((c) => [c.sponsorship.toString(), c]));
  const photo = (asset: unknown) => (asset ? signedImageUrl(asset as StoredAsset, { width: 80, height: 80 }) : null);

  return rows.map((row) => {
    const sponsor = sponsorMap.get(row.sponsor.toString());
    const child = childMap.get(row.child.toString());
    const year = yearMap.get(row.schoolYear.toString());
    const commitment = commitmentMap.get(row._id.toString());
    return {
      id: row._id.toString(),
      status: row.status,
      startDate: row.startDate.toISOString(),
      endDate: row.endDate?.toISOString() ?? null,
      endReason: row.endReason ?? null,
      notes: row.notes ?? null,
      year: { id: row.schoolYear.toString(), label: year?.label ?? "—", status: year?.status ?? "DRAFT" },
      sponsor: {
        id: row.sponsor.toString(),
        code: sponsor?.code ?? "—",
        name: sponsor?.displayName ?? "Sponsor introuvable",
        photoUrl: photo(sponsor?.photo),
        status: sponsor?.status ?? "ARCHIVED",
      },
      child: {
        id: row.child.toString(),
        code: child?.code ?? "—",
        name: child ? fullName(child) : "Enfant introuvable",
        photoUrl: photo(child?.photo),
        status: child?.status ?? "ARCHIVED",
      },
      commitment: commitment
        ? { id: commitment._id.toString(), committedAmount: commitment.committedAmount, expectedAmount: commitment.expectedAmount, status: commitment.status }
        : null,
    };
  });
}

export const SPONSORSHIP_SORTS = ["startDate", "createdAt"] as const;
export type SponsorshipSort = (typeof SPONSORSHIP_SORTS)[number];

export type SponsorshipFilters = { yearId: string | null; status: SponsorshipStatus | "ALL" };

export async function listSponsorships(params: ListParams<SponsorshipSort>, filters: SponsorshipFilters): Promise<Paginated<SponsorshipView>> {
  await connectDB();
  const query: Record<string, unknown> = {};
  if (filters.yearId && Types.ObjectId.isValid(filters.yearId)) query.schoolYear = new Types.ObjectId(filters.yearId);
  if (filters.status !== "ALL") query.status = filters.status;
  if (params.q) {
    // Recherche sur le sponsor OU l'enfant (nom, code, e-mail…).
    const words = searchFilter(params.q, "searchText", normalizeSearch);
    const [sponsorIds, childIds] = await Promise.all([Sponsor.distinct("_id", words), Child.distinct("_id", words)]);
    query.$or = [{ sponsor: { $in: sponsorIds } }, { child: { $in: childIds } }];
  }
  const direction = params.dir === "asc" ? 1 : -1;
  const [rows, total] = await Promise.all([
    Sponsorship.find(query).sort({ [params.sort]: direction, _id: 1 }).skip((params.page - 1) * params.pageSize).limit(params.pageSize).lean(),
    Sponsorship.countDocuments(query),
  ]);
  return toPaginated(await hydrate(rows), total, params);
}

/** Tous les parrainages d'un enfant ou d'un sponsor, années les plus récentes d'abord. */
export async function listSponsorshipsOf(owner: { childId: string } | { sponsorId: string }): Promise<SponsorshipView[]> {
  await connectDB();
  const filter = "childId" in owner ? { child: new Types.ObjectId(owner.childId) } : { sponsor: new Types.ObjectId(owner.sponsorId) };
  const rows = await Sponsorship.find(filter).lean();
  const views = await hydrate(rows);
  const years = await SchoolYear.find({ _id: { $in: rows.map((r) => r.schoolYear) } }, { startDate: 1 }).lean();
  const start = new Map(years.map((y) => [y._id.toString(), +y.startDate]));
  return views.sort((a, b) => (start.get(b.year.id) ?? 0) - (start.get(a.year.id) ?? 0) || a.startDate.localeCompare(b.startDate));
}
