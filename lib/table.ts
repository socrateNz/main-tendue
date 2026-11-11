import { createTableHook, metaHelper, tableFeatures } from "@tanstack/react-table";

/**
 * Configuration commune des tableaux (TanStack Table v9).
 *
 * Les listes sont paginées, triées et filtrées CÔTÉ SERVEUR (MongoDB) à partir des paramètres
 * d'URL : TanStack Table ne fait ici que le modèle de colonnes et le rendu. Le tri d'une colonne
 * est déclaré par `meta.sortKey`, qui doit figurer dans la liste blanche du module serveur.
 *
 * À importer uniquement depuis des Client Components (les colonnes contiennent des fonctions de rendu).
 */
export type AppColumnMeta = {
  /** Clé de tri envoyée dans l'URL (`?sort=`). Absente : colonne non triable. */
  sortKey?: string;
  align?: "start" | "end";
  /** Masque la colonne sous ce point de rupture pour alléger les écrans étroits. */
  hideBelow?: "sm" | "md" | "lg";
  headerClassName?: string;
  cellClassName?: string;
};

export const appTableFeatures = tableFeatures({ columnMeta: metaHelper<AppColumnMeta>() });
export type AppTableFeatures = typeof appTableFeatures;

export const { createAppColumnHelper, useAppTable } = createTableHook({
  features: appTableFeatures,
  getRowId: (row: { id: string }) => row.id,
});
