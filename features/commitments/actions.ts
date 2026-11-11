"use server";

import { revalidatePath } from "next/cache";

import { adjustExpectedSchema, cancelCommitmentSchema, createCommitmentSchema, updateCommitmentSchema } from "@/features/commitments/schemas";
import { adjustExpected, cancelCommitment, createCommitment, updateCommitment } from "@/features/commitments/service";
import { getRequestContext, requirePermission } from "@/lib/auth/session";
import { type ActionResult, toPublicError } from "@/lib/errors";
import { zodFieldErrors } from "@/lib/validation";

/** Mutations des engagements : permission `commitments:write`, vérifiée côté serveur. */

function invalid(error: Parameters<typeof zodFieldErrors>[0]): ActionResult<never> {
  return { ok: false, code: "VALIDATION", message: "Vérifiez les champs signalés.", fieldErrors: zodFieldErrors(error) };
}

function refresh() {
  for (const path of ["/parrainages", "/sponsors", "/enfants", "/annees-scolaires", "/contributions", "/rapports", "/tableau-de-bord"]) {
    revalidatePath(path, "layout");
  }
}

async function run<T>(schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false; error: Parameters<typeof zodFieldErrors>[0] } }, input: unknown, work: (data: T) => Promise<void>, message: string): Promise<ActionResult> {
  try {
    await requirePermission("commitments:write");
    const parsed = schema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await work(parsed.data);
    refresh();
    return { ok: true, data: undefined, message };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function createCommitmentAction(input: unknown): Promise<ActionResult> {
  return run(createCommitmentSchema, input, async (data) => {
    await createCommitment(await requirePermission("commitments:write"), data, await getRequestContext());
  }, "Engagement enregistré.");
}

export async function updateCommitmentAction(input: unknown): Promise<ActionResult> {
  return run(updateCommitmentSchema, input, async (data) => updateCommitment(await requirePermission("commitments:write"), data, await getRequestContext()), "Engagement modifié.");
}

export async function adjustExpectedAction(input: unknown): Promise<ActionResult> {
  return run(adjustExpectedSchema, input, async (data) => adjustExpected(await requirePermission("commitments:write"), data, await getRequestContext()), "Montant attendu ajusté.");
}

export async function cancelCommitmentAction(input: unknown): Promise<ActionResult> {
  return run(
    cancelCommitmentSchema,
    input,
    async (data) => cancelCommitment(await requirePermission("commitments:write"), data.commitmentId, data.reason, await getRequestContext()),
    "Engagement annulé.",
  );
}
