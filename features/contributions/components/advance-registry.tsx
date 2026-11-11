"use client";

import { AlertCircle, Loader2, PiggyBank } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { applyAdvanceAction, sponsorOpenItemsAction } from "@/features/contributions/actions";
import type { AdvanceRegistry, OpenCommitment } from "@/features/contributions/queries";
import { Money } from "@/components/shared/money";
import { MoneyInput } from "@/components/shared/money-input";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { formatShortDate } from "@/lib/dates";
import { formatXaf } from "@/lib/money";

/** Registre des avances d'un sponsor : encaissé, affecté, disponible, et affectation explicite. */
export function AdvanceRegistryPanel({ sponsorId, registry, canApply }: { sponsorId: string; registry: AdvanceRegistry; canApply: boolean }) {
  const [applying, setApplying] = useState(false);
  return (
    <section className="rounded-xl border bg-card shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <PiggyBank className="size-4 text-muted-foreground" aria-hidden /> Registre des avances
        </h2>
        {canApply ? (
          <Button size="sm" onClick={() => setApplying(true)} disabled={registry.available === 0}>
            Affecter une avance
          </Button>
        ) : null}
      </div>
      <div className="grid gap-px bg-border sm:grid-cols-3">
        {[
          ["Encaissé", registry.received],
          ["Affecté", registry.applied],
          ["Disponible", registry.available],
        ].map(([label, value]) => (
          <div key={label as string} className="bg-card px-5 py-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-base font-semibold">
              <Money amount={value as number} />
            </p>
          </div>
        ))}
      </div>
      {registry.applications.length > 0 ? (
        <ul className="divide-y border-t text-sm">
          {registry.applications.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
              <span className={a.status === "CANCELLED" ? "text-muted-foreground line-through" : undefined}>
                {formatShortDate(a.validatedAt)} · {a.number} → {a.childName} ({a.yearLabel})
              </span>
              <span className="flex items-center gap-2">
                {a.late ? <StatusBadge tone="warning">Tardif</StatusBadge> : null}
                <Money amount={a.amount} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t px-5 py-3 text-sm text-muted-foreground">Aucune affectation d&apos;avance.</p>
      )}
      {registry.sources.length > 0 ? (
        <p className="border-t px-5 py-2.5 text-xs text-muted-foreground">
          Origine :{" "}
          {registry.sources.map((s, i) => (
            <span key={s.paymentId + i}>
              {i > 0 ? ", " : ""}
              <Link href={`/contributions/${s.paymentId}`} className="hover:underline">
                {s.paymentNumber}
              </Link>{" "}
              ({formatXaf(s.available)} disponible)
            </span>
          ))}
        </p>
      ) : null}
      {applying ? <ApplyAdvanceDialog sponsorId={sponsorId} available={registry.available} onClose={() => setApplying(false)} /> : null}
    </section>
  );
}

function ApplyAdvanceDialog({ sponsorId, available, onClose }: { sponsorId: string; available: number; onClose: () => void }) {
  const router = useRouter();
  const [commitments, setCommitments] = useState<OpenCommitment[] | null>(null);
  const [commitmentId, setCommitmentId] = useState("");
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    void sponsorOpenItemsAction(sponsorId).then((result) => {
      if (result.ok) {
        setCommitments(result.data.commitments);
        setCommitmentId(result.data.commitments[0]?.id ?? "");
      } else setError(result.message);
    });
  }, [sponsorId]);

  const selected = commitments?.find((c) => c.id === commitmentId);
  const max = Math.min(available, selected?.remaining ?? 0);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !amount || amount > max) return setError(`Saisissez un montant entre 1 et ${formatXaf(max)}.`);
    startTransition(async () => {
      const result = await applyAdvanceAction({ sponsorId, commitmentId, amount, note });
      if (!result.ok) return void setError(result.message);
      toast.success(result.message ?? "Avance affectée.");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate className="grid gap-5">
          <DialogHeader>
            <DialogTitle>Affecter une avance</DialogTitle>
            <DialogDescription>
              Crédit disponible : {formatXaf(available)}. L&apos;affectation augmente le montant reçu sur l&apos;engagement, sans nouvelle recette en caisse.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
          ) : null}
          {commitments === null ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Chargement des engagements…
            </p>
          ) : commitments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun engagement en attente pour ce sponsor.</p>
          ) : (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="apply-commitment">Engagement</FieldLabel>
                <select
                  id="apply-commitment"
                  value={commitmentId}
                  onChange={(e) => setCommitmentId(e.target.value)}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  disabled={pending}
                >
                  {commitments.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.childName} · {c.yearLabel} — reste {formatXaf(c.remaining)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field data-invalid={Boolean(amount && amount > max) || undefined}>
                <FieldLabel htmlFor="apply-amount">Montant</FieldLabel>
                <MoneyInput id="apply-amount" value={amount} onChange={setAmount} disabled={pending} />
                <FieldDescription>Maximum : {formatXaf(max)}.</FieldDescription>
                {amount && amount > max ? <FieldError>Montant supérieur au maximum.</FieldError> : null}
              </Field>
              <Field>
                <FieldLabel htmlFor="apply-note">Note (facultatif)</FieldLabel>
                <Textarea id="apply-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={pending} />
              </Field>
            </FieldGroup>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Retour
            </Button>
            <Button type="submit" disabled={pending || !selected}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Valider l&apos;affectation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
