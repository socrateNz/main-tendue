import "server-only";

import { Types } from "mongoose";

import { AuditLog } from "@/features/audit/model";
import { Child } from "@/features/children/model";
import { SchoolYear } from "@/features/school-years/model";
import { Sponsor } from "@/features/sponsors/model";
import { Sponsorship } from "@/features/sponsorships/model";
import { signedImageUrl, type StoredAsset } from "@/lib/cloudinary";
import { connectDB } from "@/lib/db/mongoose";
import { searchFilter, toPaginated, type ListParams, type Paginated } from "@/lib/db/pagination";
import { fullName, normalizeSearch } from "@/lib/text";

import type { SponsorKind, SponsorStatus } from "./types";

export const SPONSOR_SORTS = ["name", "code", "country", "createdAt"] as const;
export type SponsorSort = (typeof SPONSOR_SORTS)[number];
const SORT_FIELDS: Record<SponsorSort, string> = { name: "sortName", code: "code", country: "address.country", createdAt: "createdAt" };

export type SponsorFilters = { status: SponsorStatus | "ALL"; kind: SponsorKind | null; country: string | null };

export type SponsorListItem = {
  id: string;
  code: string;
  name: string;
  kind: SponsorKind;
  email: string | null;
  phone: string | null;
  country: string | null;
  city: string | null;
  status: SponsorStatus;
  photoUrl: string | null;
  /** Parrainages actifs sur l'année active. */
  activeSponsorships: number;
};

export async function listSponsors(
  params: ListParams<SponsorSort>,
  filters: SponsorFilters,
): Promise<Paginated<SponsorListItem> & { activeYearLabel: string | null }> {
  await connectDB();
  const query: Record<string, unknown> = {};
  if (filters.status !== "ALL") query.status = filters.status;
  if (filters.kind) query.kind = filters.kind;
  if (filters.country) query["address.country"] = filters.country;
  Object.assign(query, searchFilter(params.q, "searchText", normalizeSearch));

  const direction = params.dir === "desc" ? -1 : 1;
  const [sponsors, total, activeYear] = await Promise.all([
    Sponsor.find(query, { code: 1, displayName: 1, kind: 1, email: 1, phone: 1, address: 1, status: 1, photo: 1 })
      .sort({ [SORT_FIELDS[params.sort]]: direction, _id: 1 })
      .skip((params.page - 1) * params.pageSize)
      .limit(params.pageSize)
      .lean(),
    Sponsor.countDocuments(query),
    SchoolYear.findOne({ status: "ACTIVE" }, { label: 1 }).lean(),
  ]);
  const counts = activeYear
    ? await Sponsorship.aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { schoolYear: activeYear._id, status: "ACTIVE", sponsor: { $in: sponsors.map((s) => s._id) } } },
        { $group: { _id: "$sponsor", count: { $sum: 1 } } },
      ])
    : [];
  const byId = new Map(counts.map((c) => [c._id.toString(), c.count]));

  const items = sponsors.map<SponsorListItem>((sponsor) => ({
    id: sponsor._id.toString(),
    code: sponsor.code,
    name: sponsor.displayName,
    kind: sponsor.kind,
    email: sponsor.email ?? null,
    phone: sponsor.phone ?? null,
    country: sponsor.address?.country ?? null,
    city: sponsor.address?.city ?? null,
    status: sponsor.status,
    photoUrl: sponsor.photo ? signedImageUrl(sponsor.photo as StoredAsset, { width: 80, height: 80 }) : null,
    activeSponsorships: byId.get(sponsor._id.toString()) ?? 0,
  }));
  return { ...toPaginated(items, total, params), activeYearLabel: activeYear?.label ?? null };
}

export type SponsorDetail = {
  id: string;
  code: string;
  kind: SponsorKind;
  name: string;
  firstName: string | null;
  lastName: string | null;
  organizationName: string | null;
  email: string | null;
  phone: string | null;
  secondaryPhone: string | null;
  address: { line1: string | null; line2: string | null; postalCode: string | null; city: string | null; country: string | null };
  notes: string | null;
  status: SponsorStatus;
  statusReason: string | null;
  statusChangedAt: string | null;
  photoUrl: string | null;
  createdAt: string;
  history: Array<{ id: string; at: string; actor: string; summary: string }>;
};

export async function getSponsorDetail(sponsorId: string): Promise<SponsorDetail | null> {
  if (!Types.ObjectId.isValid(sponsorId)) return null;
  await connectDB();
  const id = new Types.ObjectId(sponsorId);
  const sponsorshipIds = (await Sponsorship.find({ sponsor: id }, { _id: 1 }).lean()).map((s) => s._id);
  const [sponsor, history] = await Promise.all([
    Sponsor.findById(id).lean(),
    AuditLog.find({ $or: [{ entityType: "Sponsor", entityId: id }, { entityType: "Sponsorship", entityId: { $in: sponsorshipIds } }] })
      .sort({ at: -1 })
      .limit(40)
      .lean(),
  ]);
  if (!sponsor) return null;
  return {
    id: sponsorId,
    code: sponsor.code,
    kind: sponsor.kind,
    name: sponsor.displayName,
    firstName: sponsor.firstName ?? null,
    lastName: sponsor.lastName ?? null,
    organizationName: sponsor.organizationName ?? null,
    email: sponsor.email ?? null,
    phone: sponsor.phone ?? null,
    secondaryPhone: sponsor.secondaryPhone ?? null,
    address: {
      line1: sponsor.address?.line1 ?? null,
      line2: sponsor.address?.line2 ?? null,
      postalCode: sponsor.address?.postalCode ?? null,
      city: sponsor.address?.city ?? null,
      country: sponsor.address?.country ?? null,
    },
    notes: sponsor.notes ?? null,
    status: sponsor.status,
    statusReason: sponsor.statusReason ?? null,
    statusChangedAt: sponsor.statusChangedAt?.toISOString() ?? null,
    photoUrl: sponsor.photo ? signedImageUrl(sponsor.photo as StoredAsset, { width: 640, height: 640 }) : null,
    createdAt: sponsor.createdAt.toISOString(),
    history: history.map((log) => ({ id: log._id.toString(), at: log.at.toISOString(), actor: log.actorLabel, summary: log.summary })),
  };
}

/* ------------------------------------------------------------------ Sélecteurs */

export type PickerOption = { id: string; label: string; description: string };

/** Recherche de sponsors ACTIFS pour un sélecteur (10 résultats max). */
export async function searchSponsorOptions(q: string): Promise<PickerOption[]> {
  await connectDB();
  const filter: Record<string, unknown> = { status: "ACTIVE" };
  Object.assign(filter, searchFilter(q, "searchText", normalizeSearch));
  const sponsors = await Sponsor.find(filter, { code: 1, displayName: 1, email: 1, address: 1 }).sort({ sortName: 1 }).limit(10).lean();
  return sponsors.map((s) => ({
    id: s._id.toString(),
    label: s.displayName,
    description: [s.code, s.email, s.address?.city].filter(Boolean).join(" · "),
  }));
}

/** Recherche d'enfants ACTIFS pour un sélecteur (10 résultats max). */
export async function searchChildOptions(q: string): Promise<PickerOption[]> {
  await connectDB();
  const filter: Record<string, unknown> = { status: "ACTIVE" };
  Object.assign(filter, searchFilter(q, "searchText", normalizeSearch));
  const children = await Child.find(filter, { code: 1, firstName: 1, lastName: 1, birthDate: 1 }).sort({ lastName: 1, firstName: 1 }).limit(10).lean();
  return children.map((c) => ({
    id: c._id.toString(),
    label: fullName(c),
    description: `${c.code} · né(e) en ${c.birthDate.getUTCFullYear()}`,
  }));
}

/** Pays effectivement présents parmi les sponsors (filtre de liste). */
export async function getSponsorCountries(): Promise<string[]> {
  await connectDB();
  const codes = await Sponsor.distinct("address.country");
  return codes.filter((code): code is string => typeof code === "string" && code.length === 2);
}
