"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Loader2, Plus, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useFieldArray, useForm, useWatch, type FieldError as RhfFieldError } from "react-hook-form";
import { toast } from "sonner";

import { createChildAction, updateChildAction } from "@/features/children/actions";
import { type ChildData, type ChildInput, childSchema } from "@/features/children/schemas";
import { GUARDIAN_RELATIONSHIPS, GUARDIAN_RELATIONSHIP_LABELS, SEXES, SEX_LABELS } from "@/features/children/types";
import { FormSection } from "@/components/shared/form-section";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { PublicError } from "@/lib/errors";
import { cn } from "@/lib/utils";

const EMPTY_GUARDIAN: ChildInput["guardians"][number] = {
  relationship: "MOTHER",
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  address: "",
  occupation: "",
  isPrimaryContact: false,
};

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50 aria-invalid:border-destructive";

export function ChildForm({ childId, defaultValues }: { childId?: string; defaultValues?: ChildInput }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<ChildInput, unknown, ChildData>({
    resolver: zodResolver(childSchema),
    defaultValues: defaultValues ?? {
      firstName: "",
      lastName: "",
      birthDate: "",
      sex: undefined,
      birthPlace: "",
      address: "",
      city: "",
      phone: "",
      email: "",
      notes: "",
      guardians: [{ ...EMPTY_GUARDIAN, isPrimaryContact: true }],
    },
  });
  const { errors } = form.formState;
  const guardians = useFieldArray({ control: form.control, name: "guardians" });
  const watchedGuardians = useWatch({ control: form.control, name: "guardians" });

  function applyErrors(result: PublicError) {
    let first = true;
    for (const [path, messages] of Object.entries(result.fieldErrors ?? {})) {
      if (!messages[0]) continue;
      form.setError(path as keyof ChildInput, { type: "server", message: messages[0] }, { shouldFocus: first });
      first = false;
    }
    setFormError(result.message);
  }

  function setPrimary(index: number) {
    form.getValues("guardians").forEach((_, i) => form.setValue(`guardians.${i}.isPrimaryContact`, i === index, { shouldDirty: true }));
  }

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      if (childId) {
        const result = await updateChildAction({ childId, data: values });
        if (!result.ok) return applyErrors(result);
        toast.success(result.message ?? "Fiche mise à jour.");
        router.push(`/enfants/${childId}`);
      } else {
        const result = await createChildAction(values);
        if (!result.ok) return applyErrors(result);
        toast.success(result.message ?? "Fiche créée.");
        router.push(`/enfants/${result.data.childId}`);
      }
      router.refresh();
    });
  }, () => setFormError("Certains champs sont à corriger."));

  const text = (name: keyof ChildInput, label: string, options: { type?: string; autoComplete?: string; className?: string; hint?: string } = {}) => {
    const error = errors[name] as RhfFieldError | undefined;
    return (
      <Field data-invalid={Boolean(error) || undefined} className={options.className}>
        <FieldLabel htmlFor={`child-${name}`}>{label}</FieldLabel>
        <Input id={`child-${name}`} type={options.type ?? "text"} autoComplete={options.autoComplete ?? "off"} disabled={pending} aria-invalid={Boolean(error) || undefined} {...form.register(name)} />
        {options.hint && !error ? <FieldDescription>{options.hint}</FieldDescription> : null}
        <FieldError errors={[error]} />
      </Field>
    );
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      {formError ? (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{formError}</span>
        </div>
      ) : null}

      <div className="rounded-xl border bg-card p-5 shadow-card md:p-6">
        <FormSection title="Identité" description="Ces informations servent aussi à détecter les fiches en double.">
          {text("lastName", "Nom")}
          {text("firstName", "Prénom(s)")}
          {text("birthDate", "Date de naissance", { type: "date" })}
          <Field data-invalid={Boolean(errors.sex) || undefined}>
            <FieldLabel htmlFor="child-sex">Sexe</FieldLabel>
            <select id="child-sex" className={selectClass} disabled={pending} aria-invalid={Boolean(errors.sex) || undefined} {...form.register("sex")} defaultValue={defaultValues?.sex ?? ""}>
              <option value="" disabled>
                Choisir…
              </option>
              {SEXES.map((sex) => (
                <option key={sex} value={sex}>
                  {SEX_LABELS[sex]}
                </option>
              ))}
            </select>
            <FieldError errors={[errors.sex]} />
          </Field>
          {text("birthPlace", "Lieu de naissance (facultatif)")}
        </FormSection>

        <FormSection title="Coordonnées" description="Coordonnées éventuelles de l'enfant ; celles des parents se trouvent plus bas.">
          {text("address", "Adresse / quartier", { className: "sm:col-span-2" })}
          {text("city", "Ville")}
          {text("phone", "Téléphone", { type: "tel" })}
          {text("email", "E-mail", { type: "email", className: "sm:col-span-2" })}
        </FormSection>

        <section className="grid gap-4 border-b py-6 lg:grid-cols-[minmax(0,16rem)_1fr] lg:gap-10">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">Parents et tuteurs</h2>
            <p className="text-sm text-muted-foreground">Désignez le contact principal de la famille (étoile).</p>
            {errors.guardians?.root?.message || errors.guardians?.message ? (
              <p role="alert" className="text-sm text-destructive">
                {errors.guardians?.root?.message ?? errors.guardians?.message}
              </p>
            ) : null}
          </div>
          <div className="space-y-4">
            {guardians.fields.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">Aucun parent ou tuteur renseigné.</p>
            ) : null}
            {guardians.fields.map((field, index) => {
              const errs = errors.guardians?.[index];
              const primary = Boolean(watchedGuardians?.[index]?.isPrimaryContact);
              return (
                <fieldset key={field.id} className={cn("rounded-lg border p-4", primary && "border-primary/40 bg-primary/2")}>
                  <legend className="sr-only">Parent ou tuteur {index + 1}</legend>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <select aria-label="Lien de parenté" className={cn(selectClass, "w-auto")} disabled={pending} {...form.register(`guardians.${index}.relationship`)}>
                      {GUARDIAN_RELATIONSHIPS.map((relationship) => (
                        <option key={relationship} value={relationship}>
                          {GUARDIAN_RELATIONSHIP_LABELS[relationship]}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant={primary ? "secondary" : "ghost"}
                        size="sm"
                        onClick={() => setPrimary(index)}
                        aria-pressed={primary}
                        disabled={pending}
                      >
                        <Star className={cn(primary && "fill-current text-warning")} aria-hidden />
                        <span className="hidden sm:inline">{primary ? "Contact principal" : "Définir principal"}</span>
                      </Button>
                      <Button type="button" variant="ghost" size="icon-sm" onClick={() => guardians.remove(index)} aria-label="Retirer ce parent ou tuteur" disabled={pending}>
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(
                      [
                        ["lastName", "Nom", "text"],
                        ["firstName", "Prénom", "text"],
                        ["phone", "Téléphone", "tel"],
                        ["email", "E-mail", "email"],
                        ["occupation", "Profession", "text"],
                        ["address", "Adresse", "text"],
                      ] as const
                    ).map(([name, label, type]) => (
                      <Field key={name} data-invalid={Boolean(errs?.[name]) || undefined}>
                        <FieldLabel htmlFor={`g-${index}-${name}`}>{label}</FieldLabel>
                        <Input id={`g-${index}-${name}`} type={type} autoComplete="off" disabled={pending} aria-invalid={Boolean(errs?.[name]) || undefined} {...form.register(`guardians.${index}.${name}`)} />
                        <FieldError errors={[errs?.[name]]} />
                      </Field>
                    ))}
                  </div>
                </fieldset>
              );
            })}
            {guardians.fields.length < 6 ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => guardians.append({ ...EMPTY_GUARDIAN, isPrimaryContact: guardians.fields.length === 0 })}
                disabled={pending}
              >
                <Plus aria-hidden />
                Ajouter un parent ou tuteur
              </Button>
            ) : null}
          </div>
        </section>

        <FormSection title="Notes" description="Informations utiles à l'accompagnement (santé, situation familiale…).">
          <Field className="sm:col-span-2" data-invalid={Boolean(errors.notes) || undefined}>
            <FieldLabel htmlFor="child-notes" className="sr-only">
              Notes
            </FieldLabel>
            <Textarea id="child-notes" rows={4} disabled={pending} {...form.register("notes")} />
            <FieldError errors={[errors.notes]} />
          </Field>
        </FormSection>
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 flex justify-end gap-2 border-t bg-card/90 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
        <Link href={childId ? `/enfants/${childId}` : "/enfants"} className={buttonVariants({ variant: "outline" })} aria-disabled={pending}>
          Annuler
        </Link>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {childId ? "Enregistrer les modifications" : "Créer la fiche"}
        </Button>
      </div>
    </form>
  );
}
