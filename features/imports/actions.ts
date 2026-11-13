"use server";

import { revalidatePath } from "next/cache";

import { analyzeImport, runImport } from "@/features/imports/service";
import { getRequestContext, requirePermission } from "@/lib/auth/session";
import { type ActionResult, toPublicError } from "@/lib/errors";

import { IMPORT_MAX_BYTES, type ImportAnalysis, type ImportResult } from "./spec";

/** Lit le fichier transmis et applique les contrôles de forme (présence, taille, extension). */
async function readFile(formData: FormData): Promise<{ buffer: Buffer; name: string } | ActionResult<never>> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, code: "VALIDATION", message: "Aucun fichier reçu." };
  if (file.size > IMPORT_MAX_BYTES) return { ok: false, code: "VALIDATION", message: `Fichier trop volumineux (${Math.round(IMPORT_MAX_BYTES / 1024 / 1024)} Mo maximum).` };
  if (!file.name.toLowerCase().endsWith(".xlsx")) return { ok: false, code: "VALIDATION", message: "Seuls les classeurs Excel .xlsx sont acceptés." };
  return { buffer: Buffer.from(await file.arrayBuffer()), name: file.name };
}

/** Analyse : aucune écriture en base. */
export async function analyzeImportAction(formData: FormData): Promise<ActionResult<ImportAnalysis>> {
  try {
    await requirePermission("data:import");
    const file = await readFile(formData);
    if ("ok" in file) return file;
    return { ok: true, data: await analyzeImport(file.buffer) };
  } catch (error) {
    return toPublicError(error);
  }
}

/** Import « tout ou rien » : le fichier est ré-analysé dans la transaction avant écriture. */
export async function runImportAction(formData: FormData): Promise<ActionResult<ImportResult>> {
  try {
    const actor = await requirePermission("data:import");
    const file = await readFile(formData);
    if ("ok" in file) return file;
    const result = await runImport(actor, file.buffer, file.name, await getRequestContext());
    for (const path of ["/enfants", "/enfants/etablissements", "/sponsors", "/parrainages", "/tableau-de-bord"]) revalidatePath(path);
    return { ok: true, data: result, message: "Import terminé." };
  } catch (error) {
    return toPublicError(error);
  }
}
