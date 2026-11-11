import type { Metadata } from "next";

import { getYearOptions } from "@/features/children/queries";
import { SponsorshipsTable } from "@/features/sponsorships/components/sponsorships-table";
import { SPONSORSHIP_SORTS, listSponsorships, type SponsorshipFilters } from "@/features/sponsorships/queries";
import { SPONSORSHIP_STATUSES } from "@/features/sponsorships/types";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { hasPermission } from "@/lib/auth/permissions";
import { authorizePage } from "@/lib/auth/session";
import { parseListParams } from "@/lib/db/pagination";

export const metadata: Metadata = { title: "Parrainages" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function SponsorshipsPage({ searchParams }: PageProps<"/parrainages">) {
  const auth = await authorizePage("sponsorships:read");
  if (!auth.ok) return <AccessDenied />;

  const raw = await searchParams;
  const params = parseListParams(raw, { sortable: SPONSORSHIP_SORTS, defaultSort: "startDate", defaultDir: "desc" });
  const years = await getYearOptions();
  const defaultYear = years.find((y) => y.current)?.id ?? "all";
  const yearParam = first(raw.annee) ?? defaultYear;
  const statusParam = first(raw.statut);
  const filters: SponsorshipFilters = {
    yearId: years.some((y) => y.id === yearParam) ? yearParam : null,
    status: SPONSORSHIP_STATUSES.find((status) => status === statusParam) ?? "ALL",
  };
  const result = await listSponsorships(params, filters);
  const role = auth.user.role;

  return (
    <PageContainer>
      <PageHeader
        title="Parrainages"
        description="Associations entre sponsors et enfants, année par année. Les montants sont définis par les engagements de chaque parrainage."
      />
      <SponsorshipsTable
        rows={result.items}
        pagination={{ page: result.page, pageSize: result.pageSize, total: result.total, pageCount: result.pageCount }}
        years={years}
        defaultYear={defaultYear}
        canWrite={hasPermission(role, "sponsorships:write")}
        canSeeFinance={hasPermission(role, "commitments:read")}
        canManageCommitment={hasPermission(role, "commitments:write")}
        filtered={Boolean(params.q || filters.status !== "ALL")}
      />
    </PageContainer>
  );
}
