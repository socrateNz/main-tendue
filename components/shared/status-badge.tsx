import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const statusBadgeVariants = cva(
  "inline-flex h-5.5 shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border-border bg-muted/60 text-muted-foreground",
        info: "border-primary/15 bg-primary/8 text-primary",
        success: "border-success/20 bg-success/10 text-success",
        warning: "border-warning/25 bg-warning/10 text-warning",
        danger: "border-destructive/20 bg-destructive/8 text-destructive",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type StatusTone = NonNullable<VariantProps<typeof statusBadgeVariants>["tone"]>;

/** Badge de statut avec pastille de couleur (la couleur n'est jamais la seule information). */
export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone?: StatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn(statusBadgeVariants({ tone }), className)}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}
