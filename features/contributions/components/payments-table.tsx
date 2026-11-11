"use client";

import { Banknote, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { PaymentListItem } from "@/features/contributions/queries";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/features/contributions/types";
import { DataTable, ListFilter, ListSearch, type DataTablePagination } from "@/components/shared/data-table";
import { Money } from "@/components/shared/money";
import { EmptyState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { formatShortDate } from "@/lib/dates";
import { formatMinor } from "@/lib/money";
import { createAppColumnHelper } from "@/lib/table";

export function PaymentsTable({
  rows,
  pagination,
  years,
  defaultYear,
  canWrite,
  filtered,
  compact = false,
}: {
  rows: PaymentListItem[];
  pagination?: DataTablePagination;
  years?: Array<{ value: string; label: string }>;
  defaultYear?: string;
  canWrite: boolean;
  filtered: boolean;
  /** Version allégée (fiche sponsor) : sans filtres. */
  compact?: boolean;
}) {
  const router = useRouter();
  const helper = createAppColumnHelper<PaymentListItem>();
  const columns = helper.columns([
    helper.accessor("number", {
      header: "Versement",
      meta: { sortKey: compact ? undefined : "number" },
      cell: (info) => (
        <span className="flex flex-col">
          <Link href={`/contributions/${info.row.original.id}`} className="font-medium tabular-nums hover:text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
            {info.getValue()}
          </Link>
          <span className="text-xs text-muted-foreground">{formatShortDate(info.row.original.receivedAt)}</span>
        </span>
      ),
    }),
    ...(compact
      ? []
      : [
          helper.accessor("sponsor", {
            header: "Sponsor",
            cell: (info) => <span className="font-medium">{info.getValue().name}</span>,
          }),
        ]),
    helper.accessor("method", {
      header: "Moyen",
      meta: { hideBelow: "lg" },
      cell: (info) => (
        <span className="flex flex-col text-muted-foreground">
          <span>{PAYMENT_METHOD_LABELS[info.getValue()]}</span>
          {info.row.original.reference ? <span className="text-xs">{info.row.original.reference}</span> : null}
        </span>
      ),
    }),
    helper.accessor("breakdown", {
      header: "Ventilation",
      meta: { hideBelow: "md" },
      cell: (info) => {
        const b = info.getValue();
        const parts = [
          b.contributions ? `Engagements ${formatShortAmount(b.contributions)}${b.late ? " (dont tardif)" : ""}` : null,
          b.donation ? `Don ${formatShortAmount(b.donation)}` : null,
          b.advance ? `Avance ${formatShortAmount(b.advance)}` : null,
        ].filter(Boolean);
        return <span className="text-xs text-muted-foreground">{parts.join(" · ")}</span>;
      },
    }),
    helper.accessor("amountXaf", {
      header: "Montant",
      meta: { align: "end", sortKey: compact ? undefined : "amountXaf" },
      cell: (info) => {
        const row = info.row.original;
        return (
          <span className={row.status === "CANCELLED" ? "text-muted-foreground line-through" : undefined}>
            <Money amount={info.getValue()} className="font-medium" />
            {row.currency.code !== "XAF" ? <span className="block text-xs text-muted-foreground">{formatMinor(row.currency.originalAmountMinor, row.currency.code)}</span> : null}
          </span>
        );
      },
    }),
    helper.accessor("status", {
      header: "Statut",
      meta: { hideBelow: "sm" },
      cell: (info) => (info.getValue() === "VALID" ? <StatusBadge tone="success">Validé</StatusBadge> : <StatusBadge tone="danger">Annulé</StatusBadge>),
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
      {!compact ? (
        <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-card sm:p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <ListSearch placeholder="Sponsor, n° de versement, référence…" className="sm:max-w-sm" />
            {canWrite ? (
              <Link href="/contributions/nouveau" className={buttonVariants()}>
                <Plus aria-hidden />
                Nouveau versement
              </Link>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <ListFilter param="annee" label="Année du mouvement" defaultValue={defaultYear} options={years ?? []} />
            <ListFilter param="moyen" label="Moyen" allLabel="Tous" options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))} />
            <ListFilter param="statut" label="Statut" allLabel="Tous" options={[{ value: "VALID", label: "Validés" }, { value: "CANCELLED", label: "Annulés" }]} />
          </div>
        </div>
      ) : null}

      <DataTable
        columns={columns}
        data={rows}
        pagination={pagination}
        onRowClick={(row) => router.push(`/contributions/${row.id}`)}
        emptyState={
          filtered ? (
            <EmptyState title="Aucun versement trouvé" description="Aucun versement ne correspond à ces critères." />
          ) : (
            <EmptyState
              icon={Banknote}
              title="Aucun versement"
              description="Enregistrez les versements reçus des sponsors : ils sont ventilés entre engagements, dons et avances."
              action={
                canWrite && !compact ? (
                  <Link href="/contributions/nouveau" className={buttonVariants()}>
                    <Plus aria-hidden />
                    Nouveau versement
                  </Link>
                ) : undefined
              }
            />
          )
        }
        renderMobileItem={(row) => (
          <Link href={`/contributions/${row.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-muted/50">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{compact ? row.number : row.sponsor.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {compact ? "" : `${row.number} · `}
                {formatShortDate(row.receivedAt)} · {PAYMENT_METHOD_LABELS[row.method]}
              </p>
            </div>
            <span className={row.status === "CANCELLED" ? "text-sm text-muted-foreground line-through" : "text-sm font-medium"}>
              <Money amount={row.amountXaf} />
            </span>
          </Link>
        )}
      />
    </>
  );
}

function formatShortAmount(value: number): string {
  return new Intl.NumberFormat("fr-FR").format(value);
}
