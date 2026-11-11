import type { Metadata } from "next";

import { SchoolsTable } from "@/features/children/components/schools-table";
import { listSchools } from "@/features/children/queries";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { hasPermission } from "@/lib/auth/permissions";
import { authorizePage } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Établissements" };

export default async function SchoolsPage() {
  const auth = await authorizePage("children:read");
  if (!auth.ok) return <AccessDenied />;
  const { items, activeYearLabel } = await listSchools();
  return (
    <PageContainer>
      <PageHeader
        title="Établissements scolaires"
        description="Établissements fréquentés par les enfants. Ils servent à la scolarité annuelle et aux rapports par établissement."
      />
      <SchoolsTable schools={items} activeYearLabel={activeYearLabel} canWrite={hasPermission(auth.user.role, "schools:write")} />
    </PageContainer>
  );
}
