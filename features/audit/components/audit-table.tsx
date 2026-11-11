"use client";

import { ScrollText } from "lucide-react";

import type { AuditItem } from "@/features/audit/queries";
import { DataTable, ListFilter, ListSearch, type DataTablePagination } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDateTime } from "@/lib/dates";
import { createAppColumnHelper } from "@/lib/table";

export function AuditTable({ rows, pagination, domains }: { rows: AuditItem[]; pagination: DataTablePagination; domains: Array<{ value: string; label: string }> }) {
  const helper = createAppColumnHelper<AuditItem>();
  const columns = helper.columns([
    helper.accessor("at", {
      header: "Date",
      meta: { sortKey: "at", cellClassName: "whitespace-nowrap" },
      cell: (info) => <span className="text-muted-foreground tabular-nums">{formatDateTime(info.getValue())}</span>,
    }),
    helper.accessor("domain", { header: "Domaine", meta: { hideBelow: "md" }, cell: (info) => <StatusBadge>{info.getValue()}</StatusBadge> }),
    helper.accessor("summary", { header: "Opération", cell: (info) => <span className="line-clamp-2">{info.getValue()}</span> }),
    helper.accessor("actor", {
      header: "Auteur",
      meta: { hideBelow: "lg" },
      cell: (info) => (
        <span className="flex flex-col">
          <span>{info.getValue()}</span>
          {info.row.original.ip ? <span className="text-xs text-muted-foreground">{info.row.original.ip}</span> : null}
        </span>
      ),
    }),
  ]);
  return (
    <>
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-card sm:flex-row sm:items-end sm:p-4">
        <ListSearch placeholder="Rechercher dans les opérations…" className="sm:max-w-sm" />
        <ListFilter param="domaine" label="Domaine" allLabel="Tous" options={domains} className="sm:w-56" />
      </div>
      <DataTable
        columns={columns}
        data={rows}
        pagination={pagination}
        emptyState={<EmptyState icon={ScrollText} title="Aucune opération" description="Aucune entrée ne correspond à ces critères." />}
        renderMobileItem={(row) => (
          <div className="space-y-0.5 px-4 py-3 text-sm">
            <p>{row.summary}</p>
            <p className="text-xs text-muted-foreground">
              {formatDateTime(row.at)} · {row.actor}
            </p>
          </div>
        )}
      />
    </>
  );
}
