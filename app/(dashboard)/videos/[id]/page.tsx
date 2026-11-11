import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { History, TriangleAlert } from "lucide-react";

import { VideoManager } from "@/features/videos/components/video-manager";
import { VideoStatusBadge } from "@/features/videos/components/video-status-badge";
import { getVideoDetail } from "@/features/videos/queries";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { hasPermission } from "@/lib/auth/permissions";
import { authorizePage } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/dates";

export const metadata: Metadata = { title: "Vidéo" };

export default async function VideoPage({ params }: PageProps<"/videos/[id]">) {
  const auth = await authorizePage("videos:read");
  if (!auth.ok) return <AccessDenied />;
  const video = await getVideoDetail((await params).id);
  if (!video) notFound();
  const info: Array<[string, string]> = [
    ["Enfant", video.child.name],
    ["Année", video.yearLabel],
    ["Mise à disposition", video.availableAt ? formatDate(video.availableAt) : "Pas encore"],
    ["Échéance", video.expiresAt ? formatDate(video.expiresAt) : "—"],
    ["Taille", video.bytes ? `${(video.bytes / 1024 / 1024).toFixed(1)} Mo` : "—"],
    ["Durée", video.duration ? `${Math.round(video.duration)} s` : "—"],
  ];

  return (
    <PageContainer>
      <PageHeader title={video.title} description={<VideoStatusBadge status={video.status} />} />
      {video.status === "PENDING_DELETION" && video.deletion.attempts > 0 ? (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/5 px-4 py-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <span>
            Suppression en attente : {video.deletion.attempts} tentative(s) échouée(s){video.deletion.lastError ? ` (${video.deletion.lastError})` : ""}. Nouvel essai au prochain passage de la tâche planifiée.
          </span>
        </div>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {video.previewUrl ? (
            <video src={video.previewUrl} controls preload="metadata" className="aspect-video w-full rounded-xl border bg-black shadow-card" />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center rounded-xl border bg-muted text-sm text-muted-foreground">
              {video.status === "DELETED" ? `Fichier supprimé le ${video.deletion.deletedAt ? formatDate(video.deletion.deletedAt) : "—"}. L'historique est conservé.` : "Aperçu indisponible."}
            </div>
          )}
          <VideoManager video={video} canWrite={hasPermission(auth.user.role, "videos:write")} />
        </div>
        <div className="space-y-6">
          <section className="rounded-xl border bg-card shadow-card">
            <h2 className="border-b px-5 py-3.5 text-sm font-semibold">Informations</h2>
            <dl className="divide-y text-sm">
              {info.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 px-5 py-2.5">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right">{label === "Enfant" ? <Link href={`/enfants/${video.child.id}`} className="hover:underline">{value}</Link> : value}</dd>
                </div>
              ))}
            </dl>
            {video.message ? <p className="border-t px-5 py-3 text-sm whitespace-pre-line text-muted-foreground">{video.message}</p> : null}
            {video.revokeReason ? <p className="border-t px-5 py-3 text-sm text-warning">Accès révoqués : {video.revokeReason}</p> : null}
          </section>
          <section className="rounded-xl border bg-card shadow-card">
            <h2 className="flex items-center gap-2 border-b px-5 py-3.5 text-sm font-semibold">
              <History className="size-4 text-muted-foreground" aria-hidden /> Historique de distribution
            </h2>
            <ol className="max-h-[28rem] divide-y overflow-auto text-sm">
              {video.history.map((entry) => (
                <li key={entry.id} className="px-5 py-2.5">
                  <p>{entry.summary}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.actor} · {formatDateTime(entry.at)}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </PageContainer>
  );
}
