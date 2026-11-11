"use client";

import { HandHeart, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import type { SponsorshipView } from "@/features/sponsorships/queries";
import { SponsorshipActions } from "@/features/sponsorships/components/sponsorship-actions";
import { SponsorshipDialog, type YearWithPeriod } from "@/features/sponsorships/components/sponsorship-dialog";
import { SponsorshipStatusBadge } from "@/features/sponsorships/components/sponsorship-status-badge";
import { Money } from "@/components/shared/money";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { EmptyState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { formatShortDate } from "@/lib/dates";
import type { PickerValue } from "@/components/shared/entity-picker";

/**
 * Parrainages d'un enfant ou d'un sponsor, regroupés par année (fiche enfant / fiche sponsor).
 * `perspective` indique quelle partie afficher : les sponsors (fiche enfant) ou les enfants (fiche sponsor).
 */
export function SponsorshipList({
  items,
  perspective,
  years,
  fixed,
  canWrite,
  canSeeFinance,
  canManageCommitment = false,
  createDisabledReason,
}: {
  items: SponsorshipView[];
  perspective: "sponsors" | "children";
  years: YearWithPeriod[];
  fixed: PickerValue;
  canWrite: boolean;
  canSeeFinance: boolean;
  canManageCommitment?: boolean;
  createDisabledReason?: string | null;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SponsorshipView | null>(null);
  const groups = new Map<string, SponsorshipView[]>();
  for (const item of items) groups.set(item.year.label, [...(groups.get(item.year.label) ?? []), item]);

  return (
    <div className="space-y-4">
      {canWrite ? (
        <div className="flex flex-col items-end gap-1">
          <Button onClick={() => setCreating(true)} disabled={Boolean(createDisabledReason)}>
            <Plus aria-hidden />
            {perspective === "sponsors" ? "Ajouter un sponsor" : "Parrainer un enfant"}
          </Button>
          {createDisabledReason ? <p className="text-xs text-muted-foreground">{createDisabledReason}</p> : null}
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="rounded-xl border bg-card shadow-card">
          <EmptyState
            icon={HandHeart}
            title={perspective === "sponsors" ? "Aucun sponsor" : "Aucun enfant parrainé"}
            description={perspective === "sponsors" ? "Cet enfant n'a encore aucun parrainage." : "Ce sponsor ne parraine encore aucun enfant."}
          />
        </div>
      ) : (
        [...groups.entries()].map(([label, rows]) => (
          <section key={label} className="overflow-hidden rounded-xl border bg-card shadow-card">
            <h3 className="border-b bg-muted/30 px-4 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Année {label} · {rows.length} parrainage{rows.length > 1 ? "s" : ""}
            </h3>
            <ul className="divide-y">
              {rows.map((row) => {
                const other = perspective === "sponsors" ? row.sponsor : row.child;
                const href = perspective === "sponsors" ? `/sponsors/${row.sponsor.id}` : `/enfants/${row.child.id}`;
                return (
                  <li key={row.id} className="flex items-center gap-3 px-4 py-3">
                    <PersonAvatar name={other.name} photoUrl={other.photoUrl} />
                    <div className="min-w-0 flex-1">
                      <Link href={href} className="block truncate text-sm font-medium hover:text-primary hover:underline">
                        {other.name}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {other.code} · depuis le {formatShortDate(row.startDate)}
                        {row.endDate ? ` jusqu'au ${formatShortDate(row.endDate)}` : ""}
                        {row.endReason && row.status !== "ACTIVE" ? ` — ${row.endReason}` : ""}
                      </p>
                    </div>
                    {canSeeFinance ? (
                      <span className="hidden text-right text-xs sm:block">
                        {row.commitment && row.commitment.status === "ACTIVE" ? (
                          <>
                            <span className="block text-muted-foreground">Engagement</span>
                            <Money amount={row.commitment.committedAmount} className="font-medium" />
                          </>
                        ) : (
                          <span className="text-muted-foreground">Engagement non défini</span>
                        )}
                      </span>
                    ) : null}
                    <SponsorshipStatusBadge status={row.status} />
                    {canWrite || canManageCommitment ? (
                      <SponsorshipActions sponsorship={row} onEdit={() => setEditing(row)} canWrite={canWrite} canManageCommitment={canManageCommitment} />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {canWrite ? (
        <>
          {creating ? (
            <SponsorshipDialog
              open
              onOpenChange={setCreating}
              years={years}
              fixedSponsor={perspective === "children" ? fixed : undefined}
              fixedChild={perspective === "sponsors" ? fixed : undefined}
            />
          ) : null}
          {editing ? <SponsorshipDialog key={editing.id} open onOpenChange={(open) => !open && setEditing(null)} years={years} sponsorship={editing} /> : null}
        </>
      ) : null}
    </div>
  );
}
