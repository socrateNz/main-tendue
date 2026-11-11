import type { Metadata } from "next";

import { ChildrenTable } from "@/features/children/components/children-table";
import { CHILD_SORTS, getSchoolOptions, getYearOptions, listChildren, type ChildFilters } from "@/features/children/queries";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { hasPermission } from "@/lib/auth/permissions";
import { authorizePage } from "@/lib/auth/session";
import { parseListParams } from "@/lib/db/pagination";

export const metadata: Metadata = { title: "Enfants" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function ChildrenPage({ searchParams }: PageProps<"/enfants">) {
  const auth = await authorizePage("children:read");
  if (!auth.ok) return <AccessDenied />;

  const raw = await searchParams;
  const params = parseListParams(raw, { sortable: CHILD_SORTS, defaultSort: "name" });
  const [years, schools] = await Promise.all([getYearOptions(), getSchoolOptions()]);

  // Année consultée : l'année active par défaut ; « all » pour ignorer le contexte annuel.
  const defaultYear = years.find((year) => year.current)?.id ?? "all";
  const yearParam = first(raw.annee) ?? defaultYear;
  const year = years.find((option) => option.id === yearParam) ?? null;
  const statusParam = first(raw.statut);
  const sexParam = first(raw.sexe);
  const schoolParam = first(raw.etablissement) ?? null;

  const filters: ChildFilters = {
    status: statusParam === "ARCHIVED" || statusParam === "ALL" ? statusParam : "ACTIVE",
    sex: sexParam === "F" || sexParam === "M" ? sexParam : null,
    yearId: year?.id ?? null,
    enrolledOnly: false,
    schoolId: schools.some((school) => school.id === schoolParam) ? schoolParam : null,
  };
  const result = await listChildren(params, filters);

  return (
    <PageContainer>
      <PageHeader
        title="Enfants"
        description="Les fiches des enfants sont communes à toutes les années ; leur scolarité est enregistrée année par année."
      />
      <ChildrenTable
        rows={result.items}
        pagination={{ page: result.page, pageSize: result.pageSize, total: result.total, pageCount: result.pageCount }}
        yearOptions={[...years.map((y) => ({ value: y.id, label: `${y.label}${y.current ? " (active)" : ""}` })), { value: "all", label: "Aucune (toutes)" }]}
        schoolOptions={schools.filter((s) => s.active).map((s) => ({ value: s.id, label: s.city ? `${s.name} — ${s.city}` : s.name }))}
        defaultYear={defaultYear}
        yearLabel={year?.label ?? null}
        canWrite={hasPermission(auth.user.role, "children:write")}
        filtered={Boolean(params.q || filters.sex || filters.schoolId || filters.status !== "ACTIVE")}
      />
    </PageContainer>
  );
}
