import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";
import { Download, Heart, Lock } from "lucide-react";

import { recordLinkAccess, resolveVideoLink } from "@/features/videos/service";
import { SIGNED_URL_TTL_SECONDS } from "@/features/videos/types";
import { BrandLogo } from "@/components/layout/brand-logo";
import { buttonVariants } from "@/components/ui/button";
import { privateVideoUrl } from "@/lib/cloudinary";
import { formatDate } from "@/lib/dates";

export const metadata: Metadata = {
  title: "Vidéo de remerciement",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/** Page publique d'un sponsor (sans compte) : le lien est vérifié côté serveur à chaque affichage. */
export default function SponsorVideoPage({ params }: PageProps<"/v/[token]">) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-3xl space-y-6">
        <div className="flex items-center justify-center gap-3">
          <BrandLogo size={44} />
          <span className="text-lg font-semibold tracking-tight">Main Tendue</span>
        </div>
        <Suspense fallback={<div className="aspect-video w-full animate-pulse rounded-2xl bg-muted" aria-busy="true" />}>
          <VideoContent params={params} />
        </Suspense>
      </div>
    </main>
  );
}

async function VideoContent({ params }: { params: PageProps<"/v/[token]">["params"] }) {
  const { token } = await params;
  const link = await resolveVideoLink(token);
  if (!link) {
    return (
      <div className="rounded-2xl border bg-card p-8 text-center shadow-panel">
        <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Lock className="size-5" aria-hidden />
        </span>
        <h1 className="text-lg font-semibold">Lien indisponible</h1>
        <p className="mt-1 text-sm text-muted-foreground">Ce lien est invalide, a expiré ou a été révoqué. Contactez l&apos;organisation si besoin.</p>
      </div>
    );
  }
  const list = await headers();
  await recordLinkAccess(link.linkId, "view", { ip: list.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, userAgent: list.get("user-agent") });
  const src = privateVideoUrl(link.video.asset, { ttlSeconds: SIGNED_URL_TTL_SECONDS, attachment: false });

  return (
    <article className="overflow-hidden rounded-2xl border bg-card shadow-panel">
      <video src={src} controls playsInline preload="metadata" className="aspect-video w-full bg-black" controlsList="nodownload">
        Votre navigateur ne permet pas la lecture de cette vidéo.
      </video>
      <div className="space-y-3 p-5 md:p-6">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Heart className="size-5 fill-current text-warning" aria-hidden />
          {link.video.title}
        </h1>
        {link.video.message ? <p className="text-sm whitespace-pre-line text-muted-foreground">{link.video.message}</p> : null}
        <p className="text-sm text-muted-foreground">
          Un message de {link.video.childFirstName}. Ce lien personnel est disponible jusqu&apos;au {formatDate(link.video.expiresAt)}.
        </p>
        <a href={`/api/videos/${token}/download`} className={buttonVariants({ variant: "outline" })} rel="nofollow">
          <Download aria-hidden />
          Télécharger la vidéo
        </a>
      </div>
    </article>
  );
}
