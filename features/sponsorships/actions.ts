"use server";

import { revalidatePath } from "next/cache";

import { createSponsorshipSchema, sponsorshipTransitionSchema, updateSponsorshipSchema } from "@/features/sponsorships/schemas";
import { createSponsorship, transitionSponsorship, updateSponsorship } from "@/features/sponsorships/service";
import { getRequestContext, requirePermission } from "@/lib/auth/session";
import { type ActionResult, toPublicError } from "@/lib/errors";
import { zodFieldErrors } from "@/lib/validation";

/** Toutes les mutations exigent `sponsorships:write`, vérifié côté serveur. */

function invalid(error: Parameters<typeof zodFieldErrors>[0]): ActionResult<never> {
  return { ok: false, code: "VALIDATION", message: "Vérifiez les champs signalés.", fieldErrors: zodFieldErrors(error) };
}

/** Un parrainage apparaît dans trois vues : la liste, la fiche de l'enfant et celle du sponsor. */
function refresh() {
  revalidatePath("/parrainages");
  revalidatePath("/enfants", "layout");
  revalidatePath("/sponsors", "layout");
  revalidatePath("/annees-scolaires", "layout");
}

export async function createSponsorshipAction(input: unknown): Promise<ActionResult<{ sponsorshipId: string }>> {
  try {
    const actor = await requirePermission("sponsorships:write");
    const parsed = createSponsorshipSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const sponsorshipId = await createSponsorship(actor, parsed.data, await getRequestContext());
    refresh();
    return { ok: true, data: { sponsorshipId }, message: "Parrainage enregistré." };
  } catch (error) {
    return toPublicError(error);
  }
}

export async function updateSponsorshipAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission("sponsorships:write");
    const parsed = updateSponsorshipSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await updateSponsorship(actor, parsed.data, await getRequestContext());
    refresh();
    return { ok: true, data: undefined, message: "Parrainage mis à jour." };
  } catch (error) {
    return toPublicError(error);
  }
}

const MESSAGES = {
  suspend: "Parrainage suspendu.",
  resume: "Parrainage réactivé.",
  end: "Parrainage terminé.",
  cancel: "Parrainage annulé.",
} as const;

export async function transitionSponsorshipAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission("sponsorships:write");
    const parsed = sponsorshipTransitionSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await transitionSponsorship(actor, parsed.data, await getRequestContext());
    refresh();
    return { ok: true, data: undefined, message: MESSAGES[parsed.data.transition] };
  } catch (error) {
    return toPublicError(error);
  }
}
