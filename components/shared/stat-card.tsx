import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/** Indicateur clé (tableau de bord, rapports). La valeur provient toujours de données réelles. */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-card md:p-5", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {Icon ? (
          <span className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Icon className="size-3.5" aria-hidden />
          </span>
        ) : null}
      </div>
      <div className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">{value}</div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-card md:p-5" aria-hidden>
      <div className="h-4 w-24 animate-pulse rounded bg-muted" />
      <div className="h-7 w-32 animate-pulse rounded bg-muted" />
      <div className="h-3 w-20 animate-pulse rounded bg-muted/70" />
    </div>
  );
}
