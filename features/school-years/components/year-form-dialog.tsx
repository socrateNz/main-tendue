"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { createSchoolYearAction, updateSchoolYearAction } from "@/features/school-years/actions";
import { createSchoolYearSchema } from "@/features/school-years/schemas";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toDateInput } from "@/lib/dates";
import { applyServerErrors } from "@/lib/forms";

type FormValues = z.infer<typeof createSchoolYearSchema>;
const FIELDS = ["label", "startDate", "endDate", "notes"] as const;

export type EditableYear = { id: string; label: string; startDate: string; endDate: string; notes: string | null };

export function YearFormDialog({
  open,
  onOpenChange,
  year,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  year?: EditableYear | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(createSchoolYearSchema),
    values: year
      ? { label: year.label, startDate: toDateInput(year.startDate), endDate: toDateInput(year.endDate), notes: year.notes ?? "" }
      : { label: "", startDate: "", endDate: "", notes: "" },
  });
  const { errors } = form.formState;

  function handleOpenChange(next: boolean) {
    if (pending) return;
    if (!next) {
      form.reset();
      setFormError(null);
    }
    onOpenChange(next);
  }

  /** Propose le libellé et la fin de période à partir de la date de début. */
  function onStartDateChange(value: string) {
    const startYear = Number(value.slice(0, 4));
    if (!year && value && Number.isFinite(startYear)) {
      if (!form.getValues("label")) form.setValue("label", `${startYear}-${startYear + 1}`, { shouldValidate: true });
      if (!form.getValues("endDate")) form.setValue("endDate", `${startYear + 1}-06-30`);
    }
  }

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = year ? await updateSchoolYearAction({ ...values, yearId: year.id }) : await createSchoolYearAction(values);
      if (!result.ok) return void setFormError(applyServerErrors(result, form.setError, FIELDS));
      toast.success(result.message ?? "Enregistré.");
      form.reset();
      onOpenChange(false);
      if (!year && result.data && "yearId" in result.data) router.push(`/annees-scolaires/${result.data.yearId}`);
      else router.refresh();
    });
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit} noValidate className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{year ? `Modifier ${year.label}` : "Nouvelle année scolaire"}</DialogTitle>
            <DialogDescription>
              Les périodes des années ne doivent pas se chevaucher : la date d&apos;un versement ou d&apos;une dépense détermine
              automatiquement son année.
            </DialogDescription>
          </DialogHeader>

          {formError ? (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{formError}</span>
            </div>
          ) : null}

          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={Boolean(errors.startDate) || undefined}>
                <FieldLabel htmlFor="year-start">Date de début</FieldLabel>
                <Input
                  id="year-start"
                  type="date"
                  disabled={pending}
                  aria-invalid={Boolean(errors.startDate) || undefined}
                  {...form.register("startDate", { onChange: (event) => onStartDateChange(event.target.value) })}
                />
                <FieldError errors={[errors.startDate]} />
              </Field>
              <Field data-invalid={Boolean(errors.endDate) || undefined}>
                <FieldLabel htmlFor="year-end">Date de fin</FieldLabel>
                <Input id="year-end" type="date" disabled={pending} aria-invalid={Boolean(errors.endDate) || undefined} {...form.register("endDate")} />
                <FieldError errors={[errors.endDate]} />
              </Field>
            </div>

            <Field data-invalid={Boolean(errors.label) || undefined}>
              <FieldLabel htmlFor="year-label">Libellé</FieldLabel>
              <Input id="year-label" placeholder="2025-2026" autoComplete="off" disabled={pending} aria-invalid={Boolean(errors.label) || undefined} {...form.register("label")} />
              {!errors.label ? <FieldDescription>Proposé automatiquement à partir de la date de début.</FieldDescription> : null}
              <FieldError errors={[errors.label]} />
            </Field>

            <Field data-invalid={Boolean(errors.notes) || undefined}>
              <FieldLabel htmlFor="year-notes">Notes (facultatif)</FieldLabel>
              <Textarea id="year-notes" rows={3} disabled={pending} {...form.register("notes")} />
              <FieldError errors={[errors.notes]} />
            </Field>
          </FieldGroup>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
              Annuler
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {year ? "Enregistrer" : "Créer l'année"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
