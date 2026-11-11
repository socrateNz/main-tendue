"use client";

import { Archive, CirclePause, CirclePlay, MoreHorizontal, Pencil } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { setSponsorStatusAction } from "@/features/sponsors/actions";
import type { SponsorStatus } from "@/features/sponsors/types";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const COPY: Record<SponsorStatus, { title: string; description: string; label: string; destructive: boolean }> = {
  ACTIVE: { title: "Réactiver ce sponsor ?", description: "Il pourra de nouveau parrainer des enfants.", label: "Réactiver", destructive: false },
  INACTIVE: {
    title: "Rendre ce sponsor inactif ?",
    description: "Il ne sera plus proposé pour de nouveaux parrainages. Impossible tant qu'il a des parrainages actifs. Son historique est conservé.",
    label: "Rendre inactif",
    destructive: true,
  },
  ARCHIVED: {
    title: "Archiver ce sponsor ?",
    description: "La fiche ne sera plus modifiable ni proposée. Impossible tant qu'il a des parrainages actifs. Son historique est conservé.",
    label: "Archiver",
    destructive: true,
  },
};

export function SponsorActions({ sponsorId, status, canWrite }: { sponsorId: string; status: SponsorStatus; canWrite: boolean }) {
  const router = useRouter();
  const [target, setTarget] = useState<SponsorStatus | null>(null);
  if (!canWrite) return null;

  async function run(reason: string): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!target) return { ok: true };
    const result = await setSponsorStatusAction({ sponsorId, status: target, reason });
    if (!result.ok) return { ok: false, message: result.message };
    toast.success(result.message ?? "Statut mis à jour.");
    router.refresh();
    return { ok: true };
  }

  const copy = target ? COPY[target] : null;
  return (
    <div className="flex items-center gap-2">
      {status !== "ARCHIVED" ? (
        <Link href={`/sponsors/${sponsorId}/modifier`} className={buttonVariants()}>
          <Pencil aria-hidden />
          Modifier
        </Link>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="Changer le statut" />}>
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          {status !== "ACTIVE" ? (
            <DropdownMenuItem onClick={() => setTarget("ACTIVE")}>
              <CirclePlay aria-hidden />
              Réactiver
            </DropdownMenuItem>
          ) : null}
          {status === "ACTIVE" ? (
            <DropdownMenuItem onClick={() => setTarget("INACTIVE")}>
              <CirclePause aria-hidden />
              Rendre inactif
            </DropdownMenuItem>
          ) : null}
          {status !== "ARCHIVED" ? (
            <DropdownMenuItem onClick={() => setTarget("ARCHIVED")} className="text-destructive focus:text-destructive">
              <Archive aria-hidden />
              Archiver
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {copy ? (
        <ConfirmDialog
          open={target !== null}
          onOpenChange={(open) => !open && setTarget(null)}
          title={copy.title}
          description={copy.description}
          confirmLabel={copy.label}
          destructive={copy.destructive}
          reason={target === "ACTIVE" ? undefined : { label: "Motif", minLength: 5 }}
          onConfirm={run}
        />
      ) : null}
    </div>
  );
}
