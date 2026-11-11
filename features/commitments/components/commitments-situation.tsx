import Link from "next/link";
import { Scale } from "lucide-react";

import type { CommitmentView } from "@/features/commitments/queries";
import { totalsOf } from "@/features/commitments/queries";
import { SETTLEMENT_STATE_LABELS, type SettlementState } from "@/features/commitments/types";
import { Money } from "@/components/shared/money";
import { EmptyState } from "@/components/shared/states";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { coverageRate } from "@/lib/money";

const TONES: Record<SettlementState, StatusTone> = { UNPAID: "danger", PARTIAL: "warning", SETTLED: "success" };

export function SettlementBadge({ state }: { state: SettlementState }) {
  return <StatusBadge tone={TONES[state]}>{SETTLEMENT_STATE_LABELS[state]}</StatusBadge>;
}

/**
 * Situation des engagements (attendu / reçu / restant), regroupée par année.
 * `perspective` : afficher l'enfant (fiche sponsor) ou le sponsor (fiche enfant).
 */
export function CommitmentsSituation({ items, perspective }: { items: CommitmentView[]; perspective: "child" | "sponsor" }) {
  const active = items.filter((item) => item.status === "ACTIVE");
  if (items.length === 0) {
    return (
      <div className="rounded-xl border bg-card shadow-card">
        <EmptyState icon={Scale} title="Aucun engagement" description="Les engagements se définissent depuis le menu de chaque parrainage." />
      </div>
    );
  }
  const totals = totalsOf(active);
  const years = [...new Set(items.map((item) => item.year.label))];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Attendu", totals.expected],
          ["Reçu", totals.received],
          ["Reste à recevoir", totals.remaining],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border bg-card p-4 shadow-card">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-lg font-semibold">
              <Money amount={value as number} />
            </p>
          </div>
        ))}
        <div className="rounded-xl border bg-card p-4 shadow-card">
          <p className="text-xs text-muted-foreground">Couverture</p>
          <p className="text-lg font-semibold tabular-nums">{coverageRate(totals.received, totals.expected)} %</p>
        </div>
      </div>

      {years.map((label) => (
        <section key={label} className="overflow-x-auto rounded-xl border bg-card shadow-card">
          <h3 className="border-b bg-muted/30 px-4 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Année {label}</h3>
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-4 py-2 text-left font-medium">{perspective === "child" ? "Enfant" : "Sponsor"}</th>
                <th className="px-4 py-2 text-right font-medium">Engagé</th>
                <th className="px-4 py-2 text-right font-medium">Attendu</th>
                <th className="px-4 py-2 text-right font-medium">Reçu</th>
                <th className="px-4 py-2 text-right font-medium">Restant</th>
                <th className="px-4 py-2 text-left font-medium">État</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items
                .filter((item) => item.year.label === label)
                .map((item) => {
                  const party = perspective === "child" ? item.child : item.sponsor;
                  const href = perspective === "child" ? `/enfants/${party.id}` : `/sponsors/${party.id}`;
                  const cancelled = item.status === "CANCELLED";
                  return (
                    <tr key={item.id} className={cancelled ? "text-muted-foreground line-through" : undefined}>
                      <td className="px-4 py-2.5">
                        <Link href={href} className="font-medium hover:text-primary hover:underline">
                          {party.name}
                        </Link>
                        {item.adjustments.length > 0 && !cancelled ? (
                          <span className="block text-xs text-muted-foreground no-underline">Attendu ajusté : {item.adjustments.at(-1)?.reason}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Money amount={item.committed} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Money amount={item.expected} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Money amount={item.received} className="font-medium" />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Money amount={item.remaining} />
                      </td>
                      <td className="px-4 py-2.5">{cancelled ? <StatusBadge>Annulé</StatusBadge> : <SettlementBadge state={item.state} />}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
