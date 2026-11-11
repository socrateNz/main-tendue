import type { Metadata } from "next";

import { ChildForm } from "@/features/children/components/child-form";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { authorizePage } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Nouvel enfant" };

export default async function NewChildPage() {
  const auth = await authorizePage("children:write");
  if (!auth.ok) return <AccessDenied />;
  return (
    <PageContainer>
      <PageHeader title="Nouvel enfant" description="La photo et la scolarité pourront être ajoutées depuis la fiche, une fois créée." />
      <ChildForm />
    </PageContainer>
  );
}
