import { processExpiredVideos } from "@/features/videos/service";
import { safeEqual } from "@/lib/security/tokens";

/**
 * Tâche planifiée (Vercel Cron, voir vercel.json) : invalide les liens des vidéos échues et
 * supprime leurs fichiers de Cloudinary, avec nouvelles tentatives en cas d'échec.
 *
 * Protégée par `CRON_SECRET` : Vercel envoie `Authorization: Bearer <CRON_SECRET>`.
 * Toute autre requête reçoit 401, sans aucun détail.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || secret.length < 32 || !safeEqual(header, `Bearer ${secret}`)) {
    return Response.json({ error: "Non autorisé." }, { status: 401 });
  }
  try {
    const summary = await processExpiredVideos();
    if (summary.alerts.length) console.error("[cron:expire-videos] suppressions en échec répété", summary.alerts);
    return Response.json({ ok: true, ...summary });
  } catch (error) {
    console.error("[cron:expire-videos]", error);
    return Response.json({ ok: false, error: "Échec du traitement." }, { status: 500 });
  }
}
