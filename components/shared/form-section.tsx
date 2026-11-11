import { cn } from "@/lib/utils";

/**
 * Section de formulaire : titre et aide à gauche sur grand écran, champs à droite ;
 * empilés sur mobile.
 */
export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("grid gap-4 border-b py-6 first:pt-0 last:border-b-0 last:pb-0 lg:grid-cols-[minmax(0,16rem)_1fr] lg:gap-10", className)}>
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}
