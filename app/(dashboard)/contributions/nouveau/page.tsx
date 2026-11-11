import type { Metadata } from "next";

import { PaymentForm } from "@/features/contributions/components/payment-form";
import { getSponsorDetail } from "@/features/sponsors/queries";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { authorizePage } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Nouveau versement" };

export default async function NewPaymentPage({ searchParams }: PageProps<"/contributions/nouveau">) {
  const auth = await authorizePage("payments:write");
  if (!auth.ok) return <AccessDenied />;
  const sponsorParam = (await searchParams).sponsor;
  const sponsor = typeof sponsorParam === "string" ? await getSponsorDetail(sponsorParam) : null;
  return (
    <PageContainer>
      <PageHeader
        title="Nouveau versement"
        description="Enregistrez un encaissement réel et sa ventilation. Les contrôles (reste dû, année, doublons) sont refaits par le serveur."
      />
      <PaymentForm initialSponsor={sponsor && sponsor.status !== "ARCHIVED" ? { id: sponsor.id, label: sponsor.name, description: sponsor.code } : null} />
    </PageContainer>
  );
}
