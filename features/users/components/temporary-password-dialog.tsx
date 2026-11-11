"use client";

import { Check, Copy, KeyRound } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Affiche UNE SEULE FOIS un mot de passe temporaire (il n'est stocké nulle part en clair).
 * L'administrateur le transmet par un canal sûr ; l'utilisateur devra le changer à la connexion.
 */
export function TemporaryPasswordDialog({
  value,
  onClose,
}: {
  value: { email: string; temporaryPassword: string; title: string } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!value) return;
    await navigator.clipboard.writeText(value.temporaryPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog open={value !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <span className="mb-1 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <KeyRound className="size-5" aria-hidden />
          </span>
          <DialogTitle>{value?.title}</DialogTitle>
          <DialogDescription>
            Mot de passe temporaire de <span className="font-medium text-foreground">{value?.email}</span>. Il ne sera
            plus affiché après fermeture : transmettez-le par un canal sûr.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2 pl-3">
          <code className="flex-1 font-mono text-base tracking-wider select-all">{value?.temporaryPassword}</code>
          <Button type="button" variant="outline" size="sm" onClick={copy} aria-label="Copier le mot de passe">
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? "Copié" : "Copier"}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">L&apos;utilisateur devra choisir son propre mot de passe à la première connexion.</p>

        <DialogFooter>
          <Button type="button" onClick={onClose}>
            J&apos;ai transmis le mot de passe
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
