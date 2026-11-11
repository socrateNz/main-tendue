import type { Metadata } from "next";

import { SponsorsTable } from "@/features/sponsors/components/sponsors-table";
import { SPONSOR_SORTS, getSponsorCountries, listSponsors, type SponsorFilters } from "@/features/sponsors/queries";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { hasPermission } from "@/lib/auth/permissions";
import { authorizePage } from "@/lib/auth/session";
import { countryName } from "@/lib/countries";
import { parseListParams } from "@/lib/db/pagination";

export const metadata: Metadata = { title: "Sponsors" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function SponsorsPage({ searchParams }: PageProps<"/sponsors">) {
  const auth = await authorizePage("sponsors:read");
  if (!auth.ok) return <AccessDenied />;

  const raw = await searchParams;
  const params = parseListParams(raw, { sortable: SPONSOR_SORTS, defaultSort: "name" });
  const countries = await getSponsorCountries();
  const status = first(raw.statut);
  const kind = first(raw.type);
  const country = first(raw.pays);
  const filters: SponsorFilters = {
    status: status === "INACTIVE" || status === "ARCHIVED" || status === "ALL" ? status : "ACTIVE",
    kind: kind === "PERSON" || kind === "ORGANIZATION" ? kind : null,
    country: country && countries.includes(country) ? country : null,
  };
  const result = await listSponsors(params, filters);

  return (
    <PageContainer>
      <PageHeader title="Sponsors" description="Particuliers et organisations qui soutiennent les enfants. Les sponsors n'ont pas de compte dans l'application." />
      <SponsorsTable
        rows={result.items}
        pagination={{ page: result.page, pageSize: result.pageSize, total: result.total, pageCount: result.pageCount }}
        countries={countries.map((code) => ({ value: code, label: countryName(code) })).sort((a, b) => a.label.localeCompare(b.label, "fr"))}
        activeYearLabel={result.activeYearLabel}
        canWrite={hasPermission(auth.user.role, "sponsors:write")}
        filtered={Boolean(params.q || filters.kind || filters.country || filters.status !== "ACTIVE")}
      />
    </PageContainer>
  );
}
