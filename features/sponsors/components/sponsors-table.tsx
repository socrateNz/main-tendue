"use client";

import { Building2, ChevronRight, HandHeart, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { SponsorListItem } from "@/features/sponsors/queries";
import { SponsorStatusBadge } from "@/features/sponsors/components/sponsor-status-badge";
import { DataTable, ListFilter, ListSearch, type DataTablePagination } from "@/components/shared/data-table";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { EmptyState } from "@/components/shared/states";
import { buttonVariants } from "@/components/ui/button";
import { countryName } from "@/lib/countries";
import { createAppColumnHelper } from "@/lib/table";

export function SponsorsTable({
  rows,
  pagination,
  countries,
  activeYearLabel,
  canWrite,
  filtered,
}: {
  rows: SponsorListItem[];
  pagination: DataTablePagination;
  countries: Array<{ value: string; label: string }>;
  activeYearLabel: string | null;
  canWrite: boolean;
  filtered: boolean;
}) {
  const router = useRouter();
  const helper = createAppColumnHelper<SponsorListItem>();
  const columns = helper.columns([
    helper.accessor("name", {
      header: "Sponsor",
      meta: { sortKey: "name" },
      cell: (info) => {
        const sponsor = info.row.original;
        return (
          <div className="flex min-w-0 items-center gap-3">
            <PersonAvatar name={sponsor.name} photoUrl={sponsor.photoUrl} />
            <div className="min-w-0">
              <Link href={`/sponsors/${sponsor.id}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5 truncate font-medium hover:text-primary hover:underline">
                {sponsor.kind === "ORGANIZATION" ? <Building2 className="size-3.5 shrink-0 text-muted-foreground" aria-label="Organisation" /> : null}
                <span className="truncate">{sponsor.name}</span>
              </Link>
              <span className="text-xs text-muted-foreground tabular-nums">{sponsor.code}</span>
            </div>
          </div>
        );
      },
    }),
    helper.accessor("country", {
      header: "Pays",
      meta: { sortKey: "country", hideBelow: "md" },
      cell: (info) => (
        <span className="flex flex-col">
          <span>{countryName(info.getValue())}</span>
          {info.row.original.city ? <span className="text-xs text-muted-foreground">{info.row.original.city}</span> : null}
        </span>
      ),
    }),
    helper.accessor("email", {
      header: "Contact",
      meta: { hideBelow: "lg" },
      cell: (info) => (
        <span className="flex min-w-0 flex-col text-muted-foreground">
          {info.getValue() ? <span className="truncate">{info.getValue()}</span> : null}
          {info.row.original.phone ? <span className="text-xs">{info.row.original.phone}</span> : null}
        </span>
      ),
    }),
    helper.accessor("activeSponsorships", {
      header: activeYearLabel ? `Filleuls ${activeYearLabel}` : "Filleuls",
      meta: { align: "end" },
      cell: (info) => <span className={info.getValue() === 0 ? "text-muted-foreground" : "font-medium"}>{info.getValue()}</span>,
    }),
    helper.accessor("status", { header: "Statut", meta: { hideBelow: "sm" }, cell: (info) => <SponsorStatusBadge status={info.getValue()} /> }),
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
          <ListSearch placeholder="Nom, code, e-mail, téléphone…" className="sm:max-w-sm" />
          {canWrite ? (
            <Link href="/sponsors/nouveau" className={buttonVariants()}>
              <Plus aria-hidden />
              Nouveau sponsor
            </Link>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <ListFilter
            param="statut"
            label="Statut"
            defaultValue="ACTIVE"
            options={[
              { value: "ACTIVE", label: "Actifs" },
              { value: "INACTIVE", label: "Inactifs" },
              { value: "ARCHIVED", label: "Archivés" },
              { value: "ALL", label: "Tous" },
            ]}
          />
          <ListFilter param="type" label="Type" allLabel="Tous" options={[{ value: "PERSON", label: "Particuliers" }, { value: "ORGANIZATION", label: "Organisations" }]} />
          <ListFilter param="pays" label="Pays" allLabel="Tous" options={countries} className="col-span-2 md:col-span-1" />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        pagination={pagination}
        onRowClick={(sponsor) => router.push(`/sponsors/${sponsor.id}`)}
        emptyState={
          filtered ? (
            <EmptyState title="Aucun sponsor trouvé" description="Aucune fiche ne correspond à ces critères." />
          ) : (
            <EmptyState
              icon={HandHeart}
              title="Aucun sponsor enregistré"
              description="Les sponsors n'ont pas de compte : leur fiche sert au suivi des parrainages, des engagements et des envois."
              action={
                canWrite ? (
                  <Link href="/sponsors/nouveau" className={buttonVariants()}>
                    <Plus aria-hidden />
                    Nouveau sponsor
                  </Link>
                ) : undefined
              }
            />
          )
        }
        renderMobileItem={(sponsor) => (
          <Link href={`/sponsors/${sponsor.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-muted/50">
            <PersonAvatar name={sponsor.name} photoUrl={sponsor.photoUrl} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{sponsor.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {sponsor.code} · {countryName(sponsor.country)} · {sponsor.activeSponsorships} filleul{sponsor.activeSponsorships > 1 ? "s" : ""}
              </p>
            </div>
            {sponsor.status !== "ACTIVE" ? <SponsorStatusBadge status={sponsor.status} /> : null}
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
          </Link>
        )}
      />
    </>
  );
}
