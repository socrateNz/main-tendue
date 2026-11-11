import "server-only";

import type { ClientSession, Types } from "mongoose";

import { AuditLog } from "@/features/audit/model";
import { connectDB } from "@/lib/db/mongoose";

export type AuditActor = {
  id?: Types.ObjectId | string | null;
  label: string;
  ip?: string | null;
  userAgent?: string | null;
};

export type AuditEntry = {
  action: string;
  summary: string;
  entityType?: string;
  entityId?: Types.ObjectId | string;
  schoolYear?: Types.ObjectId | string;
  details?: Record<string, unknown>;
};

export const SYSTEM_ACTOR: AuditActor = { label: "Système" };

/**
 * Écrit une entrée d'audit. Pour une opération sensible (financière notamment), passer la `session`
 * de la transaction : l'entrée d'audit est alors validée ou annulée avec l'opération elle-même.
 */
export async function recordAudit(actor: AuditActor, entry: AuditEntry, session?: ClientSession): Promise<void> {
  await connectDB();
  await AuditLog.create(
    [
      {
        at: new Date(),
        actor: actor.id ?? undefined,
        actorLabel: actor.label,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        schoolYear: entry.schoolYear,
        summary: entry.summary,
        details: entry.details,
        ip: actor.ip ?? undefined,
        userAgent: actor.userAgent?.slice(0, 512) ?? undefined,
      },
    ],
    { session },
  );
}
