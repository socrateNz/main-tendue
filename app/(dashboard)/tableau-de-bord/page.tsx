import type { Metadata } from "next";
import Link from "next/link";
import { Banknote, HandCoins, HandHeart, Landmark, PiggyBank, Receipt, Scale, Users } from "lucide-react";

import { getYearOptions } from "@/features/children/queries";
import { ExpensesChart, InflowsChart } from "@/features/dashboard/components/dashboard-charts";
import { getDashboard } from "@/features/dashboard/queries";
import { AccessDenied } from "@/components/shared/access-denied";
import { ListFilter } from "@/components/shared/data-table";
import { Money } from "@/components/shared/money";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { hasPermission } from "@/lib/auth/permissions";
import { authorizePage } from "@/lib/auth/session";
import { formatDateTime, formatShortDate } from "@/lib/dates";

export const metadata: Metadata = { title: "Tableau de bord" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function DashboardPage({ searchParams }: PageProps<"/tableau-de-bord">) {
  const auth = await authorizePage("dashboard:read");
  if (!auth.ok) return <AccessDenied />;
  const role = auth.user.role;
  const withFinance = hasPermission(role, "reports:finance");

  const years = await getYearOptions();
  const defaultYear = years.find((y) => y.current) ?? years[0] ?? null;
  const requested = first((await searchParams).annee);
  const year = years.find((y) => y.id === requested) ?? defaultYear;
  const data = await getDashboard(year ? { id: year.id, startDate: year.startDate, endDate: year.endDate } : null, {
    withFinance,
    withActivity: hasPermission(role, "audit:read"),
  });
  const f = data.finance;

  return (
    <PageContainer>
      <PageHeader
        title={`Bonjour ${auth.user.firstName}`}
        description={year ? `Situation du programme pour l'année ${year.label}${year.current ? " (année active)" : ""}.` : "Aucune année scolaire n'est encore configurée."}
        actions={
          years.length > 0 ? (
            <div className="w-56">
              <ListFilter param="annee" label="Année scolaire" defaultValue={defaultYear?.id ?? ""} options={years.map((y) => ({ value: y.id, label: `${y.label}${y.current ? " (active)" : ""}` }))} />
            </div>
          ) : null
        }
      />

      {!year && hasPermission(role, "schoolYears:manage") ? (
        <div className="rounded-xl border bg-card shadow-card">
          <EmptyState
            title="Commencez par créer une année scolaire"
            description="Les parrainages, engagements, versements et dépenses sont rattachés à une année scolaire."
            action={
              <Link href="/annees-scolaires" className={buttonVariants()}>
                Années scolaires
              </Link>
            }
          />
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Enfants suivis" icon={Users} value={data.counts.children} hint="Fiches actives." />
        <StatCard label="Sponsors actifs" icon={HandHeart} value={data.counts.activeSponsors} />
        <StatCard label="Parrainages actifs" icon={HandCoins} value={data.counts.activeSponsorships} hint={year ? `Année ${year.label}.` : undefined} />
        {f ? (
          <StatCard
            label="Solde de caisse"
            icon={Landmark}
            value={<Money amount={f.currentBalance} />}
            hint={f.source === "snapshot" ? `Clôture ${year?.label} : ${new Intl.NumberFormat("fr-FR").format(f.yearClosing)} FCFA (figée).` : "Cumulé depuis le solde initial."}
          />
        ) : null}
      </div>

      {f ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Engagements attendus" icon={Scale} value={<Money amount={f.expected} />} hint="Montant attendu des engagements actifs." />
            <StatCard label="Reçu sur les engagements" icon={Banknote} value={<Money amount={f.received} />} hint="Versements et avances affectées, arriérés inclus." />
            <StatCard label="Reste à percevoir" icon={PiggyBank} value={<Money amount={f.remaining} />} />
            <StatCard label="Dépenses de l'année" icon={Receipt} value={<Money amount={f.expenses} />} hint="Chaque dépense comptée une fois." />
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            <section className="rounded-xl border bg-card p-5 shadow-card lg:col-span-2">
              <div className="mb-4 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Couverture des engagements</h2>
                <span className="text-2xl font-semibold tabular-nums">{f.coverage} %</span>
              </div>
              <Progress value={f.coverage} aria-label="Taux de couverture des engagements" />
              <p className="mt-2 text-xs text-muted-foreground">
                <Money amount={f.received} /> reçus sur <Money amount={f.expected} /> attendus.
              </p>
              <h2 className="mt-6 mb-2 text-sm font-semibold">Répartition des encaissements</h2>
              <InflowsChart
                data={[
                  { name: "Contributions", amount: f.contributions },
                  { name: "Dons libres", amount: f.donations },
                  { name: "Avances", amount: f.advances },
                ]}
              />
            </section>
            <section className="rounded-xl border bg-card p-5 shadow-card lg:col-span-3">
              <h2 className="mb-1 text-sm font-semibold">Évolution des dépenses</h2>
              <p className="mb-4 text-xs text-muted-foreground">Dépenses valides par mois, sur la période de l&apos;année {year?.label}.</p>
              <ExpensesChart data={data.monthlyExpenses} />
            </section>
          </div>
        </>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {f ? (
          <section className="overflow-hidden rounded-xl border bg-card shadow-card">
            <h2 className="border-b px-5 py-3.5 text-sm font-semibold">Dernières opérations</h2>
            {data.recentOperations.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">Aucun versement ni dépense sur cette année.</p>
            ) : (
              <ul className="divide-y text-sm">
                {data.recentOperations.map((op) => (
                  <li key={`${op.kind}-${op.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <Link href={op.href} className="min-w-0 hover:underline">
                      <span className="block truncate">{op.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatShortDate(op.date)} · {op.kind === "payment" ? "Versement" : "Dépense"}
                      </span>
                    </Link>
                    <span className="flex shrink-0 items-center gap-2">
                      {op.cancelled ? <StatusBadge tone="danger">Annulé</StatusBadge> : null}
                      <span className={op.cancelled ? "text-muted-foreground line-through" : op.kind === "payment" ? "font-medium text-success" : "font-medium"}>
                        {op.kind === "payment" ? "+" : "−"}
                        <Money amount={op.amount} />
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
        {data.recentActivity.length > 0 ? (
          <section className="overflow-hidden rounded-xl border bg-card shadow-card">
            <h2 className="border-b px-5 py-3.5 text-sm font-semibold">Activité récente</h2>
            <ol className="divide-y text-sm">
              {data.recentActivity.map((entry) => (
                <li key={entry.id} className="px-5 py-2.5">
                  <p className="line-clamp-2">{entry.summary}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.actor} · {formatDateTime(entry.at)}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </div>
    </PageContainer>
  );
}
