import type { Metadata } from "next";
import Link from "next/link";
import { FileSpreadsheet } from "lucide-react";

import { getYearOptions } from "@/features/children/queries";
import { PrintButton } from "@/features/reports/components/print-button";
import { ReportView } from "@/features/reports/components/report-view";
import { buildReport } from "@/features/reports/queries";
import { REPORT_META, REPORT_TYPES, type ReportType } from "@/features/reports/types";
import { AccessDenied } from "@/components/shared/access-denied";
import { ListFilter } from "@/components/shared/data-table";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { hasPermission } from "@/lib/auth/permissions";
import { authorizePage } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Rapports" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function ReportsPage({ searchParams }: PageProps<"/rapports">) {
  const auth = await authorizePage("reports:read");
  if (!auth.ok) return <AccessDenied />;
  const role = auth.user.role;
  const available = REPORT_TYPES.filter((type) => hasPermission(role, REPORT_META[type].permission));
  if (available.length === 0) return <AccessDenied />;

  const raw = await searchParams;
  const requested = first(raw.rapport) as ReportType | undefined;
  const type: ReportType = requested && available.includes(requested) ? requested : available[0];
  const years = await getYearOptions();
  const defaultYear = years.find((y) => y.current)?.id ?? years[0]?.id ?? "";
  const yearId = years.some((y) => y.id === first(raw.annee)) ? (first(raw.annee) as string) : defaultYear;
  const report = await buildReport(type, REPORT_META[type].yearScoped ? yearId : null, { withFinance: hasPermission(role, "reports:finance") });
  const query = (next: Record<string, string>) => new URLSearchParams({ rapport: type, ...(yearId ? { annee: yearId } : {}), ...next }).toString();

  return (
    <PageContainer>
      <PageHeader
        title="Rapports"
        description="Rapports calculés sur les données réelles, selon les règles comptables validées. Export Excel (.xlsx) et impression en PDF."
        actions={
          report && report.rows.length > 0 ? (
            <div className="no-print flex gap-2">
              <a href={`/api/rapports/${type}?${query({})}`} className={buttonVariants({ variant: "outline" })}>
                <FileSpreadsheet aria-hidden />
                Excel
              </a>
              <PrintButton />
            </div>
          ) : null
        }
      />
      <nav aria-label="Type de rapport" className="no-print -mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <ul className="flex w-max gap-1 rounded-xl border bg-card p-1 shadow-card">
          {available.map((item) => (
            <li key={item}>
              <Link
                href={`/rapports?${new URLSearchParams({ rapport: item, ...(yearId ? { annee: yearId } : {}) })}`}
                aria-current={item === type ? "page" : undefined}
                className={cn("block rounded-lg px-3 py-1.5 text-sm whitespace-nowrap transition-colors", item === type ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
              >
                {REPORT_META[item].label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {REPORT_META[type].yearScoped ? (
        <div className="no-print max-w-xs">
          <ListFilter param="annee" label="Année scolaire" defaultValue={defaultYear} options={years.map((y) => ({ value: y.id, label: `${y.label}${y.current ? " (active)" : ""}` }))} />
        </div>
      ) : null}
      {report ? (
        <ReportView report={report} />
      ) : (
        <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground shadow-card">Créez d&apos;abord une année scolaire pour consulter ce rapport.</div>
      )}
    </PageContainer>
  );
}
