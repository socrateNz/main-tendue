import { recordLinkAccess, resolveVideoLink } from "@/features/videos/service";
import { SIGNED_URL_TTL_SECONDS } from "@/features/videos/types";
import { privateVideoUrl } from "@/lib/cloudinary";

/**
 * Téléchargement par un sponsor (sans compte) : vérification du lien privé côté serveur à chaque
 * appel, journalisation, puis redirection vers une URL Cloudinary signée valable quelques minutes.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/videos/[token]/download">) {
  const { token } = await params;
  const link = await resolveVideoLink(token);
  if (!link) {
    return new Response("Ce lien est invalide, a expiré ou a été révoqué.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  await recordLinkAccess(link.linkId, "download", { ip: forwarded, userAgent: request.headers.get("user-agent") });
  const url = privateVideoUrl(link.video.asset, { ttlSeconds: SIGNED_URL_TTL_SECONDS, attachment: true });
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
