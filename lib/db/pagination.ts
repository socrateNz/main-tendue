import { z } from "zod";

/**
 * Paramètres de liste (pagination, recherche, tri) lus depuis l'URL et validés.
 * Le tri est restreint à une liste blanche de champs fournie par chaque module : un paramètre d'URL
 * ne peut jamais servir à trier (ni filtrer) sur un champ arbitraire.
 */

export const PAGE_SIZES = [10, 20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 20;

export type SortDirection = "asc" | "desc";

export type ListParams<TSort extends string> = {
  page: number;
  pageSize: number;
  q: string;
  sort: TSort;
  dir: SortDirection;
};

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseListParams<const TSort extends string>(
  searchParams: RawSearchParams,
  options: { sortable: readonly [TSort, ...TSort[]]; defaultSort: TSort; defaultDir?: SortDirection },
): ListParams<TSort> {
  const schema = z.object({
    page: z.coerce.number().int().min(1).max(100_000).catch(1),
    pageSize: z.coerce
      .number()
      .int()
      .refine((n) => (PAGE_SIZES as readonly number[]).includes(n))
      .catch(DEFAULT_PAGE_SIZE),
    q: z.string().trim().max(100).catch(""),
    sort: z.enum(options.sortable).catch(options.defaultSort),
    dir: z.enum(["asc", "desc"]).catch(options.defaultDir ?? "asc"),
  });

  return schema.parse({
    page: first(searchParams.page) ?? 1,
    pageSize: first(searchParams.pageSize) ?? DEFAULT_PAGE_SIZE,
    q: first(searchParams.q) ?? "",
    sort: first(searchParams.sort) ?? options.defaultSort,
    dir: first(searchParams.dir) ?? options.defaultDir ?? "asc",
  });
}

/** Échappe une saisie utilisateur avant de l'utiliser dans une expression régulière MongoDB. */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Filtre de recherche « tous les mots » sur un champ normalisé (sans accents, minuscules) :
 * « rotary geneve » trouve « Rotary Club de Genève ». Chaque mot est échappé (aucune regex utilisateur).
 * À fusionner dans la requête : `{ ...query, ...searchFilter(q) }`.
 */
export function searchFilter(q: string, field = "searchText", normalize: (value: string) => string = (v) => v): Record<string, unknown> {
  const words = normalize(q).split(/\s+/).filter(Boolean).slice(0, 8);
  if (words.length === 0) return {};
  return { $and: words.map((word) => ({ [field]: { $regex: escapeRegex(word) } })) };
}

export function toPaginated<T>(items: T[], total: number, params: { page: number; pageSize: number }): Paginated<T> {
  return {
    items,
    total,
    page: params.page,
    pageSize: params.pageSize,
    pageCount: Math.max(1, Math.ceil(total / params.pageSize)),
  };
}
