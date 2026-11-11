import type { Metadata } from "next";

import { getYearOptions } from "@/features/children/queries";
import { ExpensesTable } from "@/features/expenses/components/expenses-table";
import { EXPENSE_SORTS, listCategories, listExpenses, type ExpenseFilters } from "@/features/expenses/queries";
import { EXPENSE_SCOPES } from "@/features/expenses/types";
import { AccessDenied } from "@/components/shared/access-denied";
import { Money } from "@/components/shared/money";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { hasPermission } from "@/lib/auth/permissions";
import { authorizePage } from "@/lib/auth/session";
import { parseListParams } from "@/lib/db/pagination";

export const metadata: Metadata = { title: "Dépenses" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function ExpensesPage({ searchParams }: PageProps<"/depenses">) {
  const auth = await authorizePage("expenses:read");
  if (!auth.ok) return <AccessDenied />;
  const raw = await searchParams;
  const params = parseListParams(raw, { sortable: EXPENSE_SORTS, defaultSort: "spentAt", defaultDir: "desc" });
  const [years, categories] = await Promise.all([getYearOptions(), listCategories()]);
  const defaultYear = years.find((y) => y.current)?.id ?? "all";
  const yearParam = first(raw.annee) ?? defaultYear;
  const categoryParam = first(raw.categorie);
  const scopeParam = first(raw.portee);
  const statusParam = first(raw.statut);
  const filters: ExpenseFilters = {
    yearId: years.some((y) => y.id === yearParam) ? yearParam : null,
    categoryId: categories.some((c) => c.id === categoryParam) ? (categoryParam ?? null) : null,
    scope: EXPENSE_SCOPES.find((s) => s === scopeParam) ?? null,
    status: statusParam === "VALID" || statusParam === "CANCELLED" ? statusParam : "ALL",
  };
  const result = await listExpenses(params, filters);
  const top = result.byCategory.slice(0, 4);

  return (
    <PageContainer>
      <PageHeader title="Dépenses" description="Dépenses de la caisse centrale. Une dépense collective est comptée une seule fois ; ses parts servent au suivi par enfant." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-xl border bg-card p-4 shadow-card md:p-5 xl:col-span-1">
          <p className="text-sm font-medium text-muted-foreground">Total des dépenses</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight">
            <Money amount={result.totalAmount} />
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Dépenses valides de la sélection.</p>
        </div>
        {top.map((category) => (
          <div key={category.name} className="rounded-xl border bg-card p-4 shadow-card md:p-5">
            <p className="truncate text-sm font-medium text-muted-foreground">{category.name}</p>
            <p className="mt-2 text-xl font-semibold tracking-tight">
              <Money amount={category.amount} />
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{result.totalAmount ? Math.round((category.amount * 100) / result.totalAmount) : 0} % du total</p>
          </div>
        ))}
      </div>
      <ExpensesTable
        rows={result.items}
        pagination={{ page: result.page, pageSize: result.pageSize, total: result.total, pageCount: result.pageCount }}
        years={[...years.map((y) => ({ value: y.id, label: `${y.label}${y.current ? " (active)" : ""}` })), { value: "all", label: "Toutes" }]}
        defaultYear={defaultYear}
        categories={categories.map((c) => ({ value: c.id, label: c.name }))}
        canWrite={hasPermission(auth.user.role, "expenses:write")}
        canManageCategories={hasPermission(auth.user.role, "expenseCategories:manage")}
        filtered={Boolean(params.q || filters.categoryId || filters.scope || filters.status !== "ALL")}
      />
    </PageContainer>
  );
}
