"use client";

import { Loader2, Paperclip } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/errors";

const ACCEPTED = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

/** Ajout d'un justificatif (PDF ou image, 3 Mo) ; le serveur revérifie le contenu réel du fichier. */
export function FileUploadButton({ id, action, label = "Ajouter un justificatif" }: { id: string; action: (data: FormData) => Promise<ActionResult>; label?: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  function onFile(file: File | undefined) {
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) return void toast.error("Format non accepté : PDF, JPEG, PNG ou WebP.");
    if (file.size > 3 * 1024 * 1024) return void toast.error("Le fichier ne doit pas dépasser 3 Mo.");
    const data = new FormData();
    data.set("id", id);
    data.set("file", file);
    startTransition(async () => {
      const result = await action(data);
      if (input.current) input.current.value = "";
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message ?? "Justificatif ajouté.");
      router.refresh();
    });
  }

  return (
    <>
      <input ref={input} type="file" accept={ACCEPTED.join(",")} className="sr-only" tabIndex={-1} onChange={(e) => onFile(e.target.files?.[0])} />
      <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Paperclip aria-hidden />}
        {label}
      </Button>
    </>
  );
}
