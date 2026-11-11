"use client";

import { ChevronRight, Plus, Receipt, Tags } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { ExpenseListItem } from "@/features/expenses/queries";
import { EXPENSE_SCOPES, EXPENSE_SCOPE_LABELS } from "@/features/expenses/types";
import { DataTable, ListFilter, ListSearch, type DataTablePagination } from "@/components/shared/data-table";
import { Money } from "@/components/shared/money";
import { EmptyState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { formatShortDate } from "@/lib/dates";
import { createAppColumnHelper } from "@/lib/table";

export function ExpensesTable({
  rows,
  pagination,
  years,
  defaultYear,
  categories,
  canWrite,
  canManageCategories,
  filtered,
}: {
  rows: ExpenseListItem[];
  pagination: DataTablePagination;
  years: Array<{ value: string; label: string }>;
  defaultYear: string;
  categories: Array<{ value: string; label: string }>;
  canWrite: boolean;
  canManageCategories: boolean;
  filtered: boolean;
}) {
  const router = useRouter();
  const helper = createAppColumnHelper<ExpenseListItem>();
  const columns = helper.columns([
    helper.accessor("number", {
      header: "Dépense",
      meta: { sortKey: "number" },
      cell: (info) => (
        <span className="flex flex-col">
          <Link href={`/depenses/${info.row.original.id}`} onClick={(e) => e.stopPropagation()} className="font-medium tabular-nums hover:text-primary hover:underline">
            {info.getValue()}
          </Link>
          <span className="text-xs text-muted-foreground">{formatShortDate(info.row.original.spentAt)}</span>
        </span>
      ),
    }),
    helper.accessor("description", {
      header: "Objet",
      cell: (info) => (
        <span className="flex min-w-0 flex-col">
          <span className="line-clamp-1">{info.getValue()}</span>
          <span className="text-xs text-muted-foreground">{info.row.original.categoryName}</span>
        </span>
      ),
    }),
    helper.accessor("scope", {
      header: "Portée",
      meta: { hideBelow: "md" },
      cell: (info) => (
        <span className="text-muted-foreground">
          {EXPENSE_SCOPE_LABELS[info.getValue()]}
          {info.row.original.childrenCount > 1 ? ` · ${info.row.original.childrenCount} enfants` : ""}
        </span>
      ),
    }),
    helper.accessor("amount", {
      header: "Montant",
      meta: { align: "end", sortKey: "amount" },
      cell: (info) => <Money amount={info.getValue()} className={info.row.original.status === "CANCELLED" ? "text-muted-foreground line-through" : "font-medium"} />,
    }),
    helper.accessor("status", {
      header: "Statut",
      meta: { hideBelow: "sm" },
      cell: (info) => (info.getValue() === "VALID" ? <StatusBadge tone="success">Validée</StatusBadge> : <StatusBadge tone="danger">Annulée</StatusBadge>),
    }),
    helper.display({ id: "go", header: () => <span className="sr-only">Ouvrir</span>, meta: { align: "end", cellClassName: "w-10" }, cell: () => <ChevronRight className="size-4 text-muted-foreground" aria-hidden /> }),
  ]);

  return (
    <>
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-card sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <ListSearch placeholder="Objet, n° de dépense, enfant…" className="sm:max-w-sm" />
          <div className="flex gap-2">
            {canManageCategories ? (
              <Link href="/depenses/categories" className={buttonVariants({ variant: "outline" })}>
                <Tags aria-hidden />
                <span className="hidden sm:inline">Catégories</span>
              </Link>
            ) : null}
            {canWrite ? (
              <Link href="/depenses/nouvelle" className={buttonVariants()}>
                <Plus aria-hidden />
                Nouvelle dépense
              </Link>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <ListFilter param="annee" label="Année du mouvement" defaultValue={defaultYear} options={years} />
          <ListFilter param="categorie" label="Catégorie" allLabel="Toutes" options={categories} />
          <ListFilter param="portee" label="Portée" allLabel="Toutes" options={EXPENSE_SCOPES.map((s) => ({ value: s, label: EXPENSE_SCOPE_LABELS[s] }))} />
          <ListFilter param="statut" label="Statut" allLabel="Tous" options={[{ value: "VALID", label: "Validées" }, { value: "CANCELLED", label: "Annulées" }]} />
        </div>
      </div>
      <DataTable
        columns={columns}
        data={rows}
        pagination={pagination}
        onRowClick={(row) => router.push(`/depenses/${row.id}`)}
        emptyState={
          filtered ? (
            <EmptyState title="Aucune dépense trouvée" description="Aucune dépense ne correspond à ces critères." />
          ) : (
            <EmptyState
              icon={Receipt}
              title="Aucune dépense"
              description="Enregistrez les dépenses de la caisse centrale : générales, individuelles ou collectives."
              action={
                canWrite ? (
                  <Link href="/depenses/nouvelle" className={buttonVariants()}>
                    <Plus aria-hidden />
                    Nouvelle dépense
                  </Link>
                ) : undefined
              }
            />
          )
        }
        renderMobileItem={(row) => (
          <Link href={`/depenses/${row.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-muted/50">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{row.description}</p>
              <p className="truncate text-xs text-muted-foreground">
                {row.number} · {formatShortDate(row.spentAt)} · {row.categoryName}
              </p>
            </div>
            <Money amount={row.amount} className={row.status === "CANCELLED" ? "text-sm text-muted-foreground line-through" : "text-sm font-medium"} />
          </Link>
        )}
      />
    </>
  );
}
