"use client";

import { CalendarClock, Check, Copy, KeyRound, Link2Off, Loader2, Send, ShieldOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { publishVideoAction, regenerateLinkAction, revokeLinkAction, revokeVideoAction, updateVideoExpiryAction } from "@/features/videos/actions";
import type { VideoDetail } from "@/features/videos/queries";
import type { GeneratedLink } from "@/features/videos/service";
import { DEFAULT_VIDEO_RETENTION_DAYS, defaultExpiry } from "@/features/videos/types";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatDateTime, toDateInput } from "@/lib/dates";

/** Gestion d'une vidéo : mise à disposition, liens privés, échéance, révocation. */
export function VideoManager({ video, canWrite }: { video: VideoDetail; canWrite: boolean }) {
  const router = useRouter();
  const [generated, setGenerated] = useState<GeneratedLink[] | null>(null);
  const [expiryDialog, setExpiryDialog] = useState<"publish" | "update" | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);
  const [pending, startTransition] = useTransition();
  const live = video.status === "AVAILABLE";

  function regenerate(sponsorId: string) {
    startTransition(async () => {
      const result = await regenerateLinkAction({ videoId: video.id, sponsorId });
      if (!result.ok) return void toast.error(result.message);
      setGenerated([result.data.link]);
      router.refresh();
    });
  }

  function revoke(linkId: string) {
    startTransition(async () => {
      const result = await revokeLinkAction({ linkId, videoId: video.id });
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message ?? "Lien révoqué.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          {video.status === "PROCESSING" ? (
            <Button onClick={() => setExpiryDialog("publish")}>
              <Send aria-hidden />
              Mettre à disposition des sponsors
            </Button>
          ) : null}
          {live || video.status === "REVOKED" || video.status === "PROCESSING" ? (
            <Button variant="outline" onClick={() => setExpiryDialog("update")}>
              <CalendarClock aria-hidden />
              Modifier l&apos;échéance
            </Button>
          ) : null}
          {live || video.status === "PROCESSING" ? (
            <Button variant="destructive" onClick={() => setRevokingAll(true)}>
              <ShieldOff aria-hidden />
              Révoquer tous les accès
            </Button>
          ) : null}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-xl border bg-card shadow-card">
        <h2 className="border-b px-5 py-3.5 text-sm font-semibold">Liens privés des sponsors</h2>
        {video.sponsors.length === 0 && video.links.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">Aucun sponsor n&apos;est associé à cet enfant pour l&apos;année {video.yearLabel}.</p>
        ) : (
          <ul className="divide-y text-sm">
            {video.sponsors.map((sponsor) => {
              const link = video.links.find((l) => l.sponsorId === sponsor.id && l.active) ?? video.links.find((l) => l.sponsorId === sponsor.id);
              return (
                <li key={sponsor.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">{sponsor.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {link
                        ? `${link.accessCount} consultation(s) · ${link.downloadCount} téléchargement(s)${link.lastAccessAt ? ` · dernier accès ${formatDateTime(link.lastAccessAt)}` : ""}`
                        : "Aucun lien généré"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {sponsor.hasActiveLink ? <StatusBadge tone="success">Lien actif</StatusBadge> : <StatusBadge>{link ? "Lien inactif" : "Sans lien"}</StatusBadge>}
                    {canWrite && live ? (
                      <>
                        <Button size="sm" variant="outline" onClick={() => regenerate(sponsor.id)} disabled={pending}>
                          <KeyRound aria-hidden />
                          {sponsor.hasActiveLink ? "Régénérer" : "Générer"}
                        </Button>
                        {link?.active ? (
                          <Button size="icon-sm" variant="ghost" onClick={() => revoke(link.id)} disabled={pending} aria-label={`Révoquer le lien de ${sponsor.name}`}>
                            <Link2Off />
                          </Button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="border-t px-5 py-2.5 text-xs text-muted-foreground">
          Les liens ne sont stockés que sous forme d&apos;empreinte : ils ne sont affichés qu&apos;au moment de leur génération. Régénérer un lien invalide le précédent.
        </p>
      </section>

      {expiryDialog ? (
        <ExpiryDialog
          mode={expiryDialog}
          current={video.expiresAt}
          onClose={() => setExpiryDialog(null)}
          onSubmit={async (date) => {
            if (expiryDialog === "publish") {
              const result = await publishVideoAction({ videoId: video.id, expiresAt: date });
              if (!result.ok) return result.message;
              setGenerated(result.data.links);
            } else {
              const result = await updateVideoExpiryAction({ videoId: video.id, expiresAt: date });
              if (!result.ok) return result.message;
              toast.success(result.message ?? "Échéance mise à jour.");
            }
            router.refresh();
            return null;
          }}
        />
      ) : null}
      <ConfirmDialog
        open={revokingAll}
        onOpenChange={setRevokingAll}
        title="Révoquer tous les accès ?"
        description="Tous les liens cessent immédiatement de fonctionner. Le fichier sera supprimé de Cloudinary à l'échéance prévue."
        confirmLabel="Révoquer"
        destructive
        reason={{ label: "Motif", minLength: 5 }}
        onConfirm={async (reason) => {
          const result = await revokeVideoAction({ id: video.id, reason });
          if (!result.ok) return { ok: false, message: result.message };
          toast.success(result.message ?? "Accès révoqués.");
          router.refresh();
          return { ok: true };
        }}
      />
      {generated ? <GeneratedLinksDialog links={generated} onClose={() => setGenerated(null)} /> : null}
    </div>
  );
}

function ExpiryDialog({ mode, current, onClose, onSubmit }: { mode: "publish" | "update"; current: string | null; onClose: () => void; onSubmit: (date: string) => Promise<string | null> }) {
  const [date, setDate] = useState(mode === "publish" ? toDateInput(defaultExpiry(new Date())) : current ? toDateInput(current) : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [tomorrow] = useState(() => toDateInput(new Date(Date.now() + 86_400_000)));
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "publish" ? "Mettre à disposition" : "Modifier l'échéance"}</DialogTitle>
          <DialogDescription>
            {mode === "publish"
              ? `Un lien privé sera généré pour chaque sponsor de l'enfant. Par défaut, la vidéo reste disponible ${DEFAULT_VIDEO_RETENTION_DAYS} jours.`
              : "À l'échéance, les liens sont invalidés et le fichier est supprimé automatiquement."}
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="video-expiry">Disponible jusqu&apos;au</FieldLabel>
          <Input id="video-expiry" type="date" value={date} min={tomorrow} onChange={(e) => setDate(e.target.value)} disabled={pending} />
          <FieldDescription>Fin de journée incluse.</FieldDescription>
        </Field>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Retour
          </Button>
          <Button
            onClick={() =>
              startTransition(async () => {
                const message = await onSubmit(date);
                if (message) setError(message);
                else onClose();
              })
            }
            disabled={pending || !date}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {mode === "publish" ? "Générer les liens" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Liens en clair : affichés UNE seule fois, à copier et transmettre par les canaux de l'organisation. */
function GeneratedLinksDialog({ links, onClose }: { links: GeneratedLink[]; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  async function copy(value: string, key: string) {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }
  const all = links.map((l) => `${l.sponsorName} : ${l.url}`).join("\n");
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Liens privés générés</DialogTitle>
          <DialogDescription>Copiez-les maintenant : ils ne seront plus affichés. Transmettez chaque lien uniquement à son sponsor.</DialogDescription>
        </DialogHeader>
        <ul className="max-h-80 space-y-2 overflow-auto">
          {links.map((link) => (
            <li key={link.sponsorId} className="rounded-lg border p-3">
              <p className="mb-1.5 text-sm font-medium">{link.sponsorName}</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs select-all">{link.url}</code>
                <Button size="sm" variant="outline" onClick={() => copy(link.url, link.sponsorId)}>
                  {copied === link.sponsorId ? <Check aria-hidden /> : <Copy aria-hidden />}
                  {copied === link.sponsorId ? "Copié" : "Copier"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <DialogFooter>
          {links.length > 1 ? (
            <Button variant="outline" onClick={() => copy(all, "all")}>
              {copied === "all" ? <Check aria-hidden /> : <Copy aria-hidden />}
              Tout copier
            </Button>
          ) : null}
          <Button onClick={onClose}>J&apos;ai copié les liens</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
