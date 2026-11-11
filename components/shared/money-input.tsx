"use client";

import { forwardRef } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const formatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

/**
 * Saisie d'un montant en FCFA entiers : affiche les séparateurs de milliers, n'accepte que des
 * chiffres et transmet un `number` (ou `undefined` si le champ est vide). Aucune décimale possible.
 */
export const MoneyInput = forwardRef<
  HTMLInputElement,
  Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
    value: number | undefined | null;
    onChange: (value: number | undefined) => void;
  }
>(function MoneyInput({ value, onChange, className, ...props }, ref) {
  return (
    <div className="relative">
      <Input
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={value === undefined || value === null ? "" : formatter.format(value)}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, "").slice(0, 13);
          onChange(digits === "" ? undefined : Number(digits));
        }}
        className={cn("pr-14 text-right tabular-nums", className)}
        {...props}
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs font-medium text-muted-foreground">FCFA</span>
    </div>
  );
});
