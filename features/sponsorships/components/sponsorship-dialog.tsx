"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import type { YearOption } from "@/features/children/queries";
import { searchChildrenAction, searchSponsorsAction } from "@/features/sponsors/actions";
import { createSponsorshipAction, updateSponsorshipAction } from "@/features/sponsorships/actions";
import type { SponsorshipView } from "@/features/sponsorships/queries";
import { EntityPicker, type PickerValue } from "@/components/shared/entity-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toDateInput } from "@/lib/dates";

export type YearWithPeriod = YearOption;

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50";

/**
 * Création (sponsor et/ou enfant à choisir) ou modification des dates d'un parrainage.
 * Les contrôles sont refaits côté serveur (statuts, période de l'année, unicité).
 */
export function SponsorshipDialog({
  open,
  onOpenChange,
  years,
  fixedSponsor,
  fixedChild,
  sponsorship,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  years: YearWithPeriod[];
  fixedSponsor?: PickerValue;
  fixedChild?: PickerValue;
  /** Parrainage à modifier ; absent pour une création. */
  sponsorship?: SponsorshipView | null;
}) {
  const router = useRouter();
  const openYears = years.filter((year) => year.status !== "CLOSED");
  const initialYear = sponsorship ? years.find((y) => y.id === sponsorship.year.id) : (openYears.find((y) => y.current) ?? openYears[0]);
  const [sponsor, setSponsor] = useState<PickerValue | null>(fixedSponsor ?? null);
  const [child, setChild] = useState<PickerValue | null>(fixedChild ?? null);
  const [yearId, setYearId] = useState(initialYear?.id ?? "");
  const year = years.find((y) => y.id === yearId);
  const defaultStart = () => {
    if (!year) return "";
    const today = toDateInput(new Date());
    return today >= toDateInput(year.startDate) && today <= toDateInput(year.endDate) ? today : toDateInput(year.startDate);
  };
  const [startDate, setStartDate] = useState(sponsorship ? toDateInput(sponsorship.startDate) : defaultStart());
  const [endDate, setEndDate] = useState(sponsorship?.endDate ? toDateInput(sponsorship.endDate) : "");
  const [notes, setNotes] = useState(sponsorship?.notes ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onYearChange(next: string) {
    setYearId(next);
    const nextYear = years.find((y) => y.id === next);
    if (nextYear && !sponsorship) setStartDate(toDateInput(nextYear.startDate));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const local: Record<string, string> = {};
    if (!sponsorship && !sponsor) local.sponsorId = "Choisissez un sponsor.";
    if (!sponsorship && !child) local.childId = "Choisissez un enfant.";
    if (!yearId) local.schoolYearId = "Choisissez une année.";
    if (!startDate) local.startDate = "La date de début est obligatoire.";
    if (endDate && startDate && endDate < startDate) local.endDate = "La fin ne peut pas précéder le début.";
    setErrors(local);
    if (Object.keys(local).length > 0) return;

    setFormError(null);
    startTransition(async () => {
      const result = sponsorship
        ? await updateSponsorshipAction({ sponsorshipId: sponsorship.id, startDate, endDate, notes })
        : await createSponsorshipAction({ sponsorId: sponsor?.id, childId: child?.id, schoolYearId: yearId, startDate, endDate, notes });
      if (!result.ok) {
        setErrors(Object.fromEntries(Object.entries(result.fieldErrors ?? {}).map(([key, messages]) => [key, messages[0] ?? ""])));
        return void setFormError(result.message);
      }
      toast.success(result.message ?? "Parrainage enregistré.");
      onOpenChange(false);
      router.refresh();
    });
  }

  const title = sponsorship ? "Modifier le parrainage" : "Nouveau parrainage";
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} noValidate className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {sponsorship
                ? `${sponsorship.sponsor.name} → ${sponsorship.child.name}, ${sponsorship.year.label}.`
                : "Un sponsor peut parrainer plusieurs enfants et un enfant avoir plusieurs sponsors ; une seule association par année."}
            </DialogDescription>
          </DialogHeader>
          {formError ? (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{formError}</span>
            </div>
          ) : null}

          <FieldGroup>
            {!sponsorship ? (
              <>
                <Field data-invalid={Boolean(errors.sponsorId) || undefined}>
                  <FieldLabel htmlFor="sp-sponsor">Sponsor</FieldLabel>
                  <EntityPicker
                    id="sp-sponsor"
                    value={sponsor}
                    onChange={setSponsor}
                    search={searchSponsorsAction}
                    placeholder="Nom, code, e-mail…"
                    emptyLabel="Aucun sponsor actif ne correspond."
                    disabled={pending || Boolean(fixedSponsor)}
                    invalid={Boolean(errors.sponsorId)}
                  />
                  {errors.sponsorId ? <FieldError>{errors.sponsorId}</FieldError> : null}
                </Field>
                <Field data-invalid={Boolean(errors.childId) || undefined}>
                  <FieldLabel htmlFor="sp-child">Enfant</FieldLabel>
                  <EntityPicker
                    id="sp-child"
                    value={child}
                    onChange={setChild}
                    search={searchChildrenAction}
                    placeholder="Nom, code, tuteur…"
                    emptyLabel="Aucun enfant actif ne correspond."
                    disabled={pending || Boolean(fixedChild)}
                    invalid={Boolean(errors.childId)}
                  />
                  {errors.childId ? <FieldError>{errors.childId}</FieldError> : null}
                </Field>
                <Field data-invalid={Boolean(errors.schoolYearId) || undefined}>
                  <FieldLabel htmlFor="sp-year">Année scolaire</FieldLabel>
                  <select id="sp-year" className={selectClass} value={yearId} onChange={(event) => onYearChange(event.target.value)} disabled={pending}>
                    {openYears.length === 0 ? <option value="">Aucune année ouverte</option> : null}
                    {openYears.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                        {option.current ? " (active)" : option.status === "DRAFT" ? " (en préparation)" : ""}
                      </option>
                    ))}
                  </select>
                  {errors.schoolYearId ? <FieldError>{errors.schoolYearId}</FieldError> : null}
                </Field>
              </>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={Boolean(errors.startDate) || undefined}>
                <FieldLabel htmlFor="sp-start">Début</FieldLabel>
                <Input
                  id="sp-start"
                  type="date"
                  value={startDate}
                  min={year ? toDateInput(year.startDate) : undefined}
                  max={year ? toDateInput(year.endDate) : undefined}
                  onChange={(event) => setStartDate(event.target.value)}
                  disabled={pending}
                  aria-invalid={Boolean(errors.startDate) || undefined}
                />
                {errors.startDate ? <FieldError>{errors.startDate}</FieldError> : null}
              </Field>
              <Field data-invalid={Boolean(errors.endDate) || undefined}>
                <FieldLabel htmlFor="sp-end">Fin (facultatif)</FieldLabel>
                <Input
                  id="sp-end"
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  max={year ? toDateInput(year.endDate) : undefined}
                  onChange={(event) => setEndDate(event.target.value)}
                  disabled={pending}
                  aria-invalid={Boolean(errors.endDate) || undefined}
                />
                {errors.endDate ? <FieldError>{errors.endDate}</FieldError> : null}
              </Field>
            </div>
            {year ? <FieldDescription>Les dates doivent être comprises dans l&apos;année {year.label}.</FieldDescription> : null}
            <Field>
              <FieldLabel htmlFor="sp-notes">Notes (facultatif)</FieldLabel>
              <Textarea id="sp-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} disabled={pending} />
            </Field>
          </FieldGroup>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Annuler
            </Button>
            <Button type="submit" disabled={pending || (!sponsorship && openYears.length === 0)}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {sponsorship ? "Enregistrer" : "Créer le parrainage"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
