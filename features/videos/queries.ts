import "server-only";

import { Types } from "mongoose";

import { AuditLog } from "@/features/audit/model";
import { Child } from "@/features/children/model";
import { SchoolYear } from "@/features/school-years/model";
import { Sponsor } from "@/features/sponsors/model";
import { Sponsorship } from "@/features/sponsorships/model";
import { Video, VideoAccessLink } from "@/features/videos/model";
import { privateVideoUrl, type StoredAsset } from "@/lib/cloudinary";
import { connectDB } from "@/lib/db/mongoose";
import { fullName } from "@/lib/text";

import { SIGNED_URL_TTL_SECONDS, type VideoStatus } from "./types";

export type VideoListItem = {
  id: string;
  title: string;
  status: VideoStatus;
  child: { id: string; name: string };
  yearLabel: string;
  availableAt: string | null;
  expiresAt: string | null;
  bytes: number | null;
  activeLinks: number;
  views: number;
  downloads: number;
  deletionAttempts: number;
};

export async function listVideos(filters: { yearId: string | null; status: VideoStatus | null }): Promise<VideoListItem[]> {
  await connectDB();
  const query: Record<string, unknown> = {};
  if (filters.yearId && Types.ObjectId.isValid(filters.yearId)) query.schoolYear = new Types.ObjectId(filters.yearId);
  if (filters.status) query.status = filters.status;
  const videos = await Video.find(query).sort({ createdAt: -1 }).limit(500).lean();
  const [children, years, linkStats] = await Promise.all([
    Child.find({ _id: { $in: videos.map((v) => v.child) } }, { firstName: 1, lastName: 1 }).lean(),
    SchoolYear.find({ _id: { $in: videos.map((v) => v.schoolYear) } }, { label: 1 }).lean(),
    VideoAccessLink.aggregate<{ _id: Types.ObjectId; active: number; views: number; downloads: number }>([
      { $match: { video: { $in: videos.map((v) => v._id) } } },
      { $group: { _id: "$video", active: { $sum: { $cond: ["$active", 1, 0] } }, views: { $sum: "$accessCount" }, downloads: { $sum: "$downloadCount" } } },
    ]),
  ]);
  const childName = new Map(children.map((c) => [c._id.toString(), fullName(c)]));
  const yearLabel = new Map(years.map((y) => [y._id.toString(), y.label]));
  const stats = new Map(linkStats.map((s) => [s._id.toString(), s]));
  return videos.map((v) => ({
    id: v._id.toString(),
    title: v.title,
    status: v.status,
    child: { id: v.child.toString(), name: childName.get(v.child.toString()) ?? "—" },
    yearLabel: yearLabel.get(v.schoolYear.toString()) ?? "—",
    availableAt: v.availableAt?.toISOString() ?? null,
    expiresAt: v.expiresAt?.toISOString() ?? null,
    bytes: v.asset.bytes ?? null,
    activeLinks: stats.get(v._id.toString())?.active ?? 0,
    views: stats.get(v._id.toString())?.views ?? 0,
    downloads: stats.get(v._id.toString())?.downloads ?? 0,
    deletionAttempts: v.deletion?.attempts ?? 0,
  }));
}

export type VideoDetail = VideoListItem & {
  message: string | null;
  duration: number | null;
  previewUrl: string | null;
  revokeReason: string | null;
  deletion: { attempts: number; lastError: string | null; deletedAt: string | null };
  links: Array<{ id: string; sponsorId: string; sponsorName: string; active: boolean; expiresAt: string; revokedAt: string | null; accessCount: number; downloadCount: number; lastAccessAt: string | null; createdAt: string }>;
  /** Sponsors de l'enfant pour l'année, avec ou sans lien actif. */
  sponsors: Array<{ id: string; name: string; hasActiveLink: boolean }>;
  history: Array<{ id: string; at: string; actor: string; summary: string }>;
};

export async function getVideoDetail(videoId: string): Promise<VideoDetail | null> {
  if (!Types.ObjectId.isValid(videoId)) return null;
  await connectDB();
  const video = await Video.findById(videoId).lean();
  if (!video) return null;
  const [base] = await listVideos({ yearId: null, status: null }).then((all) => all.filter((v) => v.id === videoId));
  const [links, sponsorIds, history] = await Promise.all([
    VideoAccessLink.find({ video: video._id }).sort({ createdAt: -1 }).lean(),
    Sponsorship.distinct("sponsor", { child: video.child, schoolYear: video.schoolYear, status: { $ne: "CANCELLED" } }),
    AuditLog.find({ entityType: "Video", entityId: video._id }).sort({ at: -1 }).limit(40).lean(),
  ]);
  const sponsors = await Sponsor.find({ _id: { $in: [...sponsorIds, ...links.map((l) => l.sponsor)] } }, { displayName: 1, status: 1 }).lean();
  const name = new Map(sponsors.map((s) => [s._id.toString(), s.displayName]));
  const playable = video.status === "AVAILABLE" || video.status === "PROCESSING" || video.status === "REVOKED";
  return {
    ...base,
    message: video.message ?? null,
    duration: video.asset.duration ?? null,
    previewUrl: playable ? privateVideoUrl(video.asset as StoredAsset, { ttlSeconds: SIGNED_URL_TTL_SECONDS, attachment: false }) : null,
    revokeReason: video.revokeReason ?? null,
    deletion: { attempts: video.deletion?.attempts ?? 0, lastError: video.deletion?.lastError ?? null, deletedAt: video.deletion?.deletedAt?.toISOString() ?? null },
    links: links.map((l) => ({
      id: l._id.toString(),
      sponsorId: l.sponsor.toString(),
      sponsorName: name.get(l.sponsor.toString()) ?? "—",
      active: l.active,
      expiresAt: l.expiresAt.toISOString(),
      revokedAt: l.revokedAt?.toISOString() ?? null,
      accessCount: l.accessCount,
      downloadCount: l.downloadCount,
      lastAccessAt: l.lastAccessAt?.toISOString() ?? null,
      createdAt: l.createdAt.toISOString(),
    })),
    sponsors: sponsors
      .filter((s) => sponsorIds.some((id: Types.ObjectId) => id.equals(s._id)) && s.status !== "ARCHIVED")
      .map((s) => ({ id: s._id.toString(), name: s.displayName, hasActiveLink: links.some((l) => l.active && l.sponsor.equals(s._id)) })),
    history: history.map((log) => ({ id: log._id.toString(), at: log.at.toISOString(), actor: log.actorLabel, summary: log.summary })),
  };
}
