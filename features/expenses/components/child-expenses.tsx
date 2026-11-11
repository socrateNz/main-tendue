import Link from "next/link";
import { Receipt } from "lucide-react";

import type { ChildExpenseRow } from "@/features/expenses/queries";
import { EXPENSE_SCOPE_LABELS } from "@/features/expenses/types";
import { Money } from "@/components/shared/money";
import { EmptyState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatShortDate } from "@/lib/dates";

/** Dépenses concernant un enfant : sa part (individuelle ou dans une dépense collective). */
export function ChildExpenses({ rows }: { rows: ChildExpenseRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border bg-card shadow-card">
        <EmptyState icon={Receipt} title="Aucune dépense" description="Les dépenses individuelles et la part de l'enfant dans les dépenses collectives apparaîtront ici." />
      </div>
    );
  }
  const total = rows.filter((r) => !r.cancelled).reduce((sum, r) => sum + r.share, 0);
  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-semibold">Part de l&apos;enfant dans les dépenses</h3>
        <Money amount={total} className="font-semibold" />
      </div>
      <ul className="divide-y text-sm">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
            <span className={row.cancelled ? "text-muted-foreground line-through" : undefined}>
              {formatShortDate(row.spentAt)} ·{" "}
              <Link href={`/depenses/${row.id}`} className="font-medium hover:underline">
                {row.description}
              </Link>{" "}
              <span className="text-muted-foreground">
                · {row.categoryName} · {row.yearLabel} · {EXPENSE_SCOPE_LABELS[row.scope].toLowerCase()}
                {row.scope === "COLLECTIVE" ? ` (sur ${new Intl.NumberFormat("fr-FR").format(row.total)} FCFA)` : ""}
              </span>
            </span>
            <span className="flex items-center gap-2">
              {row.cancelled ? <StatusBadge tone="danger">Annulée</StatusBadge> : null}
              <Money amount={row.share} className="font-medium" />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
