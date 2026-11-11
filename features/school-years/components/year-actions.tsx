"use client";

import { Archive, ArchiveRestore, Lock, MoreHorizontal, Pencil, PlayCircle, RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { reopenSchoolYearAction, schoolYearOperationAction } from "@/features/school-years/actions";
import { CloseYearDialog } from "@/features/school-years/components/close-year-dialog";
import { type EditableYear, YearFormDialog } from "@/features/school-years/components/year-form-dialog";
import type { SchoolYearStatus } from "@/features/school-years/types";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Confirmable = "activate" | "archive" | "unarchive" | "delete" | "reopen";

const COPY: Record<Confirmable, { title: string; description: string; label: string; destructive: boolean }> = {
  activate: {
    title: "Activer cette année ?",
    description: "Elle devient l'année courante de l'organisation. Une seule année peut être active à la fois.",
    label: "Activer",
    destructive: false,
  },
  archive: {
    title: "Archiver cette année ?",
    description: "Elle sera masquée des listes par défaut. Ses données et son instantané restent intacts et consultables.",
    label: "Archiver",
    destructive: false,
  },
  unarchive: { title: "Désarchiver cette année ?", description: "Elle réapparaîtra dans les listes.", label: "Désarchiver", destructive: false },
  delete: {
    title: "Supprimer cette année ?",
    description: "Possible uniquement parce qu'elle est en préparation et ne contient aucune donnée. L'opération est journalisée.",
    label: "Supprimer",
    destructive: true,
  },
  reopen: {
    title: "Rouvrir exceptionnellement cette année ?",
    description:
      "L'instantané de clôture actuel sera archivé (jamais effacé) et des mouvements pourront de nouveau être enregistrés sur sa période. Une nouvelle clôture sera nécessaire.",
    label: "Rouvrir l'année",
    destructive: true,
  },
};

export function YearActions({
  year,
  status,
  archived,
  isLatestClosed,
  canManage,
  canReopen,
}: {
  year: EditableYear;
  status: SchoolYearStatus;
  archived: boolean;
  isLatestClosed: boolean;
  canManage: boolean;
  canReopen: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState(false);
  const [confirm, setConfirm] = useState<Confirmable | null>(null);

  if (!canManage && !canReopen) return null;

  async function run(reason: string): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!confirm) return { ok: true };
    const result =
      confirm === "reopen"
        ? await reopenSchoolYearAction({ yearId: year.id, reason })
        : await schoolYearOperationAction({ yearId: year.id }, confirm);
    if (!result.ok) return { ok: false, message: result.message };
    toast.success(result.message ?? "Opération effectuée.");
    if (confirm === "delete") router.push("/annees-scolaires");
    else router.refresh();
    return { ok: true };
  }

  const primary =
    canManage && status === "DRAFT" ? (
      <Button onClick={() => setConfirm("activate")}>
        <PlayCircle aria-hidden />
        Activer
      </Button>
    ) : canManage && (status === "ACTIVE" || status === "REOPENED") ? (
      <Button onClick={() => setClosing(true)}>
        <Lock aria-hidden />
        Clôturer
      </Button>
    ) : null;

  const menuItems = [
    canManage && status !== "CLOSED" ? (
      <DropdownMenuItem key="edit" onClick={() => setEditing(true)}>
        <Pencil aria-hidden />
        Modifier
      </DropdownMenuItem>
    ) : null,
    canManage && status === "CLOSED" ? (
      <DropdownMenuItem key="archive" onClick={() => setConfirm(archived ? "unarchive" : "archive")}>
        {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
        {archived ? "Désarchiver" : "Archiver"}
      </DropdownMenuItem>
    ) : null,
    canReopen && status === "CLOSED" && isLatestClosed ? (
      <DropdownMenuItem key="reopen" onClick={() => setConfirm("reopen")} className="text-warning focus:text-warning">
        <RotateCcw aria-hidden />
        Rouvrir (exceptionnel)
      </DropdownMenuItem>
    ) : null,
  ].filter(Boolean);
  const deleteItem =
    canManage && status === "DRAFT" ? (
      <DropdownMenuItem onClick={() => setConfirm("delete")} className="text-destructive focus:text-destructive">
        <Trash2 aria-hidden />
        Supprimer
      </DropdownMenuItem>
    ) : null;

  const copy = confirm ? COPY[confirm] : null;

  return (
    <div className="flex items-center gap-2">
      {primary}
      {menuItems.length > 0 || deleteItem ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="Autres actions" />}>
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            {menuItems}
            {deleteItem ? (
              <>
                {menuItems.length > 0 ? <DropdownMenuSeparator /> : null}
                {deleteItem}
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {canManage ? <YearFormDialog open={editing} onOpenChange={setEditing} year={year} /> : null}
      {canManage ? <CloseYearDialog open={closing} onOpenChange={setClosing} year={year} /> : null}
      {copy ? (
        <ConfirmDialog
          open={confirm !== null}
          onOpenChange={(open) => !open && setConfirm(null)}
          title={copy.title}
          description={copy.description}
          confirmLabel={copy.label}
          destructive={copy.destructive}
          reason={confirm === "reopen" ? { label: "Motif de la réouverture", hint: "Obligatoire, conservé dans l'historique et l'audit.", minLength: 10 } : undefined}
          onConfirm={run}
        />
      ) : null}
    </div>
  );
}
