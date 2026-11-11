import "server-only";

import { type ClientSession, Types, mongo } from "mongoose";

import { actorOf, type RequestContext, type SessionUser } from "@/features/auth/service";
import { Child } from "@/features/children/model";
import { allocatedByCommitment } from "@/features/commitments/allocations";
import { Commitment } from "@/features/commitments/model";
import { CreditApplication, Payment } from "@/features/contributions/model";
import { SchoolYear } from "@/features/school-years/model";
import { resolveMovementYear } from "@/features/school-years/service";
import { settlementTiming } from "@/features/school-years/types";
import { Sponsor } from "@/features/sponsors/model";
import { recordAudit } from "@/lib/audit";
import {
  CLOUDINARY_FOLDERS,
  destroyAsset,
  detectDocumentType,
  readDocumentFile,
  uploadPrivateDocument,
} from "@/lib/cloudinary";
import { formatNumber, nextSequence } from "@/lib/db/counter";
import { connectDB, withTransaction } from "@/lib/db/mongoose";
import { formatDate, parseDateInput, startOfUtcDay } from "@/lib/dates";
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { convertToXaf, formatXaf, normalizeRate, parseMinorAmount } from "@/lib/money";
import { fullName } from "@/lib/text";

import type { ApplyAdvanceData, PaymentData } from "./schemas";
import { checkPaymentLines, PAYMENT_METHOD_LABELS } from "./types";

/**
 * Versements, dons, avances et affectations d'avances (docs/modele-donnees.md § 5, 6, 9).
 *
 * - Un versement est un MOUVEMENT DE TRÉSORERIE : son année est celle de sa date réelle.
 * - Ses lignes COMMITMENT et les affectations d'avances sont des AFFECTATIONS : elles ne
 *   modifient jamais la caisse, seulement la situation des engagements.
 * - Toute écriture vérifie les plafonds en transaction et incrémente un compteur de version sur
 *   les documents dont dépend le plafond : deux écritures simultanées ne peuvent pas le dépasser.
 */

function isDuplicateKey(error: unknown): boolean {
  return error instanceof mongo.MongoServerError && error.code === 11000;
}

/* ------------------------------------------------------------------ Versement */

export async function createPayment(actor: SessionUser, data: PaymentData, ctx: RequestContext): Promise<string> {
  const receivedAt = parseDateInput(data.receivedAt);
  if (!receivedAt) throw new ValidationError("Date invalide.", { receivedAt: ["Date invalide."] });
  if (receivedAt > startOfUtcDay(new Date())) {
    throw new BusinessRuleError("La date du versement ne peut pas être dans le futur.", { receivedAt: ["Date future."] });
  }
  const originalAmountMinor = parseMinorAmount(data.originalAmount, data.currency);
  const rate = data.currency === "XAF" ? "1" : normalizeRate(data.rate ?? "");
  if (!originalAmountMinor || !rate) throw new ValidationError("Montant ou taux invalide.");
  const amountXaf = convertToXaf(originalAmountMinor, data.currency, rate);

  const total = data.lines.reduce((sum, line) => sum + line.amount, 0) + data.donationAmount + data.advanceAmount;
  if (total !== amountXaf) {
    throw new BusinessRuleError(
      `La ventilation (${formatXaf(total)}) doit être exactement égale au montant du versement (${formatXaf(amountXaf)}). ` +
        "Un excédent doit être explicitement placé en don libre ou en avance.",
      { lines: ["Ventilation incomplète ou excédentaire."] },
    );
  }

  try {
    return await withTransaction(async (session) => {
      const sponsor = await Sponsor.findById(data.sponsorId, { displayName: 1, status: 1 }).session(session).lean();
      if (!sponsor) throw new NotFoundError("Sponsor introuvable.");
      if (sponsor.status === "ARCHIVED") throw new BusinessRuleError("Ce sponsor est archivé.");

      // Année du MOUVEMENT : déterminée par la date réelle (refus si aucune année ou année clôturée).
      const year = await resolveMovementYear(receivedAt, session);

      const lines = await buildCommitmentLines(data.lines, sponsor._id, year, session);
      const allLines = [
        ...lines,
        ...(data.donationAmount > 0 ? [{ kind: "DONATION" as const, amount: data.donationAmount }] : []),
        ...(data.advanceAmount > 0 ? [{ kind: "ADVANCE" as const, amount: data.advanceAmount }] : []),
      ];
      const check = checkPaymentLines(amountXaf, allLines.map((l) => ({ kind: l.kind, amount: l.amount, commitmentId: "commitment" in l ? l.commitment.toString() : undefined })));
      if (!check.ok) throw new BusinessRuleError(check.message);

      const number = formatNumber(`VRS-${year.label.slice(0, 4)}`, await nextSequence(`payment:${year.label}`, session));
      const [payment] = await Payment.create(
        [
          {
            number,
            sponsor: sponsor._id,
            receivedAt,
            schoolYear: year._id,
            method: data.method,
            reference: data.reference,
            currency: { code: data.currency, originalAmountMinor, rate, convertedAt: receivedAt },
            amountXaf,
            lines: allLines,
            note: data.note,
            createdBy: new Types.ObjectId(actor.id),
          },
        ],
        { session },
      );

      const late = lines.filter((line) => line.lateSettlement).reduce((sum, line) => sum + line.amount, 0);
      await recordAudit(actorOf(actor, ctx), {
        action: "payment.create",
        summary:
          `Versement ${number} de ${sponsor.displayName} : ${formatXaf(amountXaf)} le ${formatDate(receivedAt)} (${PAYMENT_METHOD_LABELS[data.method]})` +
          (late > 0 ? `, dont ${formatXaf(late)} de règlement tardif.` : "."),
        entityType: "Payment",
        entityId: payment._id,
        schoolYear: year._id,
        details: {
          amountXaf,
          currency: data.currency,
          originalAmountMinor,
          rate,
          lines: allLines.map((l) => ({ kind: l.kind, amount: l.amount, commitment: "commitment" in l ? l.commitment : undefined })),
        },
      }, session);
      return payment._id.toString();
    });
  } catch (error) {
    if (isDuplicateKey(error)) {
      throw new ConflictError("Un versement valide porte déjà cette référence pour ce moyen de paiement (doublon probable).", {
        reference: ["Référence déjà enregistrée."],
      });
    }
    throw error;
  }
}

type MovementYear = { _id: Types.ObjectId; label: string; startDate: Date };

/** Contrôle chaque ligne d'affectation : engagement actif du même sponsor, année non future, plafond. */
async function buildCommitmentLines(
  input: PaymentData["lines"],
  sponsorId: Types.ObjectId,
  year: MovementYear,
  session: ClientSession,
) {
  if (input.length === 0) return [];
  const ids = input.map((line) => new Types.ObjectId(line.commitmentId));
  const commitments = await Commitment.find({ _id: { $in: ids } }).session(session).lean();
  const years = await SchoolYear.find({ _id: { $in: commitments.map((c) => c.schoolYear) } }, { label: 1, startDate: 1 }).session(session).lean();
  const yearMap = new Map(years.map((y) => [y._id.toString(), y]));
  const allocated = await allocatedByCommitment(ids, session);

  const lines = input.map((line) => {
    const commitment = commitments.find((c) => c._id.toString() === line.commitmentId);
    if (!commitment || commitment.status !== "ACTIVE") throw new BusinessRuleError("Un des engagements est introuvable ou annulé.");
    if (!commitment.sponsor.equals(sponsorId)) throw new BusinessRuleError("Un des engagements n'appartient pas à ce sponsor.");
    const commitmentYear = yearMap.get(commitment.schoolYear.toString());
    if (!commitmentYear) throw new NotFoundError("Année de l'engagement introuvable.");
    const timing = settlementTiming(year.startDate, commitmentYear.startDate);
    if (timing === "FUTURE") {
      throw new BusinessRuleError(
        `L'engagement ${commitmentYear.label} est postérieur à l'année du versement (${year.label}) : enregistrez le montant en avance, puis affectez-le.`,
      );
    }
    const remaining = commitment.expectedAmount - (allocated.get(line.commitmentId) ?? 0);
    if (line.amount > remaining) {
      throw new BusinessRuleError(
        `${formatXaf(line.amount)} dépasse le reste dû de l'engagement ${commitmentYear.label} (${formatXaf(Math.max(0, remaining))}). ` +
          "Placez l'excédent en don libre ou en avance.",
      );
    }
    return {
      kind: "COMMITMENT" as const,
      commitment: commitment._id,
      commitmentYear: commitment.schoolYear,
      lateSettlement: timing === "LATE",
      amount: line.amount,
    };
  });

  // Verrou optimiste : toute écriture concurrente sur ces engagements fait échouer l'une des transactions.
  await Commitment.updateMany({ _id: { $in: ids } }, { $inc: { allocationVersion: 1 } }, { session });
  return lines;
}

/** Annulation d'un versement (motif obligatoire) ; le document reste consultable avec le statut « Annulé ». */
export async function cancelPayment(actor: SessionUser, paymentId: string, reason: string, ctx: RequestContext): Promise<void> {
  await withTransaction(async (session) => {
    const payment = await Payment.findById(paymentId).session(session).lean();
    if (!payment) throw new NotFoundError("Versement introuvable.");
    if (payment.status === "CANCELLED") throw new BusinessRuleError("Ce versement est déjà annulé : il ne peut être ni réactivé ni modifié.");
    const year = await SchoolYear.findById(payment.schoolYear, { label: 1, status: 1 }).session(session).lean();
    if (year?.status === "CLOSED") throw new BusinessRuleError(`L'année ${year.label} est clôturée : ses mouvements ne peuvent plus être annulés.`);

    const advanceLine = payment.lines.find((line) => line.kind === "ADVANCE");
    if (advanceLine) {
      const applied = await CreditApplication.countDocuments({ sourcePayment: payment._id, status: "VALID" }).session(session);
      if (applied > 0) {
        throw new BusinessRuleError(`L'avance de ce versement a été affectée (${applied} affectation(s)) : annulez d'abord ces affectations.`);
      }
    }

    await Payment.updateOne(
      { _id: payment._id, status: "VALID" },
      { $set: { status: "CANCELLED", cancellation: { reason, by: new Types.ObjectId(actor.id), at: new Date() } }, $inc: { creditVersion: 1 } },
      { session },
    );
    const commitmentIds = payment.lines.filter((l) => l.commitment).map((l) => l.commitment as Types.ObjectId);
    if (commitmentIds.length) await Commitment.updateMany({ _id: { $in: commitmentIds } }, { $inc: { allocationVersion: 1 } }, { session });

    await recordAudit(actorOf(actor, ctx), {
      action: "payment.cancel",
      summary: `Annulation du versement ${payment.number} (${formatXaf(payment.amountXaf)}).`,
      entityType: "Payment",
      entityId: payment._id,
      schoolYear: payment.schoolYear,
      details: { reason },
    }, session);
  });
}

/* ------------------------------------------------------------------ Justificatif */

export async function addPaymentAttachment(actor: SessionUser, paymentId: string, file: File, ctx: RequestContext): Promise<void> {
  const buffer = await readDocumentFile(file);
  await connectDB();
  const payment = await Payment.findById(paymentId, { number: 1, attachments: 1, schoolYear: 1 }).lean();
  if (!payment) throw new NotFoundError("Versement introuvable.");
  if (payment.attachments.length >= 5) throw new BusinessRuleError("5 justificatifs maximum par versement.");
  const asset = await uploadPrivateDocument(buffer, detectDocumentType(buffer), CLOUDINARY_FOLDERS.receipts, file.name);
  try {
    await withTransaction(async (session) => {
      await Payment.updateOne({ _id: payment._id }, { $push: { attachments: asset } }, { session });
      await recordAudit(actorOf(actor, ctx), {
        action: "payment.attachment.add",
        summary: `Justificatif ajouté au versement ${payment.number} (${file.name.slice(0, 80)}).`,
        entityType: "Payment",
        entityId: payment._id,
        schoolYear: payment.schoolYear,
      }, session);
    });
  } catch (error) {
    await destroyAsset(asset);
    throw error;
  }
}

/* ------------------------------------------------------------------ Avances */

/** Crédit disponible de chaque ligne ADVANCE d'un sponsor (versements valides), du plus ancien au plus récent. */
export async function advanceSources(sponsorId: Types.ObjectId, session?: ClientSession | null) {
  const payments = await Payment.find({ sponsor: sponsorId, status: "VALID", "lines.kind": "ADVANCE" }, { number: 1, receivedAt: 1, schoolYear: 1, lines: 1 })
    .sort({ receivedAt: 1, _id: 1 })
    .session(session ?? null)
    .lean();
  const applied = await CreditApplication.aggregate<{ _id: Types.ObjectId; total: number }>([
    { $match: { sponsor: sponsorId, status: "VALID" } },
    { $group: { _id: "$sourceLine", total: { $sum: "$amount" } } },
  ]).session(session ?? null);
  const appliedByLine = new Map(applied.map((row) => [row._id.toString(), row.total]));

  return payments.flatMap((payment) =>
    payment.lines
      .filter((line) => line.kind === "ADVANCE")
      .map((line) => {
        const used = appliedByLine.get(line._id.toString()) ?? 0;
        return {
          paymentId: payment._id,
          paymentNumber: payment.number,
          receivedAt: payment.receivedAt,
          sourceYear: payment.schoolYear,
          lineId: line._id,
          amount: line.amount,
          applied: used,
          available: line.amount - used,
        };
      }),
  );
}

/**
 * Affectation EXPLICITE d'une avance à un engagement (validation par un responsable financier).
 * Le crédit est consommé dans l'ordre des encaissements (le plus ancien d'abord). Aucun effet sur
 * la caisse : l'argent y est entré lors du versement d'origine.
 */
export async function applyAdvance(actor: SessionUser, data: ApplyAdvanceData, ctx: RequestContext): Promise<number> {
  return withTransaction(async (session) => {
    const sponsorId = new Types.ObjectId(data.sponsorId);
    const commitment = await Commitment.findById(data.commitmentId).session(session).lean();
    if (!commitment || commitment.status !== "ACTIVE") throw new NotFoundError("Engagement introuvable ou annulé.");
    if (!commitment.sponsor.equals(sponsorId)) throw new BusinessRuleError("Cet engagement n'appartient pas à ce sponsor.");

    const allocated = (await allocatedByCommitment([commitment._id], session)).get(commitment._id.toString()) ?? 0;
    const remaining = commitment.expectedAmount - allocated;
    if (data.amount > remaining) {
      throw new BusinessRuleError(`Le reste dû de cet engagement est de ${formatXaf(Math.max(0, remaining))}.`, { amount: ["Supérieur au reste dû."] });
    }
    const sources = (await advanceSources(sponsorId, session)).filter((source) => source.available > 0);
    const available = sources.reduce((sum, source) => sum + source.available, 0);
    if (data.amount > available) {
      throw new BusinessRuleError(`Le crédit d'avance disponible du sponsor est de ${formatXaf(available)}.`, { amount: ["Supérieur au crédit disponible."] });
    }

    const commitmentYear = await SchoolYear.findById(commitment.schoolYear, { label: 1, startDate: 1 }).session(session).lean();
    const today = startOfUtcDay(new Date());
    const currentYear = await SchoolYear.findOne({ startDate: { $lte: today }, endDate: { $gte: today } }, { startDate: 1 }).session(session).lean();
    const lateSettlement = Boolean(commitmentYear && currentYear && commitmentYear.startDate < currentYear.startDate);

    let rest = data.amount;
    const created: Array<{ number: string; amount: number; source: string }> = [];
    for (const source of sources) {
      if (rest === 0) break;
      const amount = Math.min(rest, source.available);
      const number = formatNumber("AFF", await nextSequence("creditApplication", session));
      await CreditApplication.create(
        [
          {
            number,
            sponsor: sponsorId,
            sourcePayment: source.paymentId,
            sourceLine: source.lineId,
            sourceYear: source.sourceYear,
            commitment: commitment._id,
            schoolYear: commitment.schoolYear,
            lateSettlement,
            amount,
            validatedBy: new Types.ObjectId(actor.id),
            validatedAt: new Date(),
            note: data.note,
          },
        ],
        { session },
      );
      await Payment.updateOne({ _id: source.paymentId }, { $inc: { creditVersion: 1 } }, { session });
      created.push({ number, amount, source: source.paymentNumber });
      rest -= amount;
    }
    await Commitment.updateOne({ _id: commitment._id }, { $inc: { allocationVersion: 1 } }, { session });

    const child = await Child.findById(commitment.child, { firstName: 1, lastName: 1 }).session(session).lean();
    await recordAudit(actorOf(actor, ctx), {
      action: "credit.apply",
      summary: `Affectation de ${formatXaf(data.amount)} d'avance à l'engagement de ${child ? fullName(child) : "l'enfant"} (${commitmentYear?.label ?? ""})${lateSettlement ? " — règlement tardif" : ""}.`,
      entityType: "Commitment",
      entityId: commitment._id,
      schoolYear: commitment.schoolYear,
      details: { applications: created },
    }, session);
    return created.length;
  });
}

/** Annulation d'une affectation d'avance : le crédit redevient disponible ; aucun effet sur la caisse. */
export async function cancelCreditApplication(actor: SessionUser, applicationId: string, reason: string, ctx: RequestContext): Promise<void> {
  await withTransaction(async (session) => {
    const application = await CreditApplication.findById(applicationId).session(session).lean();
    if (!application) throw new NotFoundError("Affectation introuvable.");
    if (application.status === "CANCELLED") throw new BusinessRuleError("Cette affectation est déjà annulée.");
    const day = startOfUtcDay(application.validatedAt);
    const year = await SchoolYear.findOne({ startDate: { $lte: day }, endDate: { $gte: day } }, { label: 1, status: 1 }).session(session).lean();
    if (year?.status === "CLOSED") throw new BusinessRuleError(`Cette affectation date de l'année ${year.label}, clôturée.`);

    await CreditApplication.updateOne(
      { _id: application._id, status: "VALID" },
      { $set: { status: "CANCELLED", cancellation: { reason, by: new Types.ObjectId(actor.id), at: new Date() } } },
      { session },
    );
    await Commitment.updateOne({ _id: application.commitment }, { $inc: { allocationVersion: 1 } }, { session });
    await Payment.updateOne({ _id: application.sourcePayment }, { $inc: { creditVersion: 1 } }, { session });
    await recordAudit(actorOf(actor, ctx), {
      action: "credit.cancel",
      summary: `Annulation de l'affectation ${application.number} (${formatXaf(application.amount)}) : le crédit redevient disponible.`,
      entityType: "Commitment",
      entityId: application.commitment,
      schoolYear: application.schoolYear,
      details: { reason, application: application._id },
    }, session);
  });
}
