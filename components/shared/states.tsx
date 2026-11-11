import { AlertTriangle, Inbox, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/** État vide : explique l'absence de données et propose l'action utile. */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-14 text-center", className)}>
      <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground ring-8 ring-muted/40">
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

/** État d'erreur : message compréhensible, sans détail technique. */
export function ErrorState({
  title = "Impossible d'afficher ces informations",
  description = "Une erreur est survenue lors du chargement. Réessayez dans un instant.",
  action,
  className,
}: {
  title?: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center gap-3 px-6 py-14 text-center", className)}>
      <span className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive ring-8 ring-destructive/5">
        <AlertTriangle className="size-5" aria-hidden />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
