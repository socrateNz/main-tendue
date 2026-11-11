import type { Metadata } from "next";

import { SponsorForm } from "@/features/sponsors/components/sponsor-form";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { authorizePage } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Nouveau sponsor" };

export default async function NewSponsorPage() {
  const auth = await authorizePage("sponsors:write");
  if (!auth.ok) return <AccessDenied />;
  return (
    <PageContainer>
      <PageHeader title="Nouveau sponsor" description="La photo et les parrainages pourront être ajoutés depuis la fiche, une fois créée." />
      <SponsorForm />
    </PageContainer>
  );
}
