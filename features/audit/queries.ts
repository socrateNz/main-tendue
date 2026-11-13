import "server-only";

import { AuditLog } from "@/features/audit/model";
import { connectDB } from "@/lib/db/mongoose";
import { escapeRegex, toPaginated, type ListParams, type Paginated } from "@/lib/db/pagination";

export const AUDIT_SORTS = ["at"] as const;
export type AuditSort = (typeof AUDIT_SORTS)[number];

/** Domaines fonctionnels, déduits du préfixe de l'action (`payment.create` → `payment`). */
export const AUDIT_DOMAINS: Record<string, string> = {
  auth: "Connexions",
  user: "Utilisateurs",
  schoolYear: "Années scolaires",
  cashOpening: "Solde initial",
  child: "Enfants",
  enrollment: "Scolarité",
  school: "Établissements",
  sponsor: "Sponsors",
  sponsorship: "Parrainages",
  commitment: "Engagements",
  payment: "Versements",
  credit: "Avances",
  expense: "Dépenses",
  expenseCategory: "Catégories de dépenses",
  video: "Vidéos",
  import: "Imports Excel",
};

export type AuditItem = { id: string; at: string; actor: string; action: string; domain: string; summary: string; ip: string | null };

export async function listAudit(params: ListParams<AuditSort>, filters: { domain: string | null; actor: string | null }): Promise<Paginated<AuditItem>> {
  await connectDB();
  const query: Record<string, unknown> = {};
  if (filters.domain && filters.domain in AUDIT_DOMAINS) query.action = { $regex: `^${escapeRegex(filters.domain)}\\.` };
  if (filters.actor) query.actorLabel = { $regex: escapeRegex(filters.actor), $options: "i" };
  if (params.q) query.summary = { $regex: escapeRegex(params.q), $options: "i" };
  const [logs, total] = await Promise.all([
    AuditLog.find(query).sort({ at: params.dir === "asc" ? 1 : -1 }).skip((params.page - 1) * params.pageSize).limit(params.pageSize).lean(),
    AuditLog.countDocuments(query),
  ]);
  return toPaginated(
    logs.map((log) => {
      const domain = log.action.split(".")[0];
      return { id: log._id.toString(), at: log.at.toISOString(), actor: log.actorLabel, action: log.action, domain: AUDIT_DOMAINS[domain] ?? domain, summary: log.summary, ip: log.ip ?? null };
    }),
    total,
    params,
  );
}
