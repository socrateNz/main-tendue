import Link from "next/link";

import type { ChildContributionRow } from "@/features/contributions/queries";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatShortDate } from "@/lib/dates";

/** Sommes reçues pour un enfant : lignes de versements et avances affectées à ses engagements. */
export function ChildContributions({ rows }: { rows: ChildContributionRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-card">
      <h3 className="border-b bg-muted/30 px-4 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Sommes reçues</h3>
      <ul className="divide-y text-sm">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
            <span className={row.cancelled ? "text-muted-foreground line-through" : undefined}>
              {formatShortDate(row.date)} ·{" "}
              <Link href={row.href} className="font-medium hover:underline">
                {row.label}
              </Link>{" "}
              <span className="text-muted-foreground">
                · {row.sponsorName} · engagement {row.yearLabel}
              </span>
            </span>
            <span className="flex items-center gap-2">
              {row.late ? <StatusBadge tone="warning">Tardif</StatusBadge> : null}
              {row.cancelled ? <StatusBadge tone="danger">Annulé</StatusBadge> : null}
              <Money amount={row.amount} className="font-medium" />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
