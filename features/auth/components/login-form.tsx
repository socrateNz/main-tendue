"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { loginAction } from "@/features/auth/actions";
import { type LoginInput, loginSchema } from "@/features/auth/schemas";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { applyServerErrors } from "@/lib/forms";

export function LoginForm() {
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      // En cas de succès, l'action redirige ; on ne revient ici qu'en cas d'erreur.
      // Destination demandée avant la redirection vers la connexion (validée côté serveur).
      const next = new URLSearchParams(window.location.search).get("next") ?? undefined;
      const result = await loginAction({ ...values, next });
      if (!result.ok) {
        form.resetField("password");
        setFormError(applyServerErrors(result, form.setError, ["email", "password"]));
      }
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="rounded-xl border bg-card p-6 shadow-panel sm:p-7">
      <div className="mb-6 space-y-1">
        <h1 className="text-lg font-semibold tracking-tight">Connexion</h1>
        <p className="text-sm text-muted-foreground">Saisissez vos identifiants pour accéder à l&apos;espace de gestion.</p>
      </div>

      {formError ? (
        <div role="alert" className="mb-5 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{formError}</span>
        </div>
      ) : null}

      <FieldGroup>
        <Field data-invalid={Boolean(errors.email) || undefined}>
          <FieldLabel htmlFor="email">Adresse e-mail</FieldLabel>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            autoFocus
            disabled={pending}
            aria-invalid={Boolean(errors.email) || undefined}
            {...form.register("email")}
          />
          <FieldError errors={[errors.email]} />
        </Field>

        <Field data-invalid={Boolean(errors.password) || undefined}>
          <FieldLabel htmlFor="password">Mot de passe</FieldLabel>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              disabled={pending}
              className="pr-10"
              aria-invalid={Boolean(errors.password) || undefined}
              {...form.register("password")}
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              className="absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          <FieldError errors={[errors.password]} />
        </Field>

        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {pending ? "Connexion…" : "Se connecter"}
        </Button>
      </FieldGroup>
    </form>
  );
}
