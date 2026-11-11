"use client";

import { Camera, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useTransition } from "react";
import { toast } from "sonner";

import { removeChildPhotoAction, uploadChildPhotoAction } from "@/features/children/actions";
import { ChildAvatar } from "@/features/children/components/child-avatar";
import { Button } from "@/components/ui/button";

const MAX_BYTES = 3 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

/**
 * Photo de l'enfant. Contrôle immédiat dans le navigateur (confort) ; le serveur revérifie la taille
 * et le CONTENU réel du fichier avant de l'envoyer vers Cloudinary en ressource privée.
 */
export function ChildPhotoEditor({
  childId,
  name,
  photoUrl,
  canEdit,
}: {
  childId: string;
  name: string;
  photoUrl: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  function onFile(file: File | undefined) {
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) return void toast.error("Format non accepté : JPEG, PNG ou WebP.");
    if (file.size > MAX_BYTES) return void toast.error("La photo ne doit pas dépasser 3 Mo.");
    const data = new FormData();
    data.set("childId", childId);
    data.set("photo", file);
    startTransition(async () => {
      const result = await uploadChildPhotoAction(data);
      if (input.current) input.current.value = "";
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message ?? "Photo mise à jour.");
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await removeChildPhotoAction(childId);
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message ?? "Photo supprimée.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        <ChildAvatar name={name} photoUrl={photoUrl} size={88} className="ring-4 ring-card shadow-sm" />
        {pending ? (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70" aria-live="polite">
            <Loader2 className="size-5 animate-spin text-primary" aria-label="Envoi en cours" />
          </span>
        ) : null}
      </div>
      {canEdit ? (
        <div className="flex items-center gap-1">
          <input ref={input} type="file" accept={ACCEPTED.join(",")} className="sr-only" tabIndex={-1} onChange={(event) => onFile(event.target.files?.[0])} />
          <Button type="button" variant="ghost" size="xs" onClick={() => input.current?.click()} disabled={pending}>
            <Camera aria-hidden />
            {photoUrl ? "Changer" : "Ajouter une photo"}
          </Button>
          {photoUrl ? (
            <Button type="button" variant="ghost" size="icon-xs" onClick={remove} disabled={pending} aria-label="Supprimer la photo">
              <Trash2 />
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
