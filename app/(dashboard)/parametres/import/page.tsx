import type { Metadata } from "next";

import { ImportWizard } from "@/features/imports/components/import-wizard";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { authorizePage } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Import Excel" };

export default async function ImportPage() {
  const auth = await authorizePage("data:import");
  if (!auth.ok) return <AccessDenied />;
  return (
    <PageContainer>
      <PageHeader
        title="Import Excel"
        description="Reprise des données existantes : établissements, enfants, sponsors et parrainages. Le fichier est analysé avant tout enregistrement."
      />
      <ImportWizard />
    </PageContainer>
  );
}
