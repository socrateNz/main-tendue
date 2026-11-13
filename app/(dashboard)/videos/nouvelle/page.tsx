import type { Metadata } from "next";

import { getYearOptions } from "@/features/children/queries";
import { VideoUploadForm } from "@/features/videos/components/video-upload-form";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { hasPermission } from "@/lib/auth/permissions";
import { authorizePage } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Importer une vidéo" };

export default async function NewVideoPage() {
  const auth = await authorizePage("videos:upload");
  if (!auth.ok) return <AccessDenied />;
  const years = await getYearOptions();
  return (
    <PageContainer>
      <PageHeader title="Importer une vidéo" description="Le fichier est envoyé directement vers le stockage privé, puis vérifié par le serveur." />
      <VideoUploadForm years={years.map((y) => ({ id: y.id, label: y.label, current: y.current }))} canManage={hasPermission(auth.user.role, "videos:write")} />
    </PageContainer>
  );
}
