import type { Metadata } from "next";

import { ExpenseForm } from "@/features/expenses/components/expense-form";
import { listCategories } from "@/features/expenses/queries";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { authorizePage } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Nouvelle dépense" };

export default async function NewExpensePage() {
  const auth = await authorizePage("expenses:write");
  if (!auth.ok) return <AccessDenied />;
  const categories = (await listCategories()).filter((c) => c.active);
  return (
    <PageContainer>
      <PageHeader title="Nouvelle dépense" description="Le justificatif pourra être ajouté depuis la fiche de la dépense." />
      <ExpenseForm categories={categories.map((c) => ({ id: c.id, name: c.name }))} />
    </PageContainer>
  );
}
