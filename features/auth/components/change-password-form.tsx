"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { changePasswordAction } from "@/features/auth/actions";
import { type ChangePasswordInput, changePasswordSchema } from "@/features/auth/schemas";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { HOME_PATH } from "@/lib/auth/config";
import { applyServerErrors } from "@/lib/forms";

const FIELDS = ["currentPassword", "newPassword", "confirmPassword"] as const;

export function ChangePasswordForm({ mandatory, redirectTo = HOME_PATH }: { mandatory: boolean; redirectTo?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await changePasswordAction(values);
      if (result.ok) {
        toast.success(result.message ?? "Mot de passe modifié.");
        form.reset();
        router.replace(redirectTo);
        router.refresh();
      } else {
        setFormError(applyServerErrors(result, form.setError, FIELDS));
      }
    });
  });

  const labels: Record<(typeof FIELDS)[number], { label: string; autoComplete: string; hint?: string }> = {
    currentPassword: { label: mandatory ? "Mot de passe temporaire" : "Mot de passe actuel", autoComplete: "current-password" },
    newPassword: {
      label: "Nouveau mot de passe",
      autoComplete: "new-password",
      hint: "12 caractères minimum, avec au moins une lettre et un chiffre. Une phrase de passe est idéale.",
    },
    confirmPassword: { label: "Confirmation", autoComplete: "new-password" },
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {formError ? (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{formError}</span>
        </div>
      ) : null}
      <FieldGroup>
        {FIELDS.map((name) => (
          <Field key={name} data-invalid={Boolean(errors[name]) || undefined}>
            <FieldLabel htmlFor={name}>{labels[name].label}</FieldLabel>
            <Input
              id={name}
              type="password"
              autoComplete={labels[name].autoComplete}
              disabled={pending}
              aria-invalid={Boolean(errors[name]) || undefined}
              {...form.register(name)}
            />
            {labels[name].hint && !errors[name] ? <FieldDescription>{labels[name].hint}</FieldDescription> : null}
            <FieldError errors={[errors[name]]} />
          </Field>
        ))}
      </FieldGroup>
      <Button type="submit" className="w-full sm:w-auto" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Enregistrer le nouveau mot de passe
      </Button>
    </form>
  );
}
