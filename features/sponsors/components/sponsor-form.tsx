"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Building2, Loader2, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { createSponsorAction, updateSponsorAction } from "@/features/sponsors/actions";
import { type SponsorData, type SponsorInput, sponsorSchema } from "@/features/sponsors/schemas";
import { FormSection } from "@/components/shared/form-section";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { countryOptions } from "@/lib/countries";
import { cn } from "@/lib/utils";

type FlatField = "firstName" | "lastName" | "organizationName" | "email" | "phone" | "secondaryPhone" | "notes";
type AddressField = "address.line1" | "address.line2" | "address.postalCode" | "address.city" | "address.country";

export function SponsorForm({ sponsorId, defaultValues }: { sponsorId?: string; defaultValues?: SponsorInput }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const countries = useMemo(() => countryOptions(), []);

  const form = useForm<SponsorInput, unknown, SponsorData>({
    resolver: zodResolver(sponsorSchema),
    defaultValues: defaultValues ?? {
      kind: "PERSON",
      firstName: "",
      lastName: "",
      organizationName: "",
      email: "",
      phone: "",
      secondaryPhone: "",
      address: { line1: "", line2: "", postalCode: "", city: "", country: "CM" },
      notes: "",
    },
  });
  const { errors } = form.formState;
  const kind = useWatch({ control: form.control, name: "kind" });

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = sponsorId ? await updateSponsorAction({ sponsorId, data: values }) : await createSponsorAction(values);
      if (!result.ok) {
        let first = true;
        for (const [path, messages] of Object.entries(result.fieldErrors ?? {})) {
          if (!messages[0]) continue;
          form.setError(path as FlatField, { type: "server", message: messages[0] }, { shouldFocus: first });
          first = false;
        }
        return void setFormError(result.message);
      }
      toast.success(result.message ?? "Enregistré.");
      const id = sponsorId ?? (result.data && "sponsorId" in result.data ? result.data.sponsorId : null);
      router.push(id ? `/sponsors/${id}` : "/sponsors");
      router.refresh();
    });
  }, () => setFormError("Certains champs sont à corriger."));

  const errorOf = (name: FlatField | AddressField) =>
    name.startsWith("address.") ? errors.address?.[name.slice(8) as "line1"] : errors[name as FlatField];

  const text = (name: FlatField | AddressField, label: string, options: { type?: string; className?: string; hint?: string; autoComplete?: string } = {}) => {
    const error = errorOf(name);
    return (
      <Field data-invalid={Boolean(error) || undefined} className={options.className}>
        <FieldLabel htmlFor={`sponsor-${name}`}>{label}</FieldLabel>
        <Input
          id={`sponsor-${name}`}
          type={options.type ?? "text"}
          autoComplete={options.autoComplete ?? "off"}
          disabled={pending}
          aria-invalid={Boolean(error) || undefined}
          {...form.register(name)}
        />
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
        <FormSection title="Identité" description="Un sponsor peut être un particulier ou une organisation (association, entreprise, paroisse…).">
          <fieldset className="sm:col-span-2">
            <legend className="mb-2 text-sm font-medium">Type de sponsor</legend>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["PERSON", "Particulier", UserRound],
                  ["ORGANIZATION", "Organisation", Building2],
                ] as const
              ).map(([value, label, Icon]) => (
                <label
                  key={value}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                    kind === value ? "border-primary bg-primary/5 font-medium text-primary" : "hover:bg-muted/50",
                  )}
                >
                  <input type="radio" value={value} className="sr-only" disabled={pending} {...form.register("kind")} />
                  <Icon className="size-4" aria-hidden />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          {kind === "ORGANIZATION" ? (
            text("organizationName", "Nom de l'organisation", { className: "sm:col-span-2" })
          ) : (
            <>
              {text("lastName", "Nom")}
              {text("firstName", "Prénom")}
            </>
          )}
        </FormSection>

        <FormSection title="Contacts" description="Au moins une adresse e-mail ou un téléphone, pour transmettre les nouvelles et les vidéos.">
          {text("email", "E-mail", { type: "email", className: "sm:col-span-2", hint: "Une adresse ne peut identifier qu'un seul sponsor." })}
          {text("phone", "Téléphone", { type: "tel" })}
          {text("secondaryPhone", "Téléphone secondaire", { type: "tel" })}
        </FormSection>

        <FormSection title="Adresse">
          {text("address.line1", "Adresse", { className: "sm:col-span-2" })}
          {text("address.line2", "Complément", { className: "sm:col-span-2" })}
          {text("address.postalCode", "Code postal")}
          {text("address.city", "Ville")}
          <Field data-invalid={Boolean(errors.address?.country) || undefined} className="sm:col-span-2">
            <FieldLabel htmlFor="sponsor-country">Pays</FieldLabel>
            <select
              id="sponsor-country"
              disabled={pending}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              {...form.register("address.country")}
            >
              <optgroup label="Pays fréquents">
                {countries.preferred.map((country) => (
                  <option key={country.value} value={country.value}>
                    {country.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Tous les pays">
                {countries.others.map((country) => (
                  <option key={country.value} value={country.value}>
                    {country.label}
                  </option>
                ))}
              </optgroup>
            </select>
            <FieldError errors={[errors.address?.country]} />
          </Field>
        </FormSection>

        <FormSection title="Notes" description="Préférences de contact, langue, informations utiles.">
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="sponsor-notes" className="sr-only">
              Notes
            </FieldLabel>
            <Textarea id="sponsor-notes" rows={4} disabled={pending} {...form.register("notes")} />
          </Field>
        </FormSection>
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 flex justify-end gap-2 border-t bg-card/90 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
        <Link href={sponsorId ? `/sponsors/${sponsorId}` : "/sponsors"} className={buttonVariants({ variant: "outline" })}>
          Annuler
        </Link>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {sponsorId ? "Enregistrer les modifications" : "Créer le sponsor"}
        </Button>
      </div>
    </form>
  );
}
