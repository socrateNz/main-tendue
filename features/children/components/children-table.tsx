"use client";

import { ChevronRight, Plus, School, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { ChildListItem } from "@/features/children/queries";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { ageOf } from "@/features/children/age";
import { SEX_LABELS } from "@/features/children/types";
import { DataTable, ListFilter, ListSearch, type DataTablePagination } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { createAppColumnHelper } from "@/lib/table";
import { fullName } from "@/lib/text";

export function ChildrenTable({
  rows,
  pagination,
  yearOptions,
  schoolOptions,
  defaultYear,
  yearLabel,
  canWrite,
  filtered,
}: {
  rows: ChildListItem[];
  pagination: DataTablePagination;
  yearOptions: Array<{ value: string; label: string }>;
  schoolOptions: Array<{ value: string; label: string }>;
  defaultYear: string;
  yearLabel: string | null;
  canWrite: boolean;
  filtered: boolean;
}) {
  const router = useRouter();
  const helper = createAppColumnHelper<ChildListItem>();
  const columns = helper.columns([
    helper.accessor((row) => fullName(row), {
      id: "name",
      header: "Enfant",
      meta: { sortKey: "name" },
      cell: (info) => {
        const child = info.row.original;
        return (
          <div className="flex min-w-0 items-center gap-3">
            <PersonAvatar name={info.getValue()} photoUrl={child.photoUrl} />
            <div className="min-w-0">
              <Link href={`/enfants/${child.id}`} className="block truncate font-medium hover:text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                {info.getValue()}
              </Link>
              <span className="text-xs text-muted-foreground tabular-nums">{child.code}</span>
            </div>
          </div>
        );
      },
    }),
    helper.accessor("birthDate", {
      header: "Âge",
      meta: { sortKey: "birthDate", hideBelow: "md" },
      cell: (info) => (
        <span className="text-muted-foreground tabular-nums">
          {ageOf(info.getValue())} ans · {SEX_LABELS[info.row.original.sex]}
        </span>
      ),
    }),
    helper.accessor("enrollment", {
      header: yearLabel ? `Scolarité ${yearLabel}` : "Scolarité",
      meta: { hideBelow: "lg" },
      cell: (info) => {
        const enrollment = info.getValue();
        return enrollment ? (
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{enrollment.schoolName}</span>
            <span className="text-xs text-muted-foreground">{enrollment.className}</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{yearLabel ? "Non renseignée" : "—"}</span>
        );
      },
    }),
    helper.accessor("status", {
      header: "Statut",
      cell: (info) => (info.getValue() === "ACTIVE" ? <StatusBadge tone="success">Actif</StatusBadge> : <StatusBadge>Archivé</StatusBadge>),
    }),
    helper.display({
      id: "go",
      header: () => <span className="sr-only">Ouvrir</span>,
      meta: { align: "end", cellClassName: "w-10" },
      cell: () => <ChevronRight className="size-4 text-muted-foreground" aria-hidden />,
    }),
  ]);

  return (
    <>
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-card sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <ListSearch placeholder="Nom, code ou tuteur…" className="sm:max-w-sm" />
          <div className="flex gap-2">
            <Link href="/enfants/etablissements" className={buttonVariants({ variant: "outline" })}>
              <School aria-hidden />
              <span className="hidden sm:inline">Établissements</span>
            </Link>
            {canWrite ? (
              <Link href="/enfants/nouveau" className={buttonVariants()}>
                <Plus aria-hidden />
                Nouvel enfant
              </Link>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <ListFilter param="annee" label="Année consultée" options={yearOptions} defaultValue={defaultYear} />
          <ListFilter param="etablissement" label="Établissement" options={schoolOptions} allLabel="Tous" />
          <ListFilter
            param="statut"
            label="Statut"
            defaultValue="ACTIVE"
            options={[
              { value: "ACTIVE", label: "Actifs" },
              { value: "ARCHIVED", label: "Archivés" },
              { value: "ALL", label: "Tous" },
            ]}
          />
          <ListFilter param="sexe" label="Sexe" allLabel="Tous" options={[{ value: "F", label: "Filles" }, { value: "M", label: "Garçons" }]} />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        pagination={pagination}
        onRowClick={(child) => router.push(`/enfants/${child.id}`)}
        emptyState={
          filtered ? (
            <EmptyState title="Aucun enfant trouvé" description="Aucune fiche ne correspond à ces critères. Modifiez la recherche ou les filtres." />
          ) : (
            <EmptyState
              icon={Users}
              title="Aucun enfant enregistré"
              description="Créez la fiche du premier enfant bénéficiaire du programme."
              action={
                canWrite ? (
                  <Link href="/enfants/nouveau" className={buttonVariants()}>
                    <Plus aria-hidden />
                    Nouvel enfant
                  </Link>
                ) : undefined
              }
            />
          )
        }
        renderMobileItem={(child) => (
          <Link href={`/enfants/${child.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-muted/50">
            <PersonAvatar name={fullName(child)} photoUrl={child.photoUrl} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{fullName(child)}</p>
              <p className="truncate text-xs text-muted-foreground">
                {child.code} · {ageOf(child.birthDate)} ans
                {child.enrollment ? ` · ${child.enrollment.className}, ${child.enrollment.schoolName}` : ""}
              </p>
            </div>
            {child.status === "ARCHIVED" ? <StatusBadge>Archivé</StatusBadge> : null}
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
          </Link>
        )}
      />
    </>
  );
}
