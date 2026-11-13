import type { Permission } from "@/lib/auth/permissions";

/** Format commun d'un rapport : le même objet alimente l'affichage et l'export Excel (.xlsx). */
export type ReportColumn = { key: string; label: string; kind: "text" | "money" | "number" | "percent" };
export type ReportRow = Record<string, string | number | null>;
export type Report = {
  title: string;
  description: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  totals?: ReportRow;
  notes?: string[];
};

export const REPORT_TYPES = ["financier", "engagements", "contributions", "depenses", "sponsors", "enfants", "etablissements", "videos"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_META: Record<ReportType, { label: string; permission: Permission; yearScoped: boolean }> = {
  financier: { label: "Financier", permission: "reports:finance", yearScoped: false },
  engagements: { label: "Engagements", permission: "reports:finance", yearScoped: true },
  contributions: { label: "Contributions", permission: "reports:finance", yearScoped: true },
  depenses: { label: "Dépenses", permission: "reports:finance", yearScoped: true },
  sponsors: { label: "Par sponsor", permission: "reports:finance", yearScoped: true },
  enfants: { label: "Par enfant", permission: "reports:finance", yearScoped: true },
  etablissements: { label: "Par établissement", permission: "reports:read", yearScoped: true },
  videos: { label: "Vidéos", permission: "videos:read", yearScoped: true },
};
