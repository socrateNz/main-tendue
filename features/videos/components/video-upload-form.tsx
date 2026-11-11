"use client";

import { AlertCircle, Film, Loader2, UploadCloud } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { searchChildrenAction } from "@/features/sponsors/actions";
import { prepareVideoUploadAction, registerVideoAction } from "@/features/videos/actions";
import { EntityPicker, type PickerValue } from "@/components/shared/entity-picker";
import { FormSection } from "@/components/shared/form-section";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";

const ACCEPTED = ["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"];
const MAX_BYTES = 100 * 1024 * 1024;

/** Envoie le fichier directement à Cloudinary (signature serveur), avec suivi de progression. */
function uploadWithProgress(url: string, data: FormData, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(Math.round((event.loaded / event.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("L'envoi vers le stockage a échoué.")));
    xhr.onerror = () => reject(new Error("Connexion interrompue pendant l'envoi."));
    xhr.send(data);
  });
}

export function VideoUploadForm({ years }: { years: Array<{ id: string; label: string; current: boolean }> }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [child, setChild] = useState<PickerValue | null>(null);
  const [yearId, setYearId] = useState(years.find((y) => y.current)?.id ?? years[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const busy = progress !== null;

  function pick(next: File | undefined) {
    if (!next) return;
    if (!ACCEPTED.includes(next.type)) return void toast.error("Format non accepté : MP4, MOV, WebM ou M4V.");
    if (next.size > MAX_BYTES) return void toast.error("La vidéo ne doit pas dépasser 100 Mo.");
    setFile(next);
    if (!title) setTitle(`Merci de la part de ${child?.label.split(" ")[0] ?? "votre filleul(e)"}`);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const local: Record<string, string> = {};
    if (!child) local.childId = "Choisissez l'enfant.";
    if (!yearId) local.schoolYearId = "Choisissez l'année.";
    if (title.trim().length < 2) local.title = "Le titre est obligatoire.";
    if (!file) local.file = "Choisissez la vidéo.";
    setErrors(local);
    if (Object.keys(local).length || !file || !child) return;
    setFormError(null);
    setProgress(0);
    try {
      const prepared = await prepareVideoUploadAction();
      if (!prepared.ok) throw new Error(prepared.message);
      const data = new FormData();
      for (const [key, value] of Object.entries(prepared.data.fields)) data.set(key, String(value));
      data.set("file", file);
      await uploadWithProgress(prepared.data.uploadUrl, data, setProgress);
      const result = await registerVideoAction({ publicId: prepared.data.publicId, childId: child.id, schoolYearId: yearId, title, message });
      if (!result.ok) throw new Error(result.message);
      toast.success("Vidéo importée. Mettez-la à disposition pour générer les liens des sponsors.");
      router.push(`/videos/${result.data.videoId}`);
      router.refresh();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "L'import a échoué.");
      setProgress(null);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      {formError ? (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{formError}</span>
        </div>
      ) : null}
      <div className="rounded-xl border bg-card p-5 shadow-card md:p-6">
        <FormSection title="Enfant et année" description="Les sponsors de l'enfant pour cette année recevront chacun un lien privé.">
          <Field className="sm:col-span-2" data-invalid={Boolean(errors.childId) || undefined}>
            <FieldLabel htmlFor="video-child">Enfant</FieldLabel>
            <EntityPicker id="video-child" value={child} onChange={setChild} search={searchChildrenAction} placeholder="Nom, code…" disabled={busy} invalid={Boolean(errors.childId)} />
            {errors.childId ? <FieldError>{errors.childId}</FieldError> : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="video-year">Année scolaire</FieldLabel>
            <select
              id="video-year"
              value={yearId}
              onChange={(e) => setYearId(e.target.value)}
              disabled={busy}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.label}
                  {y.current ? " (active)" : ""}
                </option>
              ))}
            </select>
          </Field>
        </FormSection>
        <FormSection title="Vidéo" description="MP4, MOV, WebM ou M4V, 100 Mo maximum. Le fichier est stocké en privé : il n'est jamais accessible publiquement.">
          <div className="sm:col-span-2">
            <input ref={input} type="file" accept={ACCEPTED.join(",")} className="sr-only" tabIndex={-1} onChange={(e) => pick(e.target.files?.[0])} />
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={busy}
              className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
            >
              {file ? <Film className="size-8 text-primary" aria-hidden /> : <UploadCloud className="size-8 text-muted-foreground" aria-hidden />}
              <span className="text-sm font-medium">{file ? file.name : "Choisir la vidéo"}</span>
              <span className="text-xs text-muted-foreground">{file ? `${(file.size / 1024 / 1024).toFixed(1)} Mo` : "Cliquez pour sélectionner un fichier"}</span>
            </button>
            {errors.file ? <FieldError>{errors.file}</FieldError> : null}
            {progress !== null ? (
              <div className="mt-3 space-y-1.5" aria-live="polite">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{progress < 100 ? "Envoi sécurisé en cours…" : "Vérification…"}</span>
                  <span className="tabular-nums">{progress} %</span>
                </div>
                <Progress value={progress} />
              </div>
            ) : null}
          </div>
          <Field className="sm:col-span-2" data-invalid={Boolean(errors.title) || undefined}>
            <FieldLabel htmlFor="video-title">Titre</FieldLabel>
            <Input id="video-title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
            {errors.title ? <FieldError>{errors.title}</FieldError> : null}
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="video-message">Message aux sponsors (facultatif)</FieldLabel>
            <Textarea id="video-message" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} disabled={busy} />
            <FieldDescription>Affiché sous la vidéo sur la page privée du sponsor.</FieldDescription>
          </Field>
        </FormSection>
      </div>
      <div className="flex justify-end gap-2">
        <Link href="/videos" className={buttonVariants({ variant: "outline" })}>
          Annuler
        </Link>
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <UploadCloud aria-hidden />}
          Importer la vidéo
        </Button>
      </div>
    </form>
  );
}
