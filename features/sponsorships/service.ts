import "server-only";

import { Types, mongo } from "mongoose";

import { actorOf, type RequestContext, type SessionUser } from "@/features/auth/service";
import { Child } from "@/features/children/model";
import { Commitment } from "@/features/commitments/model";
import { SchoolYear } from "@/features/school-years/model";
import { Sponsor } from "@/features/sponsors/model";
import { Sponsorship } from "@/features/sponsorships/model";
import { recordAudit } from "@/lib/audit";
import { formatDate, isWithinPeriod, parseDateInput } from "@/lib/dates";
import { withTransaction } from "@/lib/db/mongoose";
import { BusinessRuleError, ConflictError, NotFoundError } from "@/lib/errors";
import { fullName } from "@/lib/text";

import type { CreateSponsorshipData, SponsorshipTransitionData, UpdateSponsorshipData } from "./schemas";
import { SPONSORSHIP_STATUS_LABELS, type SponsorshipStatus } from "./types";

/**
 * Parrainages : associations sponsor × enfant × année scolaire (docs/modele-donnees.md § 4).
 * Les permissions sont vérifiées par les Server Actions appelantes.
 */

const AUDIT_ENTITY = "Sponsorship";

function day(value: string): Date {
  const date = parseDateInput(value);
  if (!date) throw new BusinessRuleError("Date invalide.");
  return date;
}

function assertWithinYear(date: Date, year: { label: string; startDate: Date; endDate: Date }, field: string) {
  if (!isWithinPeriod(date, year.startDate, year.endDate)) {
    throw new BusinessRuleError(
      `La date doit être comprise dans l'année ${year.label} (${formatDate(year.startDate)} – ${formatDate(year.endDate)}).`,
      { [field]: ["Hors de la période de l'année scolaire."] },
    );
  }
}

/** Libellé lisible d'un parrainage pour l'audit. */
function describe(sponsorName: string, childName: string, yearLabel: string) {
  return `${sponsorName} → ${childName} (${yearLabel})`;
}

export async function createSponsorship(actor: SessionUser, data: CreateSponsorshipData, ctx: RequestContext): Promise<string> {
  const startDate = day(data.startDate);
  const endDate = data.endDate ? day(data.endDate) : undefined;
  try {
    return await withTransaction(async (session) => {
      const sponsor = await Sponsor.findById(data.sponsorId, { displayName: 1, status: 1 }).session(session).lean();
      const child = await Child.findById(data.childId, { firstName: 1, lastName: 1, status: 1 }).session(session).lean();
      const year = await SchoolYear.findById(data.schoolYearId, { label: 1, status: 1, startDate: 1, endDate: 1 }).session(session).lean();
      if (!sponsor) throw new NotFoundError("Sponsor introuvable.");
      if (!child) throw new NotFoundError("Enfant introuvable.");
      if (!year) throw new NotFoundError("Année scolaire introuvable.");
      if (sponsor.status !== "ACTIVE") throw new BusinessRuleError(`Le sponsor ${sponsor.displayName} n'est pas actif.`);
      if (child.status !== "ACTIVE") throw new BusinessRuleError(`La fiche de ${fullName(child)} est archivée.`);
      if (year.status === "CLOSED") throw new BusinessRuleError(`L'année ${year.label} est clôturée.`);
      assertWithinYear(startDate, year, "startDate");
      if (endDate) assertWithinYear(endDate, year, "endDate");

      const existing = await Sponsorship.findOne({ sponsor: sponsor._id, child: child._id, schoolYear: year._id }, { status: 1 })
        .session(session)
        .lean();
      if (existing) {
        throw new ConflictError(
          existing.status === "CANCELLED"
            ? "Un parrainage annulé existe déjà pour ce sponsor, cet enfant et cette année : réactivez-le plutôt que d'en créer un nouveau."
            : `Ce sponsor parraine déjà cet enfant pour l'année ${year.label} (${SPONSORSHIP_STATUS_LABELS[existing.status].toLowerCase()}).`,
        );
      }

      const [sponsorship] = await Sponsorship.create(
        [{ sponsor: sponsor._id, child: child._id, schoolYear: year._id, startDate, endDate, notes: data.notes, createdBy: new Types.ObjectId(actor.id) }],
        { session },
      );
      await recordAudit(actorOf(actor, ctx), {
        action: "sponsorship.create",
        summary: `Nouveau parrainage : ${describe(sponsor.displayName, fullName(child), year.label)}.`,
        entityType: AUDIT_ENTITY,
        entityId: sponsorship._id,
        schoolYear: year._id,
        details: { sponsor: sponsor._id, child: child._id },
      }, session);
      return sponsorship._id.toString();
    });
  } catch (error) {
    if (error instanceof mongo.MongoServerError && error.code === 11000) {
      throw new ConflictError("Ce parrainage existe déjà pour cette année.");
    }
    throw error;
  }
}

/** Charge un parrainage avec son contexte et vérifie qu'il reste modifiable. */
async function loadEditable(sponsorshipId: string, session: mongo.ClientSession) {
  const sponsorship = await Sponsorship.findById(sponsorshipId).session(session).lean();
  if (!sponsorship) throw new NotFoundError("Parrainage introuvable.");
  const year = await SchoolYear.findById(sponsorship.schoolYear, { label: 1, status: 1, startDate: 1, endDate: 1 }).session(session).lean();
  const sponsor = await Sponsor.findById(sponsorship.sponsor, { displayName: 1, status: 1 }).session(session).lean();
  const child = await Child.findById(sponsorship.child, { firstName: 1, lastName: 1, status: 1 }).session(session).lean();
  if (!year || !sponsor || !child) throw new NotFoundError("Données du parrainage incomplètes.");
  if (year.status === "CLOSED") throw new BusinessRuleError(`L'année ${year.label} est clôturée : ses parrainages ne sont plus modifiables.`);
  return { sponsorship, year, sponsor, child, label: describe(sponsor.displayName, fullName(child), year.label) };
}

export async function updateSponsorship(actor: SessionUser, data: UpdateSponsorshipData, ctx: RequestContext): Promise<void> {
  const startDate = day(data.startDate);
  const endDate = data.endDate ? day(data.endDate) : undefined;
  await withTransaction(async (session) => {
    const { sponsorship, year, label } = await loadEditable(data.sponsorshipId, session);
    if (sponsorship.status === "CANCELLED") throw new BusinessRuleError("Un parrainage annulé n'est pas modifiable.");
    assertWithinYear(startDate, year, "startDate");
    if (endDate) assertWithinYear(endDate, year, "endDate");
    if (sponsorship.status === "ENDED" && !endDate) {
      throw new BusinessRuleError("Un parrainage terminé doit conserver sa date de fin.", { endDate: ["Obligatoire."] });
    }
    const set: Record<string, unknown> = { startDate };
    const unset: Record<string, 1> = {};
    if (endDate) set.endDate = endDate;
    else unset.endDate = 1;
    if (data.notes) set.notes = data.notes;
    else unset.notes = 1;
    await Sponsorship.updateOne({ _id: sponsorship._id }, { $set: set, $unset: unset }, { session, runValidators: true });
    await recordAudit(actorOf(actor, ctx), {
      action: "sponsorship.update",
      summary: `Modification du parrainage ${label}.`,
      entityType: AUDIT_ENTITY,
      entityId: sponsorship._id,
      schoolYear: year._id,
      details: { before: { startDate: sponsorship.startDate, endDate: sponsorship.endDate }, after: { startDate, endDate } },
    }, session);
  });
}

const ALLOWED_FROM: Record<SponsorshipTransitionData["transition"], SponsorshipStatus[]> = {
  suspend: ["ACTIVE"],
  resume: ["SUSPENDED", "ENDED", "CANCELLED"],
  end: ["ACTIVE", "SUSPENDED"],
  cancel: ["ACTIVE", "SUSPENDED", "ENDED"],
};

const TARGET: Record<SponsorshipTransitionData["transition"], SponsorshipStatus> = {
  suspend: "SUSPENDED",
  resume: "ACTIVE",
  end: "ENDED",
  cancel: "CANCELLED",
};

/**
 * Cycle de vie : suspendre, reprendre, terminer (avec date de fin), annuler (créé par erreur).
 * L'annulation est refusée tant qu'un engagement financier actif est rattaché au parrainage.
 */
export async function transitionSponsorship(actor: SessionUser, data: SponsorshipTransitionData, ctx: RequestContext): Promise<void> {
  await withTransaction(async (session) => {
    const { sponsorship, year, sponsor, child, label } = await loadEditable(data.sponsorshipId, session);
    if (!ALLOWED_FROM[data.transition].includes(sponsorship.status)) {
      throw new BusinessRuleError(`Opération impossible sur un parrainage « ${SPONSORSHIP_STATUS_LABELS[sponsorship.status]} ».`);
    }
    const target = TARGET[data.transition];
    const set: Record<string, unknown> = { status: target };
    const unset: Record<string, 1> = {};

    if (data.transition === "resume") {
      if (sponsor.status !== "ACTIVE") throw new BusinessRuleError(`Le sponsor ${sponsor.displayName} n'est pas actif.`);
      if (child.status !== "ACTIVE") throw new BusinessRuleError(`La fiche de ${fullName(child)} est archivée.`);
      unset.endDate = 1;
      unset.endReason = 1;
    }
    if (data.transition === "end") {
      const endDate = day(data.endDate ?? "");
      assertWithinYear(endDate, year, "endDate");
      if (endDate < sponsorship.startDate) throw new BusinessRuleError("La fin ne peut pas précéder le début du parrainage.", { endDate: ["Avant le début."] });
      set.endDate = endDate;
      set.endReason = data.reason;
    }
    if (data.transition === "suspend" || data.transition === "cancel") set.endReason = data.reason;
    if (data.transition === "cancel") {
      const commitment = await Commitment.exists({ sponsorship: sponsorship._id, status: "ACTIVE" }).session(session);
      if (commitment) throw new BusinessRuleError("Ce parrainage porte un engagement financier actif : annulez d'abord l'engagement.");
    }

    await Sponsorship.updateOne({ _id: sponsorship._id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { session });
    await recordAudit(actorOf(actor, ctx), {
      action: `sponsorship.${data.transition}`,
      summary: `Parrainage ${label} : ${SPONSORSHIP_STATUS_LABELS[sponsorship.status]} → ${SPONSORSHIP_STATUS_LABELS[target]}.`,
      entityType: AUDIT_ENTITY,
      entityId: sponsorship._id,
      schoolYear: year._id,
      details: { from: sponsorship.status, to: target, reason: data.reason, endDate: data.endDate },
    }, session);
  });
}
