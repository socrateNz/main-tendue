"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, GraduationCap, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { deleteEnrollmentAction, saveEnrollmentAction } from "@/features/children/actions";
import type { ChildDetail, SchoolOption, YearOption } from "@/features/children/queries";
import { type EnrollmentData, type EnrollmentInput, enrollmentSchema } from "@/features/children/schemas";
import { ENROLLMENT_OUTCOMES, ENROLLMENT_OUTCOME_LABELS, SCHOOL_TYPE_LABELS, type EnrollmentOutcome } from "@/features/children/types";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/states";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Enrollment = ChildDetail["enrollments"][number];

const OUTCOME_TONES: Record<EnrollmentOutcome, StatusTone> = {
  PENDING: "info",
  PROMOTED: "success",
  REPEATED: "warning",
  GRADUATED: "success",
  LEFT: "neutral",
};

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50 aria-invalid:border-destructive";

export function SchoolingPanel({
  childId,
  enrollments,
  years,
  schools,
  canWrite,
}: {
  childId: string;
  enrollments: Enrollment[];
  years: YearOption[];
  schools: SchoolOption[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Enrollment | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Enrollment | null>(null);
  const usedYears = new Set(enrollments.map((e) => e.schoolYearId));
  const availableYears = years.filter((year) => !usedYears.has(year.id));

  async function confirmDelete(): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!deleting) return { ok: true };
    const result = await deleteEnrollmentAction(childId, deleting.id);
    if (!result.ok) return { ok: false, message: result.message };
    toast.success(result.message ?? "Scolarité supprimée.");
    router.refresh();
    return { ok: true };
  }

  return (
    <div className="space-y-4">
      {canWrite ? (
        <div className="flex justify-end">
          <Button onClick={() => setCreating(true)} disabled={availableYears.length === 0 || schools.every((s) => !s.active)}>
            <Plus aria-hidden />
            Ajouter une année de scolarité
          </Button>
        </div>
      ) : null}
      {canWrite && schools.every((s) => !s.active) ? (
        <p className="text-right text-xs text-muted-foreground">
          Aucun établissement actif.{" "}
          <Link href="/enfants/etablissements" className="text-primary underline-offset-4 hover:underline">
            Créer un établissement
          </Link>
        </p>
      ) : null}

      {enrollments.length === 0 ? (
        <div className="rounded-xl border bg-card shadow-card">
          <EmptyState icon={GraduationCap} title="Aucune scolarité enregistrée" description="Renseignez l'établissement et la classe de l'enfant pour chaque année scolaire." />
        </div>
      ) : (
        <ol className="relative space-y-3 before:absolute before:top-4 before:bottom-4 before:left-[0.95rem] before:w-px before:bg-border">
          {enrollments.map((enrollment) => (
            <li key={enrollment.id} className="relative flex gap-4">
              <span className="relative z-10 mt-4 flex size-8 shrink-0 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-sm">
                <GraduationCap className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1 rounded-xl border bg-card p-4 shadow-card">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {enrollment.yearLabel} · {enrollment.className}
                      {enrollment.level ? <span className="font-normal text-muted-foreground"> ({enrollment.level})</span> : null}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {enrollment.schoolName}
                      {enrollment.schoolCity ? `, ${enrollment.schoolCity}` : ""}
                      {enrollment.schoolType ? ` — ${SCHOOL_TYPE_LABELS[enrollment.schoolType]}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <StatusBadge tone={OUTCOME_TONES[enrollment.outcome]}>{ENROLLMENT_OUTCOME_LABELS[enrollment.outcome]}</StatusBadge>
                    {canWrite ? (
                      <>
                        <Button variant="ghost" size="icon-sm" onClick={() => setEditing(enrollment)} aria-label={`Modifier la scolarité ${enrollment.yearLabel}`}>
                          <Pencil />
                        </Button>
                        <Button variant="ghost" size="icon-sm" onClick={() => setDeleting(enrollment)} aria-label={`Supprimer la scolarité ${enrollment.yearLabel}`}>
                          <Trash2 />
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
                {enrollment.average !== null || enrollment.rank || enrollment.notes ? (
                  <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                    {enrollment.average !== null ? (
                      <div className="flex gap-1.5">
                        <dt className="text-muted-foreground">Moyenne</dt>
                        <dd className="font-medium tabular-nums">{enrollment.average.toLocaleString("fr-FR")} / 20</dd>
                      </div>
                    ) : null}
                    {enrollment.rank ? (
                      <div className="flex gap-1.5">
                        <dt className="text-muted-foreground">Rang</dt>
                        <dd className="font-medium">{enrollment.rank}</dd>
                      </div>
                    ) : null}
                    {enrollment.notes ? <p className="w-full text-muted-foreground">{enrollment.notes}</p> : null}
                  </dl>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}

      {canWrite ? (
        <>
          <EnrollmentDialog
            key={editing?.id ?? (creating ? "new" : "closed")}
            open={creating || editing !== null}
            onOpenChange={(open) => {
              if (!open) {
                setCreating(false);
                setEditing(null);
              }
            }}
            childId={childId}
            enrollment={editing}
            years={editing ? years.filter((y) => y.id === editing.schoolYearId || !usedYears.has(y.id)) : availableYears}
            schools={schools}
          />
          <ConfirmDialog
            open={deleting !== null}
            onOpenChange={(open) => !open && setDeleting(null)}
            title={`Supprimer la scolarité ${deleting?.yearLabel ?? ""} ?`}
            description="L'inscription de l'enfant pour cette année sera retirée de son historique scolaire. L'opération est journalisée."
            confirmLabel="Supprimer"
            destructive
            onConfirm={confirmDelete}
          />
        </>
      ) : null}
    </div>
  );
}

function EnrollmentDialog({
  open,
  onOpenChange,
  childId,
  enrollment,
  years,
  schools,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  childId: string;
  enrollment: Enrollment | null;
  years: YearOption[];
  schools: SchoolOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const defaultYear = enrollment?.schoolYearId ?? years.find((y) => y.current)?.id ?? years[0]?.id ?? "";
  const form = useForm<EnrollmentInput, unknown, EnrollmentData>({
    resolver: zodResolver(enrollmentSchema),
    defaultValues: {
      schoolYearId: defaultYear,
      schoolId: enrollment?.schoolId ?? "",
      className: enrollment?.className ?? "",
      level: enrollment?.level ?? "",
      average: enrollment?.average ?? undefined,
      rank: enrollment?.rank ?? "",
      outcome: enrollment?.outcome ?? "PENDING",
      notes: enrollment?.notes ?? "",
    },
  });
  const { errors } = form.formState;
  const selectableSchools = schools.filter((s) => s.active || s.id === enrollment?.schoolId);

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await saveEnrollmentAction({ childId, enrollmentId: enrollment?.id, data: values });
      if (!result.ok) {
        for (const [path, messages] of Object.entries(result.fieldErrors ?? {})) {
          if (messages[0]) form.setError(path as keyof EnrollmentInput, { type: "server", message: messages[0] });
        }
        return void setFormError(result.message);
      }
      toast.success(result.message ?? "Scolarité enregistrée.");
      onOpenChange(false);
      router.refresh();
    });
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit} noValidate className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{enrollment ? `Scolarité ${enrollment.yearLabel}` : "Nouvelle année de scolarité"}</DialogTitle>
            <DialogDescription>Une seule scolarité par année scolaire.</DialogDescription>
          </DialogHeader>
          {formError ? (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{formError}</span>
            </div>
          ) : null}
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={Boolean(errors.schoolYearId) || undefined}>
                <FieldLabel htmlFor="enr-year">Année scolaire</FieldLabel>
                <select id="enr-year" className={selectClass} disabled={pending || Boolean(enrollment)} {...form.register("schoolYearId")}>
                  {years.map((year) => (
                    <option key={year.id} value={year.id}>
                      {year.label}
                      {year.current ? " (active)" : ""}
                    </option>
                  ))}
                </select>
                <FieldError errors={[errors.schoolYearId]} />
              </Field>
              <Field data-invalid={Boolean(errors.outcome) || undefined}>
                <FieldLabel htmlFor="enr-outcome">Résultat</FieldLabel>
                <select id="enr-outcome" className={selectClass} disabled={pending} {...form.register("outcome")}>
                  {ENROLLMENT_OUTCOMES.map((outcome) => (
                    <option key={outcome} value={outcome}>
                      {ENROLLMENT_OUTCOME_LABELS[outcome]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field data-invalid={Boolean(errors.schoolId) || undefined}>
              <FieldLabel htmlFor="enr-school">Établissement</FieldLabel>
              <select id="enr-school" className={selectClass} disabled={pending} aria-invalid={Boolean(errors.schoolId) || undefined} {...form.register("schoolId")}>
                <option value="" disabled>
                  Choisir un établissement…
                </option>
                {selectableSchools.map((school) => (
                  <option key={school.id} value={school.id}>
                    {school.name}
                    {school.city ? ` — ${school.city}` : ""}
                  </option>
                ))}
              </select>
              <FieldDescription>
                Établissement absent ?{" "}
                <Link href="/enfants/etablissements" className="text-primary underline-offset-4 hover:underline">
                  Gérer les établissements
                </Link>
              </FieldDescription>
              <FieldError errors={[errors.schoolId]} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={Boolean(errors.className) || undefined}>
                <FieldLabel htmlFor="enr-class">Classe</FieldLabel>
                <Input id="enr-class" placeholder="CM2, 6e, Terminale D…" disabled={pending} aria-invalid={Boolean(errors.className) || undefined} {...form.register("className")} />
                <FieldError errors={[errors.className]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="enr-level">Niveau / filière (facultatif)</FieldLabel>
                <Input id="enr-level" disabled={pending} {...form.register("level")} />
              </Field>
              <Field data-invalid={Boolean(errors.average) || undefined}>
                <FieldLabel htmlFor="enr-average">Moyenne annuelle /20</FieldLabel>
                <Controller
                  control={form.control}
                  name="average"
                  render={({ field }) => (
                    <Input
                      id="enr-average"
                      inputMode="decimal"
                      disabled={pending}
                      value={field.value === undefined || field.value === null ? "" : String(field.value).replace(".", ",")}
                      onChange={(event) => {
                        const raw = event.target.value.replace(",", ".").trim();
                        field.onChange(raw === "" ? undefined : Number.isNaN(Number(raw)) ? raw : Number(raw));
                      }}
                      onBlur={field.onBlur}
                      aria-invalid={Boolean(errors.average) || undefined}
                    />
                  )}
                />
                <FieldError errors={[errors.average]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="enr-rank">Rang (facultatif)</FieldLabel>
                <Input id="enr-rank" placeholder="5e / 42" disabled={pending} {...form.register("rank")} />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="enr-notes">Observations (facultatif)</FieldLabel>
              <Textarea id="enr-notes" rows={2} disabled={pending} {...form.register("notes")} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Annuler
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
