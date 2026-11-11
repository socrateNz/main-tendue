"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { createUserAction, updateUserAction } from "@/features/users/actions";
import type { UserListItem } from "@/features/users/service";
import { createUserSchema } from "@/features/auth/schemas";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROLE_LABELS, ROLES, type Role } from "@/lib/auth/permissions";
import { applyServerErrors } from "@/lib/forms";

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  SUPER_ADMIN: "Accès complet, gestion des comptes, annulations et réouvertures.",
  ADMIN: "Gestion complète du programme, sans comptes ni annulations financières.",
  FINANCE_MANAGER: "Engagements, versements, dépenses, annulations et rapports financiers.",
  CHILD_MANAGER: "Fiches enfants, établissements et scolarité.",
  MEDIA_MANAGER: "Vidéos de remerciement et liens d'accès des sponsors.",
};

const ROLE_ITEMS = ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }));

// Le formulaire de modification ne touche pas à l'adresse e-mail (identifiant de connexion).
const formSchema = createUserSchema;
type FormValues = z.infer<typeof formSchema>;
const FIELDS = ["email", "firstName", "lastName", "role"] as const;

export function UserFormDialog({
  open,
  onOpenChange,
  user,
  currentUserId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Compte à modifier ; absent pour une création. */
  user?: UserListItem | null;
  currentUserId: string;
  onCreated: (result: { email: string; temporaryPassword: string }) => void;
}) {
  const editing = Boolean(user);
  const isSelf = user?.id === currentUserId;
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    values: user
      ? { email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role }
      : { email: "", firstName: "", lastName: "", role: "CHILD_MANAGER" },
  });
  const { errors } = form.formState;
  const selectedRole = useWatch({ control: form.control, name: "role" });

  function handleOpenChange(next: boolean) {
    if (pending) return;
    if (!next) {
      form.reset();
      setFormError(null);
    }
    onOpenChange(next);
  }

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      if (user) {
        const result = await updateUserAction({ userId: user.id, firstName: values.firstName, lastName: values.lastName, role: values.role });
        if (!result.ok) return void setFormError(applyServerErrors(result, form.setError, FIELDS));
        toast.success(result.message ?? "Compte mis à jour.");
      } else {
        const result = await createUserAction(values);
        if (!result.ok) return void setFormError(applyServerErrors(result, form.setError, FIELDS));
        onCreated({ email: values.email, temporaryPassword: result.data.temporaryPassword });
      }
      form.reset();
      onOpenChange(false);
    });
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit} noValidate className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{editing ? "Modifier le compte" : "Nouveau compte"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Le rôle détermine les actions autorisées. L'adresse e-mail ne peut pas être modifiée."
                : "Un mot de passe temporaire sera généré ; il devra être changé à la première connexion."}
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
              <Field data-invalid={Boolean(errors.firstName) || undefined}>
                <FieldLabel htmlFor="user-firstName">Prénom</FieldLabel>
                <Input id="user-firstName" autoComplete="off" disabled={pending} aria-invalid={Boolean(errors.firstName) || undefined} {...form.register("firstName")} />
                <FieldError errors={[errors.firstName]} />
              </Field>
              <Field data-invalid={Boolean(errors.lastName) || undefined}>
                <FieldLabel htmlFor="user-lastName">Nom</FieldLabel>
                <Input id="user-lastName" autoComplete="off" disabled={pending} aria-invalid={Boolean(errors.lastName) || undefined} {...form.register("lastName")} />
                <FieldError errors={[errors.lastName]} />
              </Field>
            </div>

            <Field data-invalid={Boolean(errors.email) || undefined}>
              <FieldLabel htmlFor="user-email">Adresse e-mail</FieldLabel>
              <Input
                id="user-email"
                type="email"
                autoComplete="off"
                disabled={pending || editing}
                readOnly={editing}
                aria-invalid={Boolean(errors.email) || undefined}
                {...form.register("email")}
              />
              <FieldError errors={[errors.email]} />
            </Field>

            <Field data-invalid={Boolean(errors.role) || undefined}>
              <FieldLabel htmlFor="user-role">Rôle</FieldLabel>
              <Controller
                control={form.control}
                name="role"
                render={({ field }) => (
                  <Select
                    items={ROLE_ITEMS}
                    value={field.value}
                    onValueChange={(value) => value && field.onChange(value)}
                    disabled={pending || isSelf}
                  >
                    <SelectTrigger id="user-role" className="w-full" aria-invalid={Boolean(errors.role) || undefined}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_ITEMS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldDescription>
                {isSelf ? "Vous ne pouvez pas modifier votre propre rôle." : ROLE_DESCRIPTIONS[selectedRole]}
              </FieldDescription>
              <FieldError errors={[errors.role]} />
            </Field>
          </FieldGroup>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
              Annuler
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {editing ? "Enregistrer" : "Créer le compte"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
