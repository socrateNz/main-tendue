import type { Metadata } from "next";
import { CalendarCheck, CalendarRange, Landmark } from "lucide-react";

import { SchoolYearsTable } from "@/features/school-years/components/school-years-table";
import { getSchoolYearsOverview } from "@/features/school-years/queries";
import { AccessDenied } from "@/components/shared/access-denied";
import { Money } from "@/components/shared/money";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { hasPermission } from "@/lib/auth/permissions";
import { authorizePage } from "@/lib/auth/session";
import { formatPeriod } from "@/lib/dates";

export const metadata: Metadata = { title: "Années scolaires" };

export default async function SchoolYearsPage({ searchParams }: PageProps<"/annees-scolaires">) {
  const auth = await authorizePage("schoolYears:read");
  if (!auth.ok) return <AccessDenied />;

  const includeArchived = (await searchParams).archivees === "1";
  const overview = await getSchoolYearsOverview({ includeArchived });
  const canSeeFinance = hasPermission(auth.user.role, "reports:finance");
  const active = overview.items.find((year) => year.status === "ACTIVE");
  const closedCount = overview.items.filter((year) => year.status === "CLOSED").length + (includeArchived ? 0 : overview.archivedCount);

  return (
    <PageContainer>
      <PageHeader
        title="Années scolaires"
        description="Chaque année possède son propre contexte de gestion. Les données des années précédentes restent consultables sans se mélanger à l'année active."
      />

      {overview.items.length > 0 || overview.archivedCount > 0 ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Année active"
            icon={CalendarCheck}
            value={active ? active.label : <span className="text-muted-foreground">Aucune</span>}
            hint={active ? formatPeriod(active.startDate, active.endDate) : "Activez une année en préparation."}
          />
          {canSeeFinance ? (
            <StatCard
              label="Solde de caisse actuel"
              icon={Landmark}
              value={<Money amount={overview.currentBalance} />}
              hint={overview.hasCashOpening ? "Cumulé depuis le solde initial." : "Solde initial non encore enregistré."}
            />
          ) : null}
          <StatCard label="Années clôturées" icon={CalendarRange} value={closedCount} hint="Instantanés financiers figés." />
        </div>
      ) : null}

      <SchoolYearsTable
        years={overview.items}
        canManage={hasPermission(auth.user.role, "schoolYears:manage")}
        canSeeFinance={canSeeFinance}
        includeArchived={includeArchived}
        archivedCount={overview.archivedCount}
      />
    </PageContainer>
  );
}
