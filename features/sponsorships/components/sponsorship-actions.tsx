"use client";

import { Ban, CirclePause, CirclePlay, CircleStop, HandCoins, Loader2, MoreHorizontal, Pencil, Scale, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { CommitmentDialog, type CommitmentMode } from "@/features/commitments/components/commitment-dialog";
import { transitionSponsorshipAction } from "@/features/sponsorships/actions";
import type { SponsorshipTransition } from "@/features/sponsorships/schemas";
import type { SponsorshipView } from "@/features/sponsorships/queries";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, toDateInput } from "@/lib/dates";

const COPY: Record<SponsorshipTransition, { title: string; description: string; label: string; destructive: boolean }> = {
  suspend: {
    title: "Suspendre le parrainage ?",
    description: "Le parrainage reste enregistré et pourra être repris. Le sponsor ne pourra pas être désactivé tant que d'autres parrainages restent actifs.",
    label: "Suspendre",
    destructive: false,
  },
  resume: { title: "Réactiver le parrainage ?", description: "Il redevient actif ; une éventuelle date de fin est retirée.", label: "Réactiver", destructive: false },
  end: {
    title: "Terminer le parrainage ?",
    description: "Indiquez la date de fin effective. L'historique, l'engagement et les versements éventuels sont conservés.",
    label: "Terminer",
    destructive: true,
  },
  cancel: {
    title: "Annuler le parrainage ?",
    description: "À utiliser pour un parrainage créé par erreur. Il reste visible avec le statut « Annulé ». Impossible s'il porte un engagement financier actif.",
    label: "Annuler le parrainage",
    destructive: true,
  },
};

/** Menu d'actions d'un parrainage ; toutes les règles sont revérifiées côté serveur. */
export function SponsorshipActions({
  sponsorship,
  onEdit,
  canWrite = true,
  canManageCommitment = false,
}: {
  sponsorship: SponsorshipView;
  onEdit: () => void;
  canWrite?: boolean;
  canManageCommitment?: boolean;
}) {
  const [transition, setTransition] = useState<SponsorshipTransition | null>(null);
  const [commitmentMode, setCommitmentMode] = useState<CommitmentMode | null>(null);
  if (sponsorship.year.status === "CLOSED" || (!canWrite && !canManageCommitment)) return null;
  const commitment = sponsorship.commitment && sponsorship.commitment.status === "ACTIVE" ? sponsorship.commitment : null;

  const status = sponsorship.status;
  const items: Array<{ key: SponsorshipTransition; label: string; icon: typeof Ban }> = [];
  if (status === "ACTIVE") items.push({ key: "suspend", label: "Suspendre", icon: CirclePause });
  if (status !== "ACTIVE") items.push({ key: "resume", label: "Réactiver", icon: CirclePlay });
  if (status === "ACTIVE" || status === "SUSPENDED") items.push({ key: "end", label: "Terminer…", icon: CircleStop });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Actions du parrainage" />}>
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          {canManageCommitment && status !== "CANCELLED" ? (
            commitment ? (
              <>
                <DropdownMenuItem onClick={() => setCommitmentMode({ kind: "edit", commitmentId: commitment.id, committedAmount: commitment.committedAmount })}>
                  <HandCoins aria-hidden />
                  Modifier l&apos;engagement
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setCommitmentMode({ kind: "adjust", commitmentId: commitment.id, committedAmount: commitment.committedAmount, expectedAmount: commitment.expectedAmount })}
                >
                  <Scale aria-hidden />
                  Ajuster le montant attendu
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setCommitmentMode({ kind: "cancel", commitmentId: commitment.id, committedAmount: commitment.committedAmount })}>
                  <XCircle aria-hidden />
                  Annuler l&apos;engagement
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem onClick={() => setCommitmentMode({ kind: "create", sponsorshipId: sponsorship.id })}>
                <HandCoins aria-hidden />
                Définir l&apos;engagement
              </DropdownMenuItem>
            )
          ) : null}
          {canManageCommitment && canWrite && status !== "CANCELLED" ? <DropdownMenuSeparator /> : null}
          {canWrite && status !== "CANCELLED" ? (
            <DropdownMenuItem onClick={onEdit}>
              <Pencil aria-hidden />
              Modifier les dates
            </DropdownMenuItem>
          ) : null}
          {(canWrite ? items : []).map(({ key, label, icon: Icon }) => (
            <DropdownMenuItem key={key} onClick={() => setTransition(key)}>
              <Icon aria-hidden />
              {label}
            </DropdownMenuItem>
          ))}
          {canWrite && status !== "CANCELLED" ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setTransition("cancel")} className="text-destructive focus:text-destructive">
                <Ban aria-hidden />
                Annuler (erreur de saisie)
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {transition ? <TransitionDialog key={transition} sponsorship={sponsorship} transition={transition} onClose={() => setTransition(null)} /> : null}
      {commitmentMode ? (
        <CommitmentDialog
          mode={commitmentMode}
          context={`${sponsorship.sponsor.name} → ${sponsorship.child.name} (${sponsorship.year.label})`}
          onClose={() => setCommitmentMode(null)}
        />
      ) : null}
    </>
  );
}

function TransitionDialog({ sponsorship, transition, onClose }: { sponsorship: SponsorshipView; transition: SponsorshipTransition; onClose: () => void }) {
  const router = useRouter();
  const copy = COPY[transition];
  const [reason, setReason] = useState("");
  const [endDate, setEndDate] = useState(toDateInput(new Date()));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    const local: Record<string, string> = {};
    if (transition !== "resume" && reason.trim().length < 5) local.reason = "Le motif doit contenir au moins 5 caractères.";
    if (transition === "end" && !endDate) local.endDate = "La date de fin est obligatoire.";
    setErrors(local);
    if (Object.keys(local).length) return;
    startTransition(async () => {
      const result = await transitionSponsorshipAction({ sponsorshipId: sponsorship.id, transition, reason, endDate: transition === "end" ? endDate : undefined });
      if (!result.ok) {
        setErrors(Object.fromEntries(Object.entries(result.fieldErrors ?? {}).map(([key, messages]) => [key, messages[0] ?? ""])));
        return void setFormError(result.message);
      }
      toast.success(result.message ?? "Parrainage mis à jour.");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">
              {sponsorship.sponsor.name} → {sponsorship.child.name}
            </span>{" "}
            ({sponsorship.year.label}). {copy.description}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          {transition === "end" ? (
            <Field data-invalid={Boolean(errors.endDate) || undefined}>
              <FieldLabel htmlFor="tr-end">Date de fin</FieldLabel>
              <Input id="tr-end" type="date" value={endDate} min={toDateInput(sponsorship.startDate)} onChange={(event) => setEndDate(event.target.value)} disabled={pending} />
              <FieldDescription>Début du parrainage : {formatDate(sponsorship.startDate)}.</FieldDescription>
              {errors.endDate ? <FieldError>{errors.endDate}</FieldError> : null}
            </Field>
          ) : null}
          {transition !== "resume" ? (
            <Field data-invalid={Boolean(errors.reason) || undefined}>
              <FieldLabel htmlFor="tr-reason">Motif</FieldLabel>
              <Textarea id="tr-reason" rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} disabled={pending} />
              {errors.reason ? <FieldError>{errors.reason}</FieldError> : null}
            </Field>
          ) : null}
        </FieldGroup>
        {formError ? (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Retour
          </Button>
          <Button variant={copy.destructive ? "destructive" : "default"} onClick={confirm} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {copy.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
