"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { adjustExpectedAction, cancelCommitmentAction, createCommitmentAction, updateCommitmentAction } from "@/features/commitments/actions";
import { MoneyInput } from "@/components/shared/money-input";
import { Money } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

export type CommitmentMode =
  | { kind: "create"; sponsorshipId: string }
  | { kind: "edit"; commitmentId: string; committedAmount: number }
  | { kind: "adjust"; commitmentId: string; committedAmount: number; expectedAmount: number }
  | { kind: "cancel"; commitmentId: string; committedAmount: number };

const TITLES: Record<CommitmentMode["kind"], string> = {
  create: "Définir l'engagement",
  edit: "Modifier le montant engagé",
  adjust: "Ajuster le montant attendu",
  cancel: "Annuler l'engagement",
};

/** Saisie d'un engagement ; le serveur revérifie : affecté ≤ attendu ≤ engagé, année ouverte. */
export function CommitmentDialog({ mode, context, onClose }: { mode: CommitmentMode; context: string; onClose: () => void }) {
  const router = useRouter();
  const initial = mode.kind === "adjust" ? mode.expectedAmount : mode.kind === "create" ? undefined : mode.committedAmount;
  const [amount, setAmount] = useState<number | undefined>(initial);
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const needsReason = mode.kind === "adjust" || mode.kind === "cancel";

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const local: Record<string, string> = {};
    if (mode.kind !== "cancel" && (amount === undefined || (mode.kind !== "adjust" && amount <= 0))) local.amount = "Saisissez un montant.";
    if (needsReason && text.trim().length < 5) local.reason = "Le motif doit contenir au moins 5 caractères.";
    setErrors(local);
    if (Object.keys(local).length) return;
    startTransition(async () => {
      const result =
        mode.kind === "create"
          ? await createCommitmentAction({ sponsorshipId: mode.sponsorshipId, committedAmount: amount, notes: text })
          : mode.kind === "edit"
            ? await updateCommitmentAction({ commitmentId: mode.commitmentId, committedAmount: amount, notes: text })
            : mode.kind === "adjust"
              ? await adjustExpectedAction({ commitmentId: mode.commitmentId, expectedAmount: amount, reason: text })
              : await cancelCommitmentAction({ commitmentId: mode.commitmentId, reason: text });
      if (!result.ok) {
        const fe = result.fieldErrors ?? {};
        setErrors({ amount: fe.committedAmount?.[0] ?? fe.expectedAmount?.[0] ?? "", reason: fe.reason?.[0] ?? "" });
        return void setFormError(result.message);
      }
      toast.success(result.message ?? "Engagement mis à jour.");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{TITLES[mode.kind]}</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{context}</span>
              {mode.kind === "create" ? " — montant que le sponsor s'engage à verser pour cet enfant sur l'année." : null}
              {mode.kind === "adjust" ? (
                <>
                  {" "}
                  — engagé : <Money amount={mode.committedAmount} />. Le montant attendu peut être réduit (ex. fin anticipée), jamais sous le montant déjà reçu.
                </>
              ) : null}
              {mode.kind === "cancel" ? " — possible uniquement si aucun versement n'a encore été affecté à cet engagement." : null}
            </DialogDescription>
          </DialogHeader>
          {formError ? (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{formError}</span>
            </div>
          ) : null}
          <FieldGroup>
            {mode.kind !== "cancel" ? (
              <Field data-invalid={Boolean(errors.amount) || undefined}>
                <FieldLabel htmlFor="commitment-amount">{mode.kind === "adjust" ? "Nouveau montant attendu" : "Montant engagé"}</FieldLabel>
                <MoneyInput id="commitment-amount" value={amount} onChange={setAmount} disabled={pending} autoFocus aria-invalid={Boolean(errors.amount) || undefined} />
                {mode.kind === "edit" ? <FieldDescription>Ne peut pas être inférieur au montant déjà reçu.</FieldDescription> : null}
                {errors.amount ? <FieldError>{errors.amount}</FieldError> : null}
              </Field>
            ) : null}
            <Field data-invalid={Boolean(errors.reason) || undefined}>
              <FieldLabel htmlFor="commitment-text">{needsReason ? "Motif" : "Notes (facultatif)"}</FieldLabel>
              <Textarea id="commitment-text" rows={2} maxLength={500} value={text} onChange={(event) => setText(event.target.value)} disabled={pending} />
              {errors.reason ? <FieldError>{errors.reason}</FieldError> : null}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Retour
            </Button>
            <Button type="submit" variant={mode.kind === "cancel" ? "destructive" : "default"} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {mode.kind === "cancel" ? "Annuler l'engagement" : "Enregistrer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
