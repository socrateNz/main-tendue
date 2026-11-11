import "server-only";

import { type ClientSession, Types, mongo } from "mongoose";

import { actorOf, type RequestContext, type SessionUser } from "@/features/auth/service";
import { CASH_OPENING_ID, CashOpening } from "@/features/cashbox/model";
import { Enrollment } from "@/features/children/model";
import { Commitment } from "@/features/commitments/model";
import { Payment } from "@/features/contributions/model";
import { Expense } from "@/features/expenses/model";
import { SchoolYear } from "@/features/school-years/model";
import { Sponsorship } from "@/features/sponsorships/model";
import { Video } from "@/features/videos/model";
import { recordAudit } from "@/lib/audit";
import { formatDate, isWithinPeriod, nextUtcDay, parseDateInput, periodsOverlap, startOfUtcDay } from "@/lib/dates";
import { withTransaction } from "@/lib/db/mongoose";
import { BusinessRuleError, ConflictError, NotFoundError } from "@/lib/errors";

import type { CreateSchoolYearInput, UpdateSchoolYearInput } from "./schemas";
import { computeTreasuryOverview } from "./treasury";
import { SCHOOL_YEAR_STATUS_LABELS } from "./types";

/**
 * Règles de gestion des années scolaires (docs/modele-donnees.md § 2 et § 8).
 * Toutes les mutations s'exécutent en transaction avec leur entrée d'audit.
 */

const AUDIT_ENTITY = "SchoolYear";

function isDuplicateKey(error: unknown): boolean {
  return error instanceof mongo.MongoServerError && error.code === 11000;
}

function toDate(value: string): Date {
  const date = parseDateInput(value);
  if (!date) throw new BusinessRuleError("Date invalide.");
  return date;
}

/**
 * Vérifie qu'une période peut être placée dans la chronologie :
 * - aucun chevauchement avec une autre année ;
 * - pas avant l'année qui porte le solde initial de caisse ;
 * - pas avant une année déjà clôturée (la chaîne des soldes clôturés est immuable).
 */
async function assertPeriodPlacement(
  start: Date,
  end: Date,
  session: ClientSession,
  excludeId?: Types.ObjectId,
): Promise<void> {
  const others = await SchoolYear.find(excludeId ? { _id: { $ne: excludeId } } : {}, { label: 1, startDate: 1, endDate: 1, status: 1 })
    .session(session)
    .lean();

  const overlapping = others.find((year) => periodsOverlap(start, end, year.startDate, year.endDate));
  if (overlapping) {
    throw new BusinessRuleError(`Cette période chevauche l'année ${overlapping.label}.`, {
      startDate: [`Chevauche ${overlapping.label}.`],
    });
  }

  const opening = await CashOpening.findById(CASH_OPENING_ID, { schoolYear: 1 }).session(session).lean();
  if (opening && !excludeId?.equals(opening.schoolYear)) {
    const first = others.find((year) => year._id.equals(opening.schoolYear));
    if (first && start < first.startDate) {
      throw new BusinessRuleError(
        `Impossible de placer une année avant ${first.label}, qui porte le solde initial de la caisse.`,
        { startDate: ["Antérieure à la première année de la caisse."] },
      );
    }
  }

  const lastClosed = others.filter((year) => year.status === "CLOSED").sort((a, b) => +b.startDate - +a.startDate)[0];
  if (lastClosed && start < lastClosed.startDate) {
    throw new BusinessRuleError(`Impossible de placer une année avant ${lastClosed.label}, déjà clôturée.`, {
      startDate: ["Antérieure à une année clôturée."],
    });
  }
}

/* ------------------------------------------------------------------ Création / modification */

export async function createSchoolYear(actor: SessionUser, input: CreateSchoolYearInput, ctx: RequestContext): Promise<string> {
  const start = toDate(input.startDate);
  const end = toDate(input.endDate);
  try {
    return await withTransaction(async (session) => {
      await assertPeriodPlacement(start, end, session);
      const [year] = await SchoolYear.create([{ label: input.label, startDate: start, endDate: end, notes: input.notes || undefined }], {
        session,
      });
      await recordAudit(actorOf(actor, ctx), {
        action: "schoolYear.create",
        summary: `Création de l'année scolaire ${input.label} (${formatDate(start)} → ${formatDate(end)}).`,
        entityType: AUDIT_ENTITY,
        entityId: year._id,
        schoolYear: year._id,
      }, session);
      return year._id.toString();
    });
  } catch (error) {
    if (isDuplicateKey(error)) throw new ConflictError("Cette année scolaire existe déjà.", { label: ["Libellé déjà utilisé."] });
    throw error;
  }
}

export async function updateSchoolYear(actor: SessionUser, input: UpdateSchoolYearInput, ctx: RequestContext): Promise<void> {
  const start = toDate(input.startDate);
  const end = toDate(input.endDate);
  try {
    await withTransaction(async (session) => {
      const year = await SchoolYear.findById(input.yearId).session(session).lean();
      if (!year) throw new NotFoundError("Année scolaire introuvable.");
      if (year.status === "CLOSED") throw new BusinessRuleError("Une année clôturée ne peut pas être modifiée.");

      const periodChanged = +year.startDate !== +start || +year.endDate !== +end;
      if (periodChanged) {
        await assertPeriodPlacement(start, end, session, year._id);

        // Les mouvements déjà rattachés doivent rester dans la nouvelle période.
        const outside = { schoolYear: year._id, status: "VALID" as const };
        const [payments, expenses] = await Promise.all([
          Payment.countDocuments({ ...outside, $or: [{ receivedAt: { $lt: start } }, { receivedAt: { $gte: nextUtcDay(end) } }] }).session(session),
          Expense.countDocuments({ ...outside, $or: [{ spentAt: { $lt: start } }, { spentAt: { $gte: nextUtcDay(end) } }] }).session(session),
        ]);
        if (payments + expenses > 0) {
          throw new BusinessRuleError(
            `${payments + expenses} mouvement(s) financier(s) de cette année seraient hors de la nouvelle période.`,
          );
        }
        const opening = await CashOpening.findById(CASH_OPENING_ID, { schoolYear: 1, date: 1 }).session(session).lean();
        if (opening?.schoolYear.equals(year._id) && !isWithinPeriod(opening.date, start, end)) {
          throw new BusinessRuleError("La date du solde initial de caisse doit rester comprise dans la période.");
        }
      }

      await SchoolYear.updateOne(
        { _id: year._id },
        { $set: { label: input.label, startDate: start, endDate: end, notes: input.notes || undefined } },
        { session, runValidators: true },
      );
      await recordAudit(actorOf(actor, ctx), {
        action: "schoolYear.update",
        summary: `Modification de l'année scolaire ${input.label}.`,
        entityType: AUDIT_ENTITY,
        entityId: year._id,
        schoolYear: year._id,
        details: {
          before: { label: year.label, startDate: year.startDate, endDate: year.endDate },
          after: { label: input.label, startDate: start, endDate: end },
        },
      }, session);
    });
  } catch (error) {
    if (isDuplicateKey(error)) throw new ConflictError("Une autre année porte déjà ce libellé ou cette date de début.", { label: ["Déjà utilisé."] });
    throw error;
  }
}

/* ------------------------------------------------------------------ Cycle de vie */

export async function activateSchoolYear(actor: SessionUser, yearId: string, ctx: RequestContext): Promise<void> {
  await withTransaction(async (session) => {
    const year = await SchoolYear.findById(yearId).session(session).lean();
    if (!year) throw new NotFoundError("Année scolaire introuvable.");
    if (year.status !== "DRAFT") throw new BusinessRuleError("Seule une année en préparation peut être activée.");

    const active = await SchoolYear.findOne({ status: "ACTIVE" }, { label: 1 }).session(session).lean();
    if (active) {
      throw new BusinessRuleError(`L'année ${active.label} est encore active : clôturez-la avant d'activer ${year.label}.`);
    }
    const earlierDraft = await SchoolYear.findOne({ startDate: { $lt: year.startDate }, status: "DRAFT" }, { label: 1 }).session(session).lean();
    if (earlierDraft) {
      throw new BusinessRuleError(`L'année antérieure ${earlierDraft.label} n'a jamais été activée.`);
    }

    await SchoolYear.updateOne({ _id: year._id }, { $set: { status: "ACTIVE", activatedAt: new Date() } }, { session });
    await recordAudit(actorOf(actor, ctx), {
      action: "schoolYear.activate",
      summary: `Activation de l'année scolaire ${year.label}.`,
      entityType: AUDIT_ENTITY,
      entityId: year._id,
      schoolYear: year._id,
    }, session);
  });
}

export type ClosingPreview = {
  canClose: boolean;
  blockers: string[];
  figures: Awaited<ReturnType<typeof computeTreasuryOverview>>["years"][number]["figures"] | null;
};

/** Conditions de clôture, partagées par l'aperçu (interface) et la clôture elle-même. */
async function closingBlockers(yearId: Types.ObjectId, session?: ClientSession): Promise<string[]> {
  const year = await SchoolYear.findById(yearId).session(session ?? null).lean();
  if (!year) throw new NotFoundError("Année scolaire introuvable.");
  const blockers: string[] = [];

  if (year.status !== "ACTIVE" && year.status !== "REOPENED") {
    blockers.push(`Une année « ${SCHOOL_YEAR_STATUS_LABELS[year.status]} » ne peut pas être clôturée.`);
  }
  if (startOfUtcDay(new Date()) <= startOfUtcDay(year.endDate)) {
    blockers.push(`La période se termine le ${formatDate(year.endDate)} : la clôture sera possible à partir du lendemain.`);
  }
  const earlierOpen = await SchoolYear.findOne({ startDate: { $lt: year.startDate }, status: { $ne: "CLOSED" } }, { label: 1 })
    .session(session ?? null)
    .lean();
  if (earlierOpen) blockers.push(`L'année antérieure ${earlierOpen.label} doit d'abord être clôturée.`);

  const isFirst = !(await SchoolYear.exists({ startDate: { $lt: year.startDate } }).session(session ?? null));
  if (isFirst && !(await CashOpening.exists({ _id: CASH_OPENING_ID }).session(session ?? null))) {
    blockers.push("Le solde initial de la caisse doit être enregistré avant la première clôture (0 accepté).");
  }
  return blockers;
}

export async function getClosingPreview(yearId: string): Promise<ClosingPreview> {
  const id = new Types.ObjectId(yearId);
  const [blockers, overview] = await Promise.all([closingBlockers(id), computeTreasuryOverview()]);
  return {
    canClose: blockers.length === 0,
    blockers,
    figures: overview.years.find((year) => year.yearId === yearId)?.figures ?? null,
  };
}

/** Clôture : fige un instantané immuable de la trésorerie et de la situation des engagements. */
export async function closeSchoolYear(actor: SessionUser, yearId: string, ctx: RequestContext): Promise<void> {
  await withTransaction(async (session) => {
    const id = new Types.ObjectId(yearId);
    const blockers = await closingBlockers(id, session);
    if (blockers.length > 0) throw new BusinessRuleError(blockers.join(" "));

    const overview = await computeTreasuryOverview(session);
    const entry = overview.years.find((year) => year.yearId === yearId);
    if (!entry) throw new NotFoundError("Année scolaire introuvable.");

    const closing = {
      ...entry.figures,
      commitmentsExpected: entry.commitmentsNow.expected,
      commitmentsAllocatedAtClosing: entry.commitmentsNow.allocated,
      advancesAvailableAtClosing: Math.max(0, overview.advancesAvailable),
      closedAt: new Date(),
      closedBy: new Types.ObjectId(actor.id),
    };
    await SchoolYear.updateOne({ _id: id }, { $set: { status: "CLOSED", closing } }, { session, runValidators: true });
    await recordAudit(actorOf(actor, ctx), {
      action: "schoolYear.close",
      summary: `Clôture de l'année scolaire ${entry.label} — solde de clôture ${entry.figures.closingBalance} FCFA.`,
      entityType: AUDIT_ENTITY,
      entityId: id,
      schoolYear: id,
      details: { closing },
    }, session);
  });
}

/**
 * Réouverture exceptionnelle (SUPER_ADMIN) : uniquement la DERNIÈRE année clôturée, pour ne jamais
 * invalider l'instantané d'une année postérieure. L'instantané remplacé est archivé, jamais effacé.
 */
export async function reopenSchoolYear(actor: SessionUser, yearId: string, reason: string, ctx: RequestContext): Promise<void> {
  await withTransaction(async (session) => {
    const year = await SchoolYear.findById(yearId).session(session).lean();
    if (!year) throw new NotFoundError("Année scolaire introuvable.");
    if (year.status !== "CLOSED" || !year.closing) throw new BusinessRuleError("Seule une année clôturée peut être rouverte.");
    const laterClosed = await SchoolYear.findOne({ startDate: { $gt: year.startDate }, status: "CLOSED" }, { label: 1 }).session(session).lean();
    if (laterClosed) {
      throw new BusinessRuleError(`L'année ${laterClosed.label}, postérieure, est clôturée : seule la dernière année clôturée peut être rouverte.`);
    }

    await SchoolYear.updateOne(
      { _id: year._id },
      {
        $set: { status: "REOPENED", closing: null, archived: false },
        $unset: { archivedAt: 1 },
        $push: { reopenings: { reason, by: new Types.ObjectId(actor.id), at: new Date(), previousClosing: year.closing } },
      },
      { session },
    );
    await recordAudit(actorOf(actor, ctx), {
      action: "schoolYear.reopen",
      summary: `Réouverture exceptionnelle de l'année scolaire ${year.label}.`,
      entityType: AUDIT_ENTITY,
      entityId: year._id,
      schoolYear: year._id,
      details: { reason, previousClosing: year.closing },
    }, session);
  });
}

export async function setSchoolYearArchived(actor: SessionUser, yearId: string, archived: boolean, ctx: RequestContext): Promise<void> {
  await withTransaction(async (session) => {
    const year = await SchoolYear.findById(yearId).session(session).lean();
    if (!year) throw new NotFoundError("Année scolaire introuvable.");
    if (year.status !== "CLOSED") throw new BusinessRuleError("Seule une année clôturée peut être archivée.");
    if (year.archived === archived) return;
    await SchoolYear.updateOne(
      { _id: year._id },
      archived ? { $set: { archived: true, archivedAt: new Date() } } : { $set: { archived: false }, $unset: { archivedAt: 1 } },
      { session },
    );
    await recordAudit(actorOf(actor, ctx), {
      action: archived ? "schoolYear.archive" : "schoolYear.unarchive",
      summary: `${archived ? "Archivage" : "Désarchivage"} de l'année scolaire ${year.label}.`,
      entityType: AUDIT_ENTITY,
      entityId: year._id,
      schoolYear: year._id,
    }, session);
  });
}

/** Suppression d'une année créée par erreur : uniquement en préparation et sans aucune donnée liée. */
export async function deleteDraftSchoolYear(actor: SessionUser, yearId: string, ctx: RequestContext): Promise<void> {
  await withTransaction(async (session) => {
    const year = await SchoolYear.findById(yearId).session(session).lean();
    if (!year) throw new NotFoundError("Année scolaire introuvable.");
    if (year.status !== "DRAFT") throw new BusinessRuleError("Seule une année en préparation peut être supprimée.");

    const filter = { schoolYear: year._id };
    const linked = await Promise.all([
      Enrollment.exists(filter).session(session),
      Sponsorship.exists(filter).session(session),
      Commitment.exists(filter).session(session),
      Payment.exists({ $or: [filter, { "lines.commitmentYear": year._id }] }).session(session),
      Expense.exists(filter).session(session),
      Video.exists(filter).session(session),
      CashOpening.exists({ _id: CASH_OPENING_ID, schoolYear: year._id }).session(session),
    ]);
    if (linked.some(Boolean)) {
      throw new BusinessRuleError("Cette année contient déjà des données : elle ne peut pas être supprimée.");
    }

    await SchoolYear.deleteOne({ _id: year._id }, { session });
    await recordAudit(actorOf(actor, ctx), {
      action: "schoolYear.delete",
      summary: `Suppression de l'année en préparation ${year.label} (aucune donnée liée).`,
      entityType: AUDIT_ENTITY,
      entityId: year._id,
      details: { label: year.label, startDate: year.startDate, endDate: year.endDate },
    }, session);
  });
}

/* ------------------------------------------------------------------ Année d'un mouvement */

/**
 * Détermine l'année scolaire d'un mouvement financier à partir de sa date RÉELLE (règle validée) :
 * jamais choisie par l'utilisateur ; refus si aucune année ne couvre la date ou si elle est clôturée.
 */
export async function resolveMovementYear(date: Date, session?: ClientSession) {
  const day = startOfUtcDay(date);
  const year = await SchoolYear.findOne({ startDate: { $lte: day }, endDate: { $gte: day } }, { label: 1, status: 1, startDate: 1, endDate: 1 })
    .session(session ?? null)
    .lean();
  if (!year) {
    throw new BusinessRuleError(`Aucune année scolaire ne couvre le ${formatDate(day)}. Créez ou ajustez l'année concernée.`);
  }
  if (year.status === "CLOSED") {
    throw new BusinessRuleError(`Le ${formatDate(day)} appartient à l'année ${year.label}, clôturée : aucun nouveau mouvement n'est possible.`);
  }
  return year;
}
