import type { Metadata } from "next";

import { CategoriesTable } from "@/features/expenses/components/categories-table";
import { listCategories } from "@/features/expenses/queries";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { hasPermission } from "@/lib/auth/permissions";
import { authorizePage } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Catégories de dépenses" };

export default async function CategoriesPage() {
  const auth = await authorizePage("expenses:read");
  if (!auth.ok) return <AccessDenied />;
  return (
    <PageContainer>
      <PageHeader title="Catégories de dépenses" description="Classement des dépenses pour le suivi et les rapports." />
      <CategoriesTable categories={await listCategories()} canManage={hasPermission(auth.user.role, "expenseCategories:manage")} />
    </PageContainer>
  );
}
