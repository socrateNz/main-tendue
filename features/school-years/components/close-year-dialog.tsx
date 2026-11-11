"use client";

import { AlertTriangle, Loader2, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { closingPreviewAction, schoolYearOperationAction } from "@/features/school-years/actions";
import type { ClosingPreview } from "@/features/school-years/service";
import { Money } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Clôture : aperçu calculé par le serveur, conditions bloquantes, puis confirmation explicite. */
export function CloseYearDialog({
  open,
  onOpenChange,
  year,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  year: { id: string; label: string };
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<ClosingPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [closing, startClosing] = useTransition();

  useEffect(() => {
    if (!open) return;
    startLoading(async () => {
      const result = await closingPreviewAction({ yearId: year.id });
      if (result.ok) {
        setPreview(result.data);
        setError(null);
      } else {
        setError(result.message);
      }
    });
  }, [open, year.id]);

  function confirm() {
    startClosing(async () => {
      const result = await schoolYearOperationAction({ yearId: year.id }, "close");
      if (!result.ok) return void setError(result.message);
      toast.success(result.message ?? "Année clôturée.");
      onOpenChange(false);
      router.refresh();
    });
  }

  const figures = preview?.figures;
  const rows = figures
    ? ([
        ["Solde d'ouverture", figures.openingBalance, ""],
        ["Contributions encaissées", figures.contributions, "+"],
        ["dont règlements tardifs", figures.lateContributions, "sub"],
        ["Dons reçus", figures.donations, "+"],
        ["Avances encaissées", figures.advances, "+"],
        ["Dépenses effectuées", figures.expenses, "−"],
      ] as const)
    : [];

  return (
    <Dialog open={open} onOpenChange={(next) => !closing && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <span className="mb-1 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Lock className="size-5" aria-hidden />
          </span>
          <DialogTitle>Clôturer l&apos;année {year.label}</DialogTitle>
          <DialogDescription>
            Les montants ci-dessous seront figés dans un instantané immuable. Aucun nouveau mouvement daté dans cette période ne
            pourra ensuite être enregistré, modifié ou annulé.
          </DialogDescription>
        </DialogHeader>

        {loading || (!preview && !error) ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground" aria-busy="true">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Calcul de l&apos;instantané…
          </div>
        ) : null}

        {preview && !loading && preview.blockers.length > 0 ? (
          <div role="alert" className="space-y-2 rounded-lg border border-warning/25 bg-warning/5 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-warning">
              <AlertTriangle className="size-4" aria-hidden />
              Clôture impossible pour le moment
            </p>
            <ul className="ml-6 list-disc space-y-1 text-foreground">
              {preview.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {preview && !loading && figures ? (
          <dl className="divide-y rounded-lg border text-sm">
            {rows.map(([label, amount, sign]) => (
              <div key={label} className={`flex items-center justify-between px-3 py-2 ${sign === "sub" ? "pl-7 text-muted-foreground" : ""}`}>
                <dt>{label}</dt>
                <dd className="tabular-nums">
                  {sign === "+" || sign === "−" ? <span className="mr-1 text-muted-foreground">{sign}</span> : null}
                  <Money amount={amount} />
                </dd>
              </div>
            ))}
            <div className="flex items-center justify-between bg-muted/40 px-3 py-2.5 font-semibold">
              <dt>Solde de clôture</dt>
              <dd>
                <Money amount={figures.closingBalance} />
              </dd>
            </div>
          </dl>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={closing}>
            Retour
          </Button>
          <Button onClick={confirm} disabled={closing || loading || !preview?.canClose}>
            {closing ? <Loader2 className="animate-spin" aria-hidden /> : <Lock aria-hidden />}
            Clôturer définitivement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
