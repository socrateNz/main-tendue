"use client";

import { Loader2 } from "lucide-react";
import { useId, useState, useTransition } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

type ConfirmResult = { ok: true } | { ok: false; message: string };

/**
 * Confirmation d'une action sensible (archivage, annulation d'un mouvement financier…).
 * Avec `reason`, un motif est exigé avant validation (annulations financières).
 * La fenêtre reste ouverte et affiche l'erreur si l'action échoue.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirmer",
  destructive = false,
  reason,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  reason?: { label: string; hint?: string; minLength?: number };
  onConfirm: (reason: string) => Promise<ConfirmResult>;
}) {
  const reasonId = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const minLength = reason?.minLength ?? 5;
  const reasonInvalid = reason !== undefined && value.trim().length < minLength;

  function handleOpenChange(next: boolean) {
    if (pending) return;
    if (!next) {
      setValue("");
      setError(null);
    }
    onOpenChange(next);
  }

  function confirm() {
    if (reasonInvalid) {
      setError(`Le motif doit contenir au moins ${minLength} caractères.`);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await onConfirm(value.trim());
      if (result.ok) {
        setValue("");
        onOpenChange(false);
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        {reason ? (
          <Field data-invalid={Boolean(error && reasonInvalid) || undefined}>
            <FieldLabel htmlFor={reasonId}>{reason.label}</FieldLabel>
            <Textarea
              id={reasonId}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              rows={3}
              maxLength={500}
              disabled={pending}
              aria-invalid={Boolean(error && reasonInvalid) || undefined}
            />
            {reason.hint ? <FieldDescription>{reason.hint}</FieldDescription> : null}
          </Field>
        ) : null}

        {error ? <FieldError>{error}</FieldError> : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Retour</AlertDialogCancel>
          <Button variant={destructive ? "destructive" : "default"} onClick={confirm} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
