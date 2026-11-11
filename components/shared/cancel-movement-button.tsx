"use client";

import { Ban } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/errors";

/**
 * Annulation d'un mouvement financier (versement, affectation, dépense) : motif obligatoire.
 * Le mouvement reste consultable avec le statut « Annulé » ; la permission est vérifiée côté serveur.
 */
export function CancelMovementButton({
  id,
  label,
  title,
  description,
  action,
  size = "default",
}: {
  id: string;
  label: string;
  title: string;
  description: string;
  action: (input: { id: string; reason: string }) => Promise<ActionResult>;
  size?: "default" | "sm";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="destructive" size={size} onClick={() => setOpen(true)}>
        <Ban aria-hidden />
        {label}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        confirmLabel={label}
        destructive
        reason={{ label: "Motif de l'annulation", hint: "Obligatoire. Conservé avec l'auteur et l'heure dans l'historique.", minLength: 5 }}
        onConfirm={async (reason) => {
          const result = await action({ id, reason });
          if (!result.ok) return { ok: false, message: result.message };
          toast.success(result.message ?? "Annulé.");
          router.refresh();
          return { ok: true };
        }}
      />
    </>
  );
}
