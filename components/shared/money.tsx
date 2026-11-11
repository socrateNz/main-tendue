import { formatXaf } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Montant XAF formaté (« 1 250 000 FCFA »), chiffres alignés. */
export function Money({
  amount,
  className,
  signed = false,
}: {
  amount: number;
  className?: string;
  /** Affiche le signe et colore les montants positifs / négatifs (soldes). */
  signed?: boolean;
}) {
  const tone = signed ? (amount < 0 ? "text-destructive" : amount > 0 ? "text-success" : undefined) : undefined;
  const prefix = signed && amount > 0 ? "+" : "";
  return <span className={cn("tabular-nums whitespace-nowrap", tone, className)}>{prefix}{formatXaf(amount)}</span>;
}
