import type { Metadata } from "next";
import { Banknote, Gift, PiggyBank, Wallet } from "lucide-react";

import { getYearOptions } from "@/features/children/queries";
import { PaymentsTable } from "@/features/contributions/components/payments-table";
import { PAYMENT_SORTS, listPayments, type PaymentFilters } from "@/features/contributions/queries";
import { PAYMENT_METHODS } from "@/features/contributions/types";
import { AccessDenied } from "@/components/shared/access-denied";
import { Money } from "@/components/shared/money";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { hasPermission } from "@/lib/auth/permissions";
import { authorizePage } from "@/lib/auth/session";
import { parseListParams } from "@/lib/db/pagination";

export const metadata: Metadata = { title: "Contributions" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function ContributionsPage({ searchParams }: PageProps<"/contributions">) {
  const auth = await authorizePage("payments:read");
  if (!auth.ok) return <AccessDenied />;

  const raw = await searchParams;
  const params = parseListParams(raw, { sortable: PAYMENT_SORTS, defaultSort: "receivedAt", defaultDir: "desc" });
  const years = await getYearOptions();
  const defaultYear = years.find((y) => y.current)?.id ?? "all";
  const yearParam = first(raw.annee) ?? defaultYear;
  const statusParam = first(raw.statut);
  const methodParam = first(raw.moyen);
  const filters: PaymentFilters = {
    yearId: years.some((y) => y.id === yearParam) ? yearParam : null,
    status: statusParam === "VALID" || statusParam === "CANCELLED" ? statusParam : "ALL",
    method: PAYMENT_METHODS.find((m) => m === methodParam) ?? null,
  };
  const result = await listPayments(params, filters);

  return (
    <PageContainer>
      <PageHeader
        title="Contributions"
        description="Versements réellement encaissés. Chaque versement est ventilé entre engagements, dons libres et avances ; l'année du mouvement est celle de sa date."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total encaissé" icon={Wallet} value={<Money amount={result.totals.amount} />} hint="Versements valides de la sélection." />
        <StatCard label="Contributions aux engagements" icon={Banknote} value={<Money amount={result.totals.contributions} />} />
        <StatCard label="Dons libres" icon={Gift} value={<Money amount={result.totals.donation} />} />
        <StatCard label="Avances encaissées" icon={PiggyBank} value={<Money amount={result.totals.advance} />} />
      </div>
      <PaymentsTable
        rows={result.items}
        pagination={{ page: result.page, pageSize: result.pageSize, total: result.total, pageCount: result.pageCount }}
        years={[...years.map((y) => ({ value: y.id, label: `${y.label}${y.current ? " (active)" : ""}` })), { value: "all", label: "Toutes" }]}
        defaultYear={defaultYear}
        canWrite={hasPermission(auth.user.role, "payments:write")}
        filtered={Boolean(params.q || filters.method || filters.status !== "ALL")}
      />
    </PageContainer>
  );
}
