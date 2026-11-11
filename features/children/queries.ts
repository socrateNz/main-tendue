import "server-only";

import { Types } from "mongoose";

import { AuditLog } from "@/features/audit/model";
import { Child, Enrollment, School } from "@/features/children/model";
import { SchoolYear } from "@/features/school-years/model";
import { Sponsorship } from "@/features/sponsorships/model";
import { signedImageUrl, type StoredAsset } from "@/lib/cloudinary";
import { connectDB } from "@/lib/db/mongoose";
import { escapeRegex, toPaginated, type ListParams, type Paginated } from "@/lib/db/pagination";
import { normalizeSearch } from "@/lib/text";

import type {
  ChildStatus,
  EnrollmentOutcome,
  GuardianRelationship,
  SchoolType,
  Sex,
} from "./types";

/* ------------------------------------------------------------------ Options des formulaires */

export type YearOption = { id: string; label: string; status: string; current: boolean };
export type SchoolOption = { id: string; name: string; city: string | null; active: boolean };

export async function getYearOptions(): Promise<YearOption[]> {
  await connectDB();
  const years = await SchoolYear.find({ archived: false }, { label: 1, status: 1 }).sort({ startDate: -1 }).lean();
  return years.map((year) => ({ id: year._id.toString(), label: year.label, status: year.status, current: year.status === "ACTIVE" }));
}

export async function getSchoolOptions(): Promise<SchoolOption[]> {
  await connectDB();
  const schools = await School.find({}, { name: 1, city: 1, active: 1 }).sort({ name: 1 }).lean();
  return schools.map((school) => ({ id: school._id.toString(), name: school.name, city: school.city ?? null, active: school.active }));
}

/* ------------------------------------------------------------------ Liste des enfants */

export const CHILD_SORTS = ["name", "code", "birthDate", "createdAt"] as const;
export type ChildSort = (typeof CHILD_SORTS)[number];
const SORT_FIELDS: Record<ChildSort, Record<string, 1 | -1>> = {
  name: { lastName: 1, firstName: 1 },
  code: { code: 1 },
  birthDate: { birthDate: 1 },
  createdAt: { createdAt: 1 },
};

export type ChildFilters = {
  status: ChildStatus | "ALL";
  sex: Sex | null;
  /** Année consultée : sert au filtre « inscrit » et à l'affichage de l'établissement. */
  yearId: string | null;
  enrolledOnly: boolean;
  schoolId: string | null;
};

export type ChildListItem = {
  id: string;
  code: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  sex: Sex;
  status: ChildStatus;
  photoUrl: string | null;
  enrollment: { schoolName: string; className: string } | null;
};

export async function listChildren(params: ListParams<ChildSort>, filters: ChildFilters): Promise<Paginated<ChildListItem>> {
  await connectDB();
  const query: Record<string, unknown> = {};
  if (filters.status !== "ALL") query.status = filters.status;
  if (filters.sex) query.sex = filters.sex;
  if (params.q) query.searchText = { $regex: escapeRegex(normalizeSearch(params.q)) };

  const yearId = filters.yearId && Types.ObjectId.isValid(filters.yearId) ? new Types.ObjectId(filters.yearId) : null;
  if (yearId && (filters.enrolledOnly || filters.schoolId)) {
    const enrollmentFilter: Record<string, unknown> = { schoolYear: yearId };
    if (filters.schoolId && Types.ObjectId.isValid(filters.schoolId)) enrollmentFilter.school = new Types.ObjectId(filters.schoolId);
    query._id = { $in: await Enrollment.distinct("child", enrollmentFilter) };
  }

  const direction = params.dir === "desc" ? -1 : 1;
  const sort = Object.fromEntries(Object.entries(SORT_FIELDS[params.sort]).map(([field]) => [field, direction]));
  const [children, total] = await Promise.all([
    Child.find(query, { code: 1, firstName: 1, lastName: 1, birthDate: 1, sex: 1, status: 1, photo: 1 })
      .sort({ ...sort, _id: 1 })
      .skip((params.page - 1) * params.pageSize)
      .limit(params.pageSize)
      .lean(),
    Child.countDocuments(query),
  ]);

  // Scolarité de l'année consultée pour la page affichée : une requête, pas de N+1.
  const enrollments = yearId
    ? await Enrollment.find({ schoolYear: yearId, child: { $in: children.map((c) => c._id) } }, { child: 1, className: 1, school: 1 })
        .populate<{ school: { name: string } }>("school", "name")
        .lean()
    : [];
  const byChild = new Map(enrollments.map((e) => [e.child.toString(), { schoolName: e.school?.name ?? "—", className: e.className }]));

  const items = children.map<ChildListItem>((child) => ({
    id: child._id.toString(),
    code: child.code,
    firstName: child.firstName,
    lastName: child.lastName,
    birthDate: child.birthDate.toISOString(),
    sex: child.sex,
    status: child.status,
    photoUrl: child.photo ? signedImageUrl(child.photo as StoredAsset, { width: 80, height: 80 }) : null,
    enrollment: byChild.get(child._id.toString()) ?? null,
  }));
  return toPaginated(items, total, params);
}

/* ------------------------------------------------------------------ Fiche */

export type ChildDetail = {
  id: string;
  code: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  sex: Sex;
  birthPlace: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  status: ChildStatus;
  archivedAt: string | null;
  archiveReason: string | null;
  photoUrl: string | null;
  photoLargeUrl: string | null;
  createdAt: string;
  guardians: Array<{
    id: string;
    relationship: GuardianRelationship;
    firstName: string;
    lastName: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    occupation: string | null;
    isPrimaryContact: boolean;
  }>;
  enrollments: Array<{
    id: string;
    schoolYearId: string;
    yearLabel: string;
    yearStatus: string;
    schoolId: string;
    schoolName: string;
    schoolType: SchoolType | null;
    schoolCity: string | null;
    className: string;
    level: string | null;
    average: number | null;
    rank: string | null;
    outcome: EnrollmentOutcome;
    notes: string | null;
  }>;
  sponsorshipsCount: number;
  history: Array<{ id: string; at: string; actor: string; summary: string }>;
};

export async function getChildDetail(childId: string): Promise<ChildDetail | null> {
  if (!Types.ObjectId.isValid(childId)) return null;
  await connectDB();
  const id = new Types.ObjectId(childId);
  const [child, enrollments, sponsorshipsCount, history] = await Promise.all([
    Child.findById(id).lean(),
    Enrollment.find({ child: id })
      .populate<{ schoolYear: { _id: Types.ObjectId; label: string; status: string; startDate: Date } }>("schoolYear", "label status startDate")
      .populate<{ school: { _id: Types.ObjectId; name: string; type: SchoolType; city?: string } }>("school", "name type city")
      .lean(),
    Sponsorship.countDocuments({ child: id }),
    AuditLog.find({ entityType: "Child", entityId: id }).sort({ at: -1 }).limit(30).lean(),
  ]);
  if (!child) return null;

  return {
    id: childId,
    code: child.code,
    firstName: child.firstName,
    lastName: child.lastName,
    birthDate: child.birthDate.toISOString(),
    sex: child.sex,
    birthPlace: child.birthPlace ?? null,
    address: child.address ?? null,
    city: child.city ?? null,
    phone: child.phone ?? null,
    email: child.email ?? null,
    notes: child.notes ?? null,
    status: child.status,
    archivedAt: child.archivedAt?.toISOString() ?? null,
    archiveReason: child.archiveReason ?? null,
    photoUrl: child.photo ? signedImageUrl(child.photo as StoredAsset, { width: 160, height: 160 }) : null,
    photoLargeUrl: child.photo ? signedImageUrl(child.photo as StoredAsset, { width: 640, height: 640 }) : null,
    createdAt: child.createdAt.toISOString(),
    guardians: child.guardians.map((guardian) => ({
      id: guardian._id.toString(),
      relationship: guardian.relationship,
      firstName: guardian.firstName,
      lastName: guardian.lastName,
      phone: guardian.phone ?? null,
      email: guardian.email ?? null,
      address: guardian.address ?? null,
      occupation: guardian.occupation ?? null,
      isPrimaryContact: Boolean(guardian.isPrimaryContact),
    })),
    enrollments: enrollments
      .filter((e) => e.schoolYear)
      .sort((a, b) => +b.schoolYear.startDate - +a.schoolYear.startDate)
      .map((e) => ({
        id: e._id.toString(),
        schoolYearId: e.schoolYear._id.toString(),
        yearLabel: e.schoolYear.label,
        yearStatus: e.schoolYear.status,
        schoolId: e.school?._id.toString() ?? "",
        schoolName: e.school?.name ?? "Établissement supprimé",
        schoolType: e.school?.type ?? null,
        schoolCity: e.school?.city ?? null,
        className: e.className,
        level: e.level ?? null,
        average: e.average ?? null,
        rank: e.rank ?? null,
        outcome: e.outcome,
        notes: e.notes ?? null,
      })),
    sponsorshipsCount,
    history: history.map((log) => ({ id: log._id.toString(), at: log.at.toISOString(), actor: log.actorLabel, summary: log.summary })),
  };
}

/* ------------------------------------------------------------------ Établissements */

export type SchoolListItem = {
  id: string;
  name: string;
  type: SchoolType;
  city: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
  enrolledThisYear: number;
  enrolledTotal: number;
};

export async function listSchools(): Promise<{ items: SchoolListItem[]; activeYearLabel: string | null }> {
  await connectDB();
  const [schools, activeYear, totals] = await Promise.all([
    School.find({}).sort({ active: -1, name: 1 }).lean(),
    SchoolYear.findOne({ status: "ACTIVE" }, { label: 1 }).lean(),
    Enrollment.aggregate<{ _id: Types.ObjectId; count: number }>([{ $group: { _id: "$school", count: { $sum: 1 } } }]),
  ]);
  const yearCounts = activeYear
    ? await Enrollment.aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { schoolYear: activeYear._id } },
        { $group: { _id: "$school", count: { $sum: 1 } } },
      ])
    : [];
  const total = new Map(totals.map((row) => [row._id.toString(), row.count]));
  const current = new Map(yearCounts.map((row) => [row._id.toString(), row.count]));

  return {
    activeYearLabel: activeYear?.label ?? null,
    items: schools.map((school) => ({
      id: school._id.toString(),
      name: school.name,
      type: school.type,
      city: school.city ?? null,
      address: school.address ?? null,
      phone: school.phone ?? null,
      email: school.email ?? null,
      active: school.active,
      enrolledThisYear: current.get(school._id.toString()) ?? 0,
      enrolledTotal: total.get(school._id.toString()) ?? 0,
    })),
  };
}
