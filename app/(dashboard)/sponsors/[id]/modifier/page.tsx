import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SponsorForm } from "@/features/sponsors/components/sponsor-form";
import { getSponsorDetail } from "@/features/sponsors/queries";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { authorizePage } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Modifier le sponsor" };

export default async function EditSponsorPage({ params }: PageProps<"/sponsors/[id]/modifier">) {
  const auth = await authorizePage("sponsors:write");
  if (!auth.ok) return <AccessDenied />;
  const sponsor = await getSponsorDetail((await params).id);
  if (!sponsor) notFound();
  if (sponsor.status === "ARCHIVED") return <AccessDenied />;

  return (
    <PageContainer>
      <PageHeader title={`Modifier — ${sponsor.name}`} description={`Fiche ${sponsor.code}`} />
      <SponsorForm
        sponsorId={sponsor.id}
        defaultValues={{
          kind: sponsor.kind,
          firstName: sponsor.firstName ?? "",
          lastName: sponsor.lastName ?? "",
          organizationName: sponsor.organizationName ?? "",
          email: sponsor.email ?? "",
          phone: sponsor.phone ?? "",
          secondaryPhone: sponsor.secondaryPhone ?? "",
          address: {
            line1: sponsor.address.line1 ?? "",
            line2: sponsor.address.line2 ?? "",
            postalCode: sponsor.address.postalCode ?? "",
            city: sponsor.address.city ?? "",
            country: sponsor.address.country ?? "CM",
          },
          notes: sponsor.notes ?? "",
        }}
      />
    </PageContainer>
  );
}
