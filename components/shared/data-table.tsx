"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Loader2, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { EmptyState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PAGE_SIZES } from "@/lib/db/pagination";
import { type AppColumnMeta, type AppTableFeatures, useAppTable } from "@/lib/table";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- URL */

/** Met à jour les paramètres de liste dans l'URL ; le Server Component recharge les données. */
function useListNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(changes: Record<string, string | null>, options: { resetPage?: boolean } = {}) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    if (options.resetPage) params.delete("page");
    const query = params.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  }

  return { searchParams, update, pending };
}

/* -------------------------------------------------------------------------- Recherche */

export function ListSearch({ placeholder = "Rechercher…", className }: { placeholder?: string; className?: string }) {
  const { searchParams, update, pending } = useListNavigation();
  const initial = searchParams.get("q") ?? "";
  const [value, setValue] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function onChange(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => update({ q: next.trim() || null }, { resetPage: true }), 350);
  }

  return (
    <div className={cn("relative w-full sm:max-w-xs", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-9 pr-8 pl-8"
      />
      {pending ? (
        <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />
      ) : value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute top-1/2 right-2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          aria-label="Effacer la recherche"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- Tableau */

const HIDE_BELOW: Record<NonNullable<AppColumnMeta["hideBelow"]>, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
};

export type DataTablePagination = { page: number; pageSize: number; total: number; pageCount: number };

export function DataTable<TData extends { id: string }>({
  columns,
  data,
  pagination,
  emptyState,
  renderMobileItem,
  onRowClick,
  className,
}: {
  /* Signature imposée par TanStack Table : la valeur de chaque colonne est typée par `helper.columns()`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: Array<ColumnDef<AppTableFeatures, TData, any>>;
  data: TData[];
  pagination?: DataTablePagination;
  emptyState?: React.ReactNode;
  /** Rendu en liste de cartes sous 768 px (évite les tableaux illisibles sur smartphone). */
  renderMobileItem?: (row: TData) => React.ReactNode;
  onRowClick?: (row: TData) => void;
  className?: string;
}) {
  const table = useAppTable({ columns, data });
  const { searchParams, update, pending } = useListNavigation();
  const sort = searchParams.get("sort");
  const dir = searchParams.get("dir") === "desc" ? "desc" : "asc";

  function toggleSort(sortKey: string) {
    const nextDir = sort === sortKey && dir === "asc" ? "desc" : "asc";
    update({ sort: sortKey, dir: nextDir }, { resetPage: true });
  }

  const rows = table.getRowModel().rows;
  const empty = rows.length === 0;

  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card shadow-card", className)}>
      <div className={cn("transition-opacity", pending && "opacity-60")} aria-busy={pending}>
        {empty ? (
          emptyState ?? <EmptyState title="Aucun résultat" description="Aucun élément ne correspond à ces critères." />
        ) : (
          <>
            {renderMobileItem ? (
              <ul className="divide-y md:hidden">
                {rows.map((row) => (
                  <li key={row.id}>{renderMobileItem(row.original)}</li>
                ))}
              </ul>
            ) : null}

            <Table className={cn(renderMobileItem && "hidden md:table")}>
              <TableHeader className="bg-muted/40">
                {table.getHeaderGroups().map((group) => (
                  <TableRow key={group.id} className="hover:bg-transparent">
                    {group.headers.map((header) => {
                      const meta = header.column.columnDef.meta;
                      const sortKey = meta?.sortKey;
                      const active = sortKey !== undefined && sort === sortKey;
                      const SortIcon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;
                      return (
                        <TableHead
                          key={header.id}
                          aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}
                          className={cn(
                            "h-10 text-xs font-medium tracking-wide text-muted-foreground uppercase",
                            meta?.align === "end" && "text-right",
                            meta?.hideBelow && HIDE_BELOW[meta.hideBelow],
                            meta?.headerClassName,
                          )}
                        >
                          {header.isPlaceholder ? null : sortKey ? (
                            <button
                              type="button"
                              onClick={() => toggleSort(sortKey)}
                              className={cn(
                                "-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 uppercase hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                                active && "text-foreground",
                              )}
                            >
                              <table.FlexRender header={header} />
                              <SortIcon className="size-3.5" aria-hidden />
                            </button>
                          ) : (
                            <table.FlexRender header={header} />
                          )}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.id}
                    onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                    className={cn(onRowClick && "cursor-pointer")}
                  >
                    {row.getAllCells().map((cell) => {
                      const meta = cell.column.columnDef.meta;
                      return (
                        <TableCell
                          key={cell.id}
                          className={cn(
                            "py-3",
                            meta?.align === "end" && "text-right tabular-nums",
                            meta?.hideBelow && HIDE_BELOW[meta.hideBelow],
                            meta?.cellClassName,
                          )}
                        >
                          <table.FlexRender cell={cell} />
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </div>

      {pagination && pagination.total > 0 ? <DataTableFooter pagination={pagination} onChange={update} /> : null}
    </div>
  );
}

function DataTableFooter({
  pagination,
  onChange,
}: {
  pagination: DataTablePagination;
  onChange: (changes: Record<string, string | null>, options?: { resetPage?: boolean }) => void;
}) {
  const { page, pageSize, total, pageCount } = pagination;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const formatter = new Intl.NumberFormat("fr-FR");

  return (
    <div className="flex flex-col gap-3 border-t px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <p className="tabular-nums">
        {formatter.format(from)}–{formatter.format(to)} sur {formatter.format(total)}
      </p>
      <div className="flex items-center gap-3">
        <label className="hidden items-center gap-2 sm:flex">
          <span>Lignes</span>
          <select
            value={pageSize}
            onChange={(event) => onChange({ pageSize: event.target.value }, { resetPage: true })}
            className="h-8 rounded-md border bg-card px-2 text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => onChange({ page: String(page - 1) })}
            disabled={page <= 1}
            aria-label="Page précédente"
          >
            <ChevronLeft />
          </Button>
          <span className="min-w-16 text-center tabular-nums">
            {page} / {pageCount}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => onChange({ page: String(page + 1) })}
            disabled={page >= pageCount}
            aria-label="Page suivante"
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Squelette de tableau (états de chargement). */
export function DataTableSkeleton({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-card" aria-busy="true" aria-label="Chargement">
      <div className="h-10 border-b bg-muted/40" />
      <div className="divide-y">
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="flex items-center gap-6 px-4 py-3.5">
            {Array.from({ length: columns }, (_, column) => (
              <div key={column} className={cn("h-4 animate-pulse rounded bg-muted", column === 0 ? "w-40" : "w-24", column > 1 && "hidden md:block")} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
