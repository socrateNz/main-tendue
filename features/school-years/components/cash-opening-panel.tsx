"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, History, Landmark, Loader2, PencilLine } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { correctCashOpeningAction, createCashOpeningAction } from "@/features/school-years/actions";
import { correctCashOpeningSchema, createCashOpeningSchema } from "@/features/school-years/schemas";
import { Money } from "@/components/shared/money";
import { MoneyInput } from "@/components/shared/money-input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatDateTime, toDateInput } from "@/lib/dates";
import { applyServerErrors } from "@/lib/forms";

export type CashOpeningView = {
  amount: number;
  date: string;
  reason: string;
  createdAt: string;
  createdBy: string;
  corrections: Array<{ from: number; to: number; reason: string; at: string; by: string }>;
};

/** Solde initial de la caisse : ouverture de caisse, distincte des contributions, dons et avances. */
export function CashOpeningPanel({
  year,
  opening,
  canInitialize,
  yearClosed,
}: {
  year: { id: string; label: string; startDate: string };
  opening: CashOpeningView | null;
  canInitialize: boolean;
  yearClosed: boolean;
}) {
  const [dialog, setDialog] = useState<"create" | "correct" | null>(null);

  return (
    <section className="rounded-xl border bg-card shadow-card">
      <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Landmark className="size-4" aria-hidden />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Solde initial de la caisse</h2>
            <p className="text-sm text-muted-foreground">Ouverture de caisse, enregistrée une seule fois sur la première année.</p>
          </div>
        </div>
      </div>

      {opening ? (
        <div className="space-y-4 px-5 py-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-2xl font-semibold tracking-tight">
                <Money amount={opening.amount} />
              </p>
              <p className="text-sm text-muted-foreground">au {formatDate(opening.date)}</p>
            </div>
            {canInitialize && !yearClosed ? (
              <Button variant="outline" size="sm" onClick={() => setDialog("correct")}>
                <PencilLine aria-hidden />
                Corriger (procédure exceptionnelle)
              </Button>
            ) : null}
          </div>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Motif</dt>
              <dd>{opening.reason}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Enregistré par</dt>
              <dd>
                {opening.createdBy}, le {formatDateTime(opening.createdAt)}
              </dd>
            </div>
          </dl>
          {opening.corrections.length > 0 ? (
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase">
                <History className="size-3.5" aria-hidden />
                Corrections
              </p>
              <ul className="space-y-2 text-sm">
                {opening.corrections.map((correction) => (
                  <li key={correction.at}>
                    <span className="tabular-nums">
                      <Money amount={correction.from} /> → <Money amount={correction.to} className="font-medium" />
                    </span>
                    <span className="text-muted-foreground"> — {correction.reason} ({correction.by}, {formatDateTime(correction.at)})</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {yearClosed ? (
            <p className="text-xs text-muted-foreground">L&apos;année est clôturée : une correction nécessiterait une réouverture préalable.</p>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Non enregistré. Il est requis avant la première clôture ; un montant de 0 FCFA est accepté.
          </p>
          {canInitialize ? (
            <Button onClick={() => setDialog("create")}>Enregistrer le solde initial</Button>
          ) : (
            <p className="text-xs text-muted-foreground">Réservé au super administrateur.</p>
          )}
        </div>
      )}

      {canInitialize ? (
        <>
          <CreateOpeningDialog open={dialog === "create"} onOpenChange={(open) => setDialog(open ? "create" : null)} year={year} />
          {opening ? (
            <CorrectOpeningDialog
              open={dialog === "correct"}
              onOpenChange={(open) => setDialog(open ? "correct" : null)}
              yearId={year.id}
              current={opening.amount}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function FormAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}

type CreateValues = z.infer<typeof createCashOpeningSchema>;

function CreateOpeningDialog({
  open,
  onOpenChange,
  year,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  year: { id: string; label: string; startDate: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<CreateValues>({
    resolver: zodResolver(createCashOpeningSchema),
    defaultValues: { yearId: year.id, amount: undefined, date: toDateInput(year.startDate), reason: "" },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await createCashOpeningAction(values);
      if (!result.ok) return void setFormError(applyServerErrors(result, form.setError, ["amount", "date", "reason"]));
      toast.success(result.message ?? "Solde initial enregistré.");
      onOpenChange(false);
      router.refresh();
    });
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} noValidate className="grid gap-5">
          <DialogHeader>
            <DialogTitle>Solde initial de la caisse</DialogTitle>
            <DialogDescription>
              Montant réellement disponible en caisse au démarrage, sur l&apos;année {year.label}. Il ne pourra plus être modifié
              directement après validation.
            </DialogDescription>
          </DialogHeader>
          <FormAlert message={formError} />
          <FieldGroup>
            <Field data-invalid={Boolean(errors.amount) || undefined}>
              <FieldLabel htmlFor="opening-amount">Montant</FieldLabel>
              <Controller
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <MoneyInput id="opening-amount" value={field.value} onChange={field.onChange} onBlur={field.onBlur} disabled={pending} aria-invalid={Boolean(errors.amount) || undefined} />
                )}
              />
              <FieldDescription>Saisissez 0 si la caisse démarre vide.</FieldDescription>
              <FieldError errors={[errors.amount]} />
            </Field>
            <Field data-invalid={Boolean(errors.date) || undefined}>
              <FieldLabel htmlFor="opening-date">Date de l&apos;ouverture</FieldLabel>
              <Input id="opening-date" type="date" disabled={pending} aria-invalid={Boolean(errors.date) || undefined} {...form.register("date")} />
              <FieldError errors={[errors.date]} />
            </Field>
            <Field data-invalid={Boolean(errors.reason) || undefined}>
              <FieldLabel htmlFor="opening-reason">Motif / justification</FieldLabel>
              <Textarea id="opening-reason" rows={3} placeholder="Ex. reprise du solde du cahier de caisse au 1er septembre" disabled={pending} {...form.register("reason")} />
              <FieldError errors={[errors.reason]} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Annuler
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Valider le solde initial
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type CorrectValues = z.infer<typeof correctCashOpeningSchema>;

function CorrectOpeningDialog({
  open,
  onOpenChange,
  yearId,
  current,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  yearId: string;
  current: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<CorrectValues>({ resolver: zodResolver(correctCashOpeningSchema), defaultValues: { amount: current, reason: "" } });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await correctCashOpeningAction(values, yearId);
      if (!result.ok) return void setFormError(applyServerErrors(result, form.setError, ["amount", "reason"]));
      toast.success(result.message ?? "Correction enregistrée.");
      onOpenChange(false);
      router.refresh();
    });
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} noValidate className="grid gap-5">
          <DialogHeader>
            <DialogTitle>Corriger le solde initial</DialogTitle>
            <DialogDescription>
              Procédure exceptionnelle : l&apos;ancien montant (<Money amount={current} />) reste tracé, avec votre motif, dans
              l&apos;historique et le journal d&apos;audit.
            </DialogDescription>
          </DialogHeader>
          <FormAlert message={formError} />
          <FieldGroup>
            <Field data-invalid={Boolean(errors.amount) || undefined}>
              <FieldLabel htmlFor="correct-amount">Nouveau montant</FieldLabel>
              <Controller
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <MoneyInput id="correct-amount" value={field.value} onChange={field.onChange} onBlur={field.onBlur} disabled={pending} aria-invalid={Boolean(errors.amount) || undefined} />
                )}
              />
              <FieldError errors={[errors.amount]} />
            </Field>
            <Field data-invalid={Boolean(errors.reason) || undefined}>
              <FieldLabel htmlFor="correct-reason">Motif de la correction</FieldLabel>
              <Textarea id="correct-reason" rows={3} disabled={pending} {...form.register("reason")} />
              <FieldError errors={[errors.reason]} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Annuler
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Enregistrer la correction
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
