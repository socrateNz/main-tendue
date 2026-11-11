import "server-only";

import { Types, mongo } from "mongoose";

import { actorOf, type RequestContext, type SessionUser } from "@/features/auth/service";
import { CASH_OPENING_ID, CashOpening } from "@/features/cashbox/model";
import { SchoolYear } from "@/features/school-years/model";
import type { CorrectCashOpeningInput, CreateCashOpeningInput } from "@/features/school-years/schemas";
import { recordAudit } from "@/lib/audit";
import { formatDate, isWithinPeriod, parseDateInput } from "@/lib/dates";
import { withTransaction } from "@/lib/db/mongoose";
import { BusinessRuleError, ConflictError, NotFoundError } from "@/lib/errors";
import { formatXaf } from "@/lib/money";

/**
 * Solde initial de la caisse (docs/modele-donnees.md § 3) : enregistré une seule fois par le
 * SUPER_ADMIN sur la première année ; correction uniquement par procédure auditée.
 */

const AUDIT_ENTITY = "CashOpening";

export async function createCashOpening(actor: SessionUser, input: CreateCashOpeningInput, ctx: RequestContext): Promise<void> {
  const date = parseDateInput(input.date);
  if (!date) throw new BusinessRuleError("Date invalide.");
  try {
    await withTransaction(async (session) => {
      const year = await SchoolYear.findById(input.yearId).session(session).lean();
      if (!year) throw new NotFoundError("Année scolaire introuvable.");
      if (year.status === "CLOSED") throw new BusinessRuleError("L'année est clôturée.");
      const earlier = await SchoolYear.findOne({ startDate: { $lt: year.startDate } }, { label: 1 }).session(session).lean();
      if (earlier) {
        throw new BusinessRuleError(`Le solde initial doit être porté par la première année de l'application (${earlier.label} est antérieure).`);
      }
      if (!isWithinPeriod(date, year.startDate, year.endDate)) {
        throw new BusinessRuleError(`La date doit être comprise dans la période de l'année ${year.label}.`, {
          date: ["Hors de la période de l'année."],
        });
      }

      await CashOpening.create(
        [{ _id: CASH_OPENING_ID, schoolYear: year._id, amount: input.amount, date, reason: input.reason, createdBy: new Types.ObjectId(actor.id) }],
        { session },
      );
      await recordAudit(actorOf(actor, ctx), {
        action: "cashOpening.create",
        summary: `Enregistrement du solde initial de la caisse : ${formatXaf(input.amount)} au ${formatDate(date)} (${year.label}).`,
        entityType: AUDIT_ENTITY,
        schoolYear: year._id,
        details: { amount: input.amount, date, reason: input.reason },
      }, session);
    });
  } catch (error) {
    if (error instanceof mongo.MongoServerError && error.code === 11000) {
      throw new ConflictError("Le solde initial de la caisse a déjà été enregistré.");
    }
    throw error;
  }
}

/** Procédure de correction exceptionnelle : ancien et nouveau montant conservés, motif obligatoire. */
export async function correctCashOpening(actor: SessionUser, input: CorrectCashOpeningInput, ctx: RequestContext): Promise<void> {
  await withTransaction(async (session) => {
    const opening = await CashOpening.findById(CASH_OPENING_ID).session(session).lean();
    if (!opening) throw new NotFoundError("Aucun solde initial n'a été enregistré.");
    const year = await SchoolYear.findById(opening.schoolYear, { label: 1, status: 1 }).session(session).lean();
    if (!year) throw new NotFoundError("Année scolaire introuvable.");
    if (year.status === "CLOSED") {
      throw new BusinessRuleError(`L'année ${year.label} est clôturée : une réouverture préalable est nécessaire pour corriger le solde initial.`);
    }
    if (opening.amount === input.amount) throw new BusinessRuleError("Le nouveau montant est identique au montant actuel.");

    const correction = { from: opening.amount, to: input.amount, reason: input.reason, by: new Types.ObjectId(actor.id), at: new Date() };
    await CashOpening.updateOne(
      { _id: CASH_OPENING_ID },
      { $set: { amount: input.amount }, $push: { corrections: correction } },
      { session, runValidators: true },
    );
    await recordAudit(actorOf(actor, ctx), {
      action: "cashOpening.correct",
      summary: `Correction du solde initial de la caisse : ${formatXaf(opening.amount)} → ${formatXaf(input.amount)}.`,
      entityType: AUDIT_ENTITY,
      schoolYear: year._id,
      details: correction,
    }, session);
  });
}
