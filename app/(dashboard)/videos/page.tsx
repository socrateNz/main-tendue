import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Plus, Video } from "lucide-react";

import { getYearOptions } from "@/features/children/queries";
import { VideoStatusBadge } from "@/features/videos/components/video-status-badge";
import { listVideos } from "@/features/videos/queries";
import { VIDEO_STATUSES } from "@/features/videos/types";
import { AccessDenied } from "@/components/shared/access-denied";
import { ListFilter } from "@/components/shared/data-table";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/states";
import { buttonVariants } from "@/components/ui/button";
import { hasPermission } from "@/lib/auth/permissions";
import { authorizePage } from "@/lib/auth/session";
import { formatShortDate } from "@/lib/dates";
import { VIDEO_STATUS_LABELS } from "@/features/videos/types";

export const metadata: Metadata = { title: "Vidéos" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function VideosPage({ searchParams }: PageProps<"/videos">) {
  const auth = await authorizePage("videos:read");
  if (!auth.ok) return <AccessDenied />;
  const raw = await searchParams;
  const years = await getYearOptions();
  const yearParam = first(raw.annee);
  const statusParam = first(raw.statut);
  const videos = await listVideos({
    yearId: years.some((y) => y.id === yearParam) ? (yearParam ?? null) : null,
    status: VIDEO_STATUSES.find((s) => s === statusParam) ?? null,
  });
  const canWrite = hasPermission(auth.user.role, "videos:write");

  return (
    <PageContainer>
      <PageHeader
        title="Vidéos de remerciement"
        description="Vidéos privées transmises aux sponsors par lien personnel. Elles sont supprimées automatiquement à leur échéance."
        actions={
          canWrite ? (
            <Link href="/videos/nouvelle" className={buttonVariants()}>
              <Plus aria-hidden />
              Importer une vidéo
            </Link>
          ) : null
        }
      />
      <div className="grid grid-cols-2 gap-3 rounded-xl border bg-card p-3 shadow-card sm:p-4 md:max-w-xl">
        <ListFilter param="annee" label="Année" allLabel="Toutes" options={years.map((y) => ({ value: y.id, label: y.label }))} />
        <ListFilter param="statut" label="Statut" allLabel="Tous" options={VIDEO_STATUSES.map((s) => ({ value: s, label: VIDEO_STATUS_LABELS[s] }))} />
      </div>
      {videos.length === 0 ? (
        <div className="rounded-xl border bg-card shadow-card">
          <EmptyState icon={Video} title="Aucune vidéo" description="Importez la vidéo d'un enfant, puis mettez-la à disposition : chacun de ses sponsors recevra un lien privé." />
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {videos.map((video) => (
            <li key={video.id}>
              <Link href={`/videos/${video.id}`} className="flex h-full items-start gap-3 rounded-xl border bg-card p-4 shadow-card transition-colors hover:border-primary/40">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Video className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate font-medium">{video.title}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {video.child.name} · {video.yearLabel}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <VideoStatusBadge status={video.status} />
                    <span className="text-xs text-muted-foreground">
                      {video.activeLinks} lien(s) actif(s) · {video.views} vue(s)
                      {video.expiresAt && video.status !== "DELETED" ? ` · jusqu'au ${formatShortDate(video.expiresAt)}` : ""}
                    </span>
                  </div>
                </div>
                <ChevronRight className="mt-1 size-4 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
