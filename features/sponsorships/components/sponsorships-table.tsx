"use client";

import { ArrowRight, HandHeart, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import type { SponsorshipView } from "@/features/sponsorships/queries";
import { SponsorshipActions } from "@/features/sponsorships/components/sponsorship-actions";
import { SponsorshipDialog, type YearWithPeriod } from "@/features/sponsorships/components/sponsorship-dialog";
import { SponsorshipStatusBadge } from "@/features/sponsorships/components/sponsorship-status-badge";
import { DataTable, ListFilter, ListSearch, type DataTablePagination } from "@/components/shared/data-table";
import { Money } from "@/components/shared/money";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { EmptyState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { formatShortDate } from "@/lib/dates";
import { createAppColumnHelper } from "@/lib/table";

export function SponsorshipsTable({
  rows,
  pagination,
  years,
  defaultYear,
  canWrite,
  canSeeFinance,
  canManageCommitment,
  filtered,
}: {
  rows: SponsorshipView[];
  pagination: DataTablePagination;
  years: YearWithPeriod[];
  defaultYear: string;
  canWrite: boolean;
  canSeeFinance: boolean;
  canManageCommitment: boolean;
  filtered: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SponsorshipView | null>(null);

  const helper = createAppColumnHelper<SponsorshipView>();
  const party = (person: SponsorshipView["sponsor"], href: string) => (
    <div className="flex min-w-0 items-center gap-2.5">
      <PersonAvatar name={person.name} photoUrl={person.photoUrl} size={30} />
      <div className="min-w-0">
        <Link href={href} className="block truncate font-medium hover:text-primary hover:underline">
          {person.name}
        </Link>
        <span className="text-xs text-muted-foreground tabular-nums">{person.code}</span>
      </div>
    </div>
  );
  const columns = helper.columns([
    helper.accessor("sponsor", { header: "Sponsor", cell: (info) => party(info.getValue(), `/sponsors/${info.getValue().id}`) }),
    helper.display({ id: "arrow", header: () => null, meta: { hideBelow: "lg", cellClassName: "w-6 px-0" }, cell: () => <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden /> }),
    helper.accessor("child", { header: "Enfant", cell: (info) => party(info.getValue(), `/enfants/${info.getValue().id}`) }),
    helper.accessor("startDate", {
      header: "Période",
      meta: { sortKey: "startDate", hideBelow: "md" },
      cell: (info) => (
        <span className="flex flex-col text-muted-foreground tabular-nums">
          <span>{info.row.original.year.label}</span>
          <span className="text-xs">
            {formatShortDate(info.getValue())}
            {info.row.original.endDate ? ` → ${formatShortDate(info.row.original.endDate)}` : " → en cours"}
          </span>
        </span>
      ),
    }),
    ...(canSeeFinance
      ? [
          helper.accessor("commitment", {
            header: "Engagement",
            meta: { align: "end", hideBelow: "lg" },
            cell: (info) => {
              const commitment = info.getValue();
              return commitment && commitment.status === "ACTIVE" ? <Money amount={commitment.committedAmount} /> : <span className="text-xs text-muted-foreground">Non défini</span>;
            },
          }),
        ]
      : []),
    helper.accessor("status", { header: "Statut", cell: (info) => <SponsorshipStatusBadge status={info.getValue()} /> }),
    ...(canWrite || canManageCommitment
      ? [
          helper.display({
            id: "actions",
            header: () => <span className="sr-only">Actions</span>,
            meta: { align: "end", cellClassName: "w-12" },
            cell: (info) => (
              <SponsorshipActions sponsorship={info.row.original} onEdit={() => setEditing(info.row.original)} canWrite={canWrite} canManageCommitment={canManageCommitment} />
            ),
          }),
        ]
      : []),
  ]);

  return (
    <>
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-card sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <ListSearch placeholder="Sponsor ou enfant…" className="sm:max-w-sm" />
          {canWrite ? (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              Nouveau parrainage
            </Button>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3 md:max-w-lg">
          <ListFilter
            param="annee"
            label="Année scolaire"
            defaultValue={defaultYear}
            options={[...years.map((y) => ({ value: y.id, label: `${y.label}${y.current ? " (active)" : ""}` })), { value: "all", label: "Toutes" }]}
          />
          <ListFilter
            param="statut"
            label="Statut"
            allLabel="Tous"
            options={[
              { value: "ACTIVE", label: "Actifs" },
              { value: "SUSPENDED", label: "Suspendus" },
              { value: "ENDED", label: "Terminés" },
              { value: "CANCELLED", label: "Annulés" },
            ]}
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        pagination={pagination}
        emptyState={
          filtered ? (
            <EmptyState title="Aucun parrainage trouvé" description="Aucun parrainage ne correspond à ces critères." />
          ) : (
            <EmptyState
              icon={HandHeart}
              title="Aucun parrainage pour cette année"
              description="Associez un sponsor à un enfant pour l'année scolaire : un sponsor peut parrainer plusieurs enfants, un enfant avoir plusieurs sponsors."
              action={
                canWrite ? (
                  <Button onClick={() => setCreating(true)}>
                    <Plus aria-hidden />
                    Nouveau parrainage
                  </Button>
                ) : undefined
              }
            />
          )
        }
        renderMobileItem={(row) => (
          <div className="flex items-start gap-3 px-4 py-3">
            <div className="min-w-0 flex-1 space-y-1">
              <p className="truncate text-sm">
                <Link href={`/sponsors/${row.sponsor.id}`} className="font-medium hover:underline">
                  {row.sponsor.name}
                </Link>{" "}
                <span className="text-muted-foreground">→</span>{" "}
                <Link href={`/enfants/${row.child.id}`} className="font-medium hover:underline">
                  {row.child.name}
                </Link>
              </p>
              <p className="text-xs text-muted-foreground">
                {row.year.label} · depuis le {formatShortDate(row.startDate)}
              </p>
              <SponsorshipStatusBadge status={row.status} />
            </div>
            {canWrite || canManageCommitment ? (
              <SponsorshipActions sponsorship={row} onEdit={() => setEditing(row)} canWrite={canWrite} canManageCommitment={canManageCommitment} />
            ) : null}
          </div>
        )}
      />

      {creating ? <SponsorshipDialog open onOpenChange={setCreating} years={years} /> : null}
      {editing ? <SponsorshipDialog key={editing.id} open onOpenChange={(open) => !open && setEditing(null)} years={years} sponsorship={editing} /> : null}
    </>
  );
}
