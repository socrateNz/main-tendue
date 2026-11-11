"use client";

import { ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import type { SchoolYearListItem } from "@/features/school-years/queries";
import { YearFormDialog } from "@/features/school-years/components/year-form-dialog";
import { YearStatusBadge } from "@/features/school-years/components/year-status-badge";
import { DataTable } from "@/components/shared/data-table";
import { Money } from "@/components/shared/money";
import { EmptyState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { formatPeriod } from "@/lib/dates";
import { createAppColumnHelper } from "@/lib/table";

export function SchoolYearsTable({
  years,
  canManage,
  canSeeFinance,
  includeArchived,
  archivedCount,
}: {
  years: SchoolYearListItem[];
  canManage: boolean;
  canSeeFinance: boolean;
  includeArchived: boolean;
  archivedCount: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [creating, setCreating] = useState(false);

  function toggleArchived(checked: boolean) {
    const params = new URLSearchParams(searchParams.toString());
    if (checked) params.set("archivees", "1");
    else params.delete("archivees");
    router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
  }

  const helper = createAppColumnHelper<SchoolYearListItem>();
  const columns = helper.columns([
    helper.accessor("label", {
      header: "Année",
      cell: (info) => (
        <Link href={`/annees-scolaires/${info.row.original.id}`} className="font-medium hover:text-primary hover:underline">
          {info.getValue()}
        </Link>
      ),
    }),
    helper.accessor("startDate", {
      header: "Période",
      meta: { hideBelow: "md" },
      cell: (info) => <span className="text-muted-foreground tabular-nums">{formatPeriod(info.getValue(), info.row.original.endDate)}</span>,
    }),
    helper.accessor("status", {
      header: "Statut",
      cell: (info) => <YearStatusBadge status={info.getValue()} archived={info.row.original.archived} />,
    }),
    helper.accessor("sponsorships", {
      header: "Parrainages",
      meta: { align: "end", hideBelow: "lg" },
      cell: (info) => <span className="text-muted-foreground">{info.getValue()}</span>,
    }),
    ...(canSeeFinance
      ? [
          helper.accessor((row) => row.figures.openingBalance, {
            id: "opening",
            header: "Ouverture",
            meta: { align: "end", hideBelow: "lg" },
            cell: (info) => <Money amount={info.getValue()} className="text-muted-foreground" />,
          }),
          helper.accessor((row) => row.figures.closingBalance, {
            id: "closing",
            header: "Solde",
            meta: { align: "end" },
            cell: (info) => (
              <span className="inline-flex flex-col items-end">
                <Money amount={info.getValue()} className="font-medium" />
                <span className="text-[11px] text-muted-foreground">{info.row.original.source === "snapshot" ? "à la clôture" : "en cours"}</span>
              </span>
            ),
          }),
        ]
      : []),
    helper.display({
      id: "go",
      header: () => <span className="sr-only">Ouvrir</span>,
      meta: { align: "end", cellClassName: "w-10" },
      cell: () => <ChevronRight className="size-4 text-muted-foreground" aria-hidden />,
    }),
  ]);

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={includeArchived} onCheckedChange={toggleArchived} disabled={archivedCount === 0 && !includeArchived} />
          Afficher les années archivées{archivedCount > 0 ? ` (${archivedCount})` : ""}
        </label>
        {canManage ? (
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            Nouvelle année
          </Button>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        data={years}
        onRowClick={(year) => router.push(`/annees-scolaires/${year.id}`)}
        emptyState={
          <EmptyState
            title="Aucune année scolaire"
            description="Créez la première année scolaire : elle portera le solde initial de la caisse."
            action={
              canManage ? (
                <Button onClick={() => setCreating(true)}>
                  <Plus aria-hidden />
                  Nouvelle année
                </Button>
              ) : undefined
            }
          />
        }
        renderMobileItem={(year) => (
          <Link href={`/annees-scolaires/${year.id}`} className="flex items-center gap-3 px-4 py-3.5 active:bg-muted/50">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{year.label}</span>
                <YearStatusBadge status={year.status} archived={year.archived} />
              </div>
              <p className="text-xs text-muted-foreground tabular-nums">{formatPeriod(year.startDate, year.endDate)}</p>
              {canSeeFinance ? (
                <p className="text-xs text-muted-foreground">
                  Solde {year.source === "snapshot" ? "à la clôture" : "en cours"} :{" "}
                  <Money amount={year.figures.closingBalance} className="font-medium text-foreground" />
                </p>
              ) : null}
            </div>
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
          </Link>
        )}
      />

      {canManage ? <YearFormDialog open={creating} onOpenChange={setCreating} /> : null}
    </>
  );
}
