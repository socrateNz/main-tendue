"use client";

import { Archive, ArchiveRestore, Pencil } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { archiveChildAction, unarchiveChildAction } from "@/features/children/actions";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button, buttonVariants } from "@/components/ui/button";

export function ChildActions({
  childId,
  name,
  archived,
  canWrite,
  canArchive,
}: {
  childId: string;
  name: string;
  archived: boolean;
  canWrite: boolean;
  canArchive: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);

  async function run(reason: string): Promise<{ ok: true } | { ok: false; message: string }> {
    const result = archived ? await unarchiveChildAction(childId) : await archiveChildAction({ childId, reason });
    if (!result.ok) return { ok: false, message: result.message };
    toast.success(result.message ?? "Fiche mise à jour.");
    router.refresh();
    return { ok: true };
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canArchive ? (
        <Button variant="outline" onClick={() => setConfirming(true)}>
          {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
          {archived ? "Réactiver" : "Archiver"}
        </Button>
      ) : null}
      {canWrite && !archived ? (
        <Link href={`/enfants/${childId}/modifier`} className={buttonVariants()}>
          <Pencil aria-hidden />
          Modifier
        </Link>
      ) : null}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={archived ? `Réactiver la fiche de ${name} ?` : `Archiver la fiche de ${name} ?`}
        description={
          archived
            ? "La fiche redeviendra active et modifiable."
            : "La fiche ne sera plus modifiable ni proposée pour de nouveaux parrainages. Tout son historique (scolarité, parrainages, contributions, dépenses) est conservé."
        }
        confirmLabel={archived ? "Réactiver" : "Archiver"}
        destructive={!archived}
        reason={archived ? undefined : { label: "Motif de l'archivage", hint: "Ex. fin de scolarité, départ de la région.", minLength: 5 }}
        onConfirm={run}
      />
    </div>
  );
}
