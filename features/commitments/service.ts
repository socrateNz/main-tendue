import "server-only";

import { type ClientSession, Types, mongo } from "mongoose";
import type { z } from "zod";

import { actorOf, type RequestContext, type SessionUser } from "@/features/auth/service";
import { Child } from "@/features/children/model";
import { allocatedByCommitment } from "@/features/commitments/allocations";
import { Commitment } from "@/features/commitments/model";
import type { adjustExpectedSchema, createCommitmentSchema, updateCommitmentSchema } from "@/features/commitments/schemas";
import { SchoolYear } from "@/features/school-years/model";
import { Sponsor } from "@/features/sponsors/model";
import { Sponsorship } from "@/features/sponsorships/model";
import { recordAudit } from "@/lib/audit";
import { withTransaction } from "@/lib/db/mongoose";
import { BusinessRuleError, ConflictError, NotFoundError } from "@/lib/errors";
import { formatXaf } from "@/lib/money";
import { fullName } from "@/lib/text";

/**
 * Engagements financiers (docs/modele-donnees.md § 4) : un engagement par parrainage.
 * Invariant : affecté ≤ attendu ≤ engagé. L'affecté est toujours recalculé en transaction.
 */

const AUDIT_ENTITY = "Commitment";

async function describe(sponsorId: Types.ObjectId, childId: Types.ObjectId, yearId: Types.ObjectId, session: ClientSession) {
  const sponsor = await Sponsor.findById(sponsorId, { displayName: 1 }).session(session).lean();
  const child = await Child.findById(childId, { firstName: 1, lastName: 1 }).session(session).lean();
  const year = await SchoolYear.findById(yearId, { label: 1, status: 1 }).session(session).lean();
  return { label: `${sponsor?.displayName ?? "?"} → ${child ? fullName(child) : "?"} (${year?.label ?? "?"})`, yearStatus: year?.status };
}

export async function createCommitment(
  actor: SessionUser,
  data: z.output<typeof createCommitmentSchema>,
  ctx: RequestContext,
): Promise<string> {
  try {
    return await withTransaction(async (session) => {
      const sponsorship = await Sponsorship.findById(data.sponsorshipId).session(session).lean();
      if (!sponsorship) throw new NotFoundError("Parrainage introuvable.");
      if (sponsorship.status === "CANCELLED") throw new BusinessRuleError("Ce parrainage est annulé.");
      const { label, yearStatus } = await describe(sponsorship.sponsor, sponsorship.child, sponsorship.schoolYear, session);
      if (yearStatus === "CLOSED") throw new BusinessRuleError("L'année est clôturée : aucun nouvel engagement n'est possible.");

      // Un engagement annulé est réactivé avec le nouveau montant (son historique reste dans l'audit).
      const cancelled = await Commitment.findOne({ sponsorship: sponsorship._id, status: "CANCELLED" }).session(session).lean();
      if (cancelled) {
        await Commitment.updateOne(
          { _id: cancelled._id },
          {
            $set: { status: "ACTIVE", committedAmount: data.committedAmount, expectedAmount: data.committedAmount, expectedAdjustments: [], notes: data.notes ?? "" },
            $unset: { cancelledAt: 1, cancelledBy: 1, cancelReason: 1 },
          },
          { session, runValidators: true },
        );
        await recordAudit(actorOf(actor, ctx), {
          action: "commitment.reactivate",
          summary: `Engagement redéfini à ${formatXaf(data.committedAmount)} : ${label}.`,
          entityType: AUDIT_ENTITY,
          entityId: cancelled._id,
          schoolYear: sponsorship.schoolYear,
          details: { previous: { committed: cancelled.committedAmount, cancelReason: cancelled.cancelReason } },
        }, session);
        return cancelled._id.toString();
      }

      const [commitment] = await Commitment.create(
        [
          {
            sponsorship: sponsorship._id,
            sponsor: sponsorship.sponsor,
            child: sponsorship.child,
            schoolYear: sponsorship.schoolYear,
            committedAmount: data.committedAmount,
            expectedAmount: data.committedAmount,
            notes: data.notes,
            createdBy: new Types.ObjectId(actor.id),
          },
        ],
        { session },
      );
      await recordAudit(actorOf(actor, ctx), {
        action: "commitment.create",
        summary: `Engagement de ${formatXaf(data.committedAmount)} : ${label}.`,
        entityType: AUDIT_ENTITY,
        entityId: commitment._id,
        schoolYear: sponsorship.schoolYear,
        details: { sponsorship: sponsorship._id, committedAmount: data.committedAmount },
      }, session);
      return commitment._id.toString();
    });
  } catch (error) {
    if (error instanceof mongo.MongoServerError && error.code === 11000) {
      throw new ConflictError("Ce parrainage a déjà un engagement : modifiez-le plutôt que d'en créer un second.");
    }
    throw error;
  }
}

/** Charge un engagement modifiable (actif, année non clôturée) et son montant déjà affecté. */
async function loadEditable(commitmentId: string, session: ClientSession) {
  const commitment = await Commitment.findById(commitmentId).session(session).lean();
  if (!commitment) throw new NotFoundError("Engagement introuvable.");
  if (commitment.status !== "ACTIVE") throw new BusinessRuleError("Cet engagement est annulé.");
  const { label, yearStatus } = await describe(commitment.sponsor, commitment.child, commitment.schoolYear, session);
  if (yearStatus === "CLOSED") throw new BusinessRuleError("L'année est clôturée : l'engagement n'est plus modifiable.");
  const allocated = (await allocatedByCommitment([commitment._id], session)).get(commitment._id.toString()) ?? 0;
  return { commitment, label, allocated };
}

/**
 * Modification du montant ENGAGÉ. Sans ajustement préalable, l'attendu suit l'engagé ; sinon
 * l'attendu est conservé (dans la limite du nouvel engagé). Jamais en dessous de l'affecté.
 */
export async function updateCommitment(actor: SessionUser, data: z.output<typeof updateCommitmentSchema>, ctx: RequestContext): Promise<void> {
  await withTransaction(async (session) => {
    const { commitment, label, allocated } = await loadEditable(data.commitmentId, session);
    if (data.committedAmount < allocated) {
      throw new BusinessRuleError(`Le montant engagé ne peut pas être inférieur au montant déjà reçu (${formatXaf(allocated)}).`, {
        committedAmount: ["Inférieur au montant déjà reçu."],
      });
    }
    const followsCommitted = commitment.expectedAdjustments.length === 0;
    const expectedAmount = followsCommitted ? data.committedAmount : Math.min(commitment.expectedAmount, data.committedAmount);
    if (expectedAmount < allocated) throw new BusinessRuleError("Le montant attendu deviendrait inférieur au montant déjà reçu.");

    await Commitment.updateOne(
      { _id: commitment._id },
      { $set: { committedAmount: data.committedAmount, expectedAmount, notes: data.notes ?? "" }, $inc: { allocationVersion: 1 } },
      { session, runValidators: true },
    );
    await recordAudit(actorOf(actor, ctx), {
      action: "commitment.update",
      summary: `Engagement modifié (${formatXaf(commitment.committedAmount)} → ${formatXaf(data.committedAmount)}) : ${label}.`,
      entityType: AUDIT_ENTITY,
      entityId: commitment._id,
      schoolYear: commitment.schoolYear,
      details: { before: { committed: commitment.committedAmount, expected: commitment.expectedAmount }, after: { committed: data.committedAmount, expected: expectedAmount } },
    }, session);
  });
}

/** Ajustement motivé du montant ATTENDU (ex. fin anticipée du parrainage) : affecté ≤ attendu ≤ engagé. */
export async function adjustExpected(actor: SessionUser, data: z.output<typeof adjustExpectedSchema>, ctx: RequestContext): Promise<void> {
  await withTransaction(async (session) => {
    const { commitment, label, allocated } = await loadEditable(data.commitmentId, session);
    if (data.expectedAmount > commitment.committedAmount) {
      throw new BusinessRuleError("Le montant attendu ne peut pas dépasser le montant engagé.", { expectedAmount: ["Supérieur au montant engagé."] });
    }
    if (data.expectedAmount < allocated) {
      throw new BusinessRuleError(`Le montant attendu ne peut pas être inférieur au montant déjà reçu (${formatXaf(allocated)}).`, {
        expectedAmount: ["Inférieur au montant déjà reçu."],
      });
    }
    if (data.expectedAmount === commitment.expectedAmount) throw new BusinessRuleError("Le montant attendu est inchangé.");

    const adjustment = { from: commitment.expectedAmount, to: data.expectedAmount, reason: data.reason, by: new Types.ObjectId(actor.id), at: new Date() };
    await Commitment.updateOne(
      { _id: commitment._id },
      { $set: { expectedAmount: data.expectedAmount }, $push: { expectedAdjustments: adjustment }, $inc: { allocationVersion: 1 } },
      { session, runValidators: true },
    );
    await recordAudit(actorOf(actor, ctx), {
      action: "commitment.adjustExpected",
      summary: `Montant attendu ajusté (${formatXaf(adjustment.from)} → ${formatXaf(adjustment.to)}) : ${label}.`,
      entityType: AUDIT_ENTITY,
      entityId: commitment._id,
      schoolYear: commitment.schoolYear,
      details: adjustment,
    }, session);
  });
}

/** Annulation : seulement si AUCUN montant n'a été affecté (sinon, annuler d'abord les versements). */
export async function cancelCommitment(actor: SessionUser, commitmentId: string, reason: string, ctx: RequestContext): Promise<void> {
  await withTransaction(async (session) => {
    const { commitment, label, allocated } = await loadEditable(commitmentId, session);
    if (allocated > 0) {
      throw new BusinessRuleError(`${formatXaf(allocated)} ont déjà été affectés à cet engagement : annulez d'abord les versements ou affectations concernés.`);
    }
    await Commitment.updateOne(
      { _id: commitment._id },
      { $set: { status: "CANCELLED", cancelledAt: new Date(), cancelledBy: new Types.ObjectId(actor.id), cancelReason: reason }, $inc: { allocationVersion: 1 } },
      { session },
    );
    await recordAudit(actorOf(actor, ctx), {
      action: "commitment.cancel",
      summary: `Annulation de l'engagement : ${label}.`,
      entityType: AUDIT_ENTITY,
      entityId: commitment._id,
      schoolYear: commitment.schoolYear,
      details: { reason },
    }, session);
  });
}
