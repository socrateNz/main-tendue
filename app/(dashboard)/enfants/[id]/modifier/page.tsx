import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ChildForm } from "@/features/children/components/child-form";
import { getChildDetail } from "@/features/children/queries";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { authorizePage } from "@/lib/auth/session";
import { toDateInput } from "@/lib/dates";
import { fullName } from "@/lib/text";

export const metadata: Metadata = { title: "Modifier la fiche" };

export default async function EditChildPage({ params }: PageProps<"/enfants/[id]/modifier">) {
  const auth = await authorizePage("children:write");
  if (!auth.ok) return <AccessDenied />;
  const { id } = await params;
  const child = await getChildDetail(id);
  if (!child) notFound();
  if (child.status === "ARCHIVED") return <AccessDenied />;

  return (
    <PageContainer>
      <PageHeader title={`Modifier — ${fullName(child)}`} description={`Fiche ${child.code}`} />
      <ChildForm
        childId={child.id}
        defaultValues={{
          firstName: child.firstName,
          lastName: child.lastName,
          birthDate: toDateInput(child.birthDate),
          sex: child.sex,
          birthPlace: child.birthPlace ?? "",
          address: child.address ?? "",
          city: child.city ?? "",
          phone: child.phone ?? "",
          email: child.email ?? "",
          notes: child.notes ?? "",
          guardians: child.guardians.map((g) => ({
            relationship: g.relationship,
            firstName: g.firstName,
            lastName: g.lastName,
            phone: g.phone ?? "",
            email: g.email ?? "",
            address: g.address ?? "",
            occupation: g.occupation ?? "",
            isPrimaryContact: g.isPrimaryContact,
          })),
        }}
      />
    </PageContainer>
  );
}
