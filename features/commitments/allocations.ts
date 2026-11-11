import "server-only";

import type { ClientSession, Types } from "mongoose";

import { CreditApplication, Payment } from "@/features/contributions/model";
import { gather } from "@/lib/db/mongoose";

/**
 * Montant AFFECTÉ à des engagements (docs/modele-donnees.md § 4) :
 *   lignes COMMITMENT des versements valides + affectations d'avances valides.
 * Source unique de ce calcul : la situation des engagements, les contrôles de plafond et les
 * rapports passent tous par ici.
 */
export async function allocatedByCommitment(
  commitmentIds: readonly Types.ObjectId[],
  session?: ClientSession | null,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (commitmentIds.length === 0) return result;
  const ids = [...commitmentIds];

  const [fromPayments, fromCredits] = await gather(session, [
    () =>
      Payment.aggregate<{ _id: Types.ObjectId; total: number }>([
        { $match: { status: "VALID", "lines.commitment": { $in: ids } } },
        { $unwind: "$lines" },
        { $match: { "lines.commitment": { $in: ids } } },
        { $group: { _id: "$lines.commitment", total: { $sum: "$lines.amount" } } },
      ]).session(session ?? null),
    () =>
      CreditApplication.aggregate<{ _id: Types.ObjectId; total: number }>([
        { $match: { status: "VALID", commitment: { $in: ids } } },
        { $group: { _id: "$commitment", total: { $sum: "$amount" } } },
      ]).session(session ?? null),
  ]);

  for (const row of [...fromPayments, ...fromCredits]) {
    const key = row._id.toString();
    result.set(key, (result.get(key) ?? 0) + row.total);
  }
  return result;
}
