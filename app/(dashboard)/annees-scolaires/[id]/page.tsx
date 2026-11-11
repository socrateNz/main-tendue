import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarClock, History, Lock, RotateCcw, Scale } from "lucide-react";

import { CashOpeningPanel } from "@/features/school-years/components/cash-opening-panel";
import { YearActions } from "@/features/school-years/components/year-actions";
import { YearStatusBadge } from "@/features/school-years/components/year-status-badge";
import { getSchoolYearDetail, type SchoolYearDetail } from "@/features/school-years/queries";
import { AccessDenied } from "@/components/shared/access-denied";
import { Money } from "@/components/shared/money";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Progress } from "@/components/ui/progress";
import { hasPermission } from "@/lib/auth/permissions";
import { authorizePage } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/dates";
import { coverageRate } from "@/lib/money";

export const metadata: Metadata = { title: "Année scolaire" };

export default async function SchoolYearPage({ params }: PageProps<"/annees-scolaires/[id]">) {
  const auth = await authorizePage("schoolYears:read");
  if (!auth.ok) return <AccessDenied />;

  const year = await getSchoolYearDetail((await params).id);
  if (!year) notFound();

  const role = auth.user.role;
  const canSeeFinance = hasPermission(role, "reports:finance");
  const canSeeAudit = hasPermission(role, "audit:read");

  return (
    <PageContainer>
      <PageHeader
        title={`Année ${year.label}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <YearStatusBadge status={year.status} archived={year.archived} />
            <span>
              Du {formatDate(year.startDate)} au {formatDate(year.endDate)}
            </span>
          </span>
        }
        actions={
          <YearActions
            year={{ id: year.id, label: year.label, startDate: year.startDate, endDate: year.endDate, notes: year.notes }}
            status={year.status}
            archived={year.archived}
            isLatestClosed={year.isLatestClosed}
            canManage={hasPermission(role, "schoolYears:manage")}
            canReopen={hasPermission(role, "schoolYears:reopen")}
          />
        }
      />

      {year.status === "REOPENED" ? (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/5 px-4 py-3 text-sm">
          <RotateCcw className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <span>
            Cette année a été <strong>rouverte exceptionnellement</strong>. Les mouvements de sa période peuvent de nouveau être
            enregistrés ; une nouvelle clôture figera un nouvel instantané.
          </span>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {canSeeFinance ? <TreasuryCard year={year} /> : null}
          {canSeeFinance ? <CommitmentsCard year={year} /> : null}
          {canSeeFinance && (year.isFirstYear || year.cashOpening) ? (
            <CashOpeningPanel
              year={{ id: year.id, label: year.label, startDate: year.startDate }}
              opening={year.cashOpening}
              canInitialize={hasPermission(role, "cashbox:initialize")}
              yearClosed={year.status === "CLOSED"}
            />
          ) : null}
          {!canSeeFinance ? (
            <section className="rounded-xl border bg-card p-5 text-sm text-muted-foreground shadow-card">
              Les informations financières de l&apos;année sont réservées aux rôles financiers et d&apos;administration.
            </section>
          ) : null}
        </div>

        <div className="space-y-6">
          <InfoCard year={year} />
          {year.reopenings.length > 0 ? <ReopeningsCard year={year} /> : null}
          {canSeeAudit ? <HistoryCard year={year} /> : null}
        </div>
      </div>
    </PageContainer>
  );
}

function Card({ title, icon: Icon, aside, children }: { title: string; icon: typeof Scale; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-card">
      <div className="flex items-center justify-between gap-3 border-b px-5 py-3.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="size-4 text-muted-foreground" aria-hidden />
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function TreasuryCard({ year }: { year: SchoolYearDetail }) {
  const f = year.figures;
  const openingHint = year.isFirstYear ? "Solde initial de la caisse" : `Report de la clôture ${year.previousLabel ?? ""}`;
  const rows: Array<{ label: string; hint?: string; amount: number; sign?: "+" | "−"; sub?: boolean }> = [
    { label: "Solde d'ouverture", hint: openingHint, amount: f.openingBalance },
    { label: "Contributions encaissées", amount: f.contributions, sign: "+" },
    { label: "dont règlements tardifs d'années antérieures", amount: f.lateContributions, sub: true },
    { label: "Dons reçus", amount: f.donations, sign: "+" },
    { label: "Avances encaissées", hint: "Crédit des sponsors, non encore affecté", amount: f.advances, sign: "+" },
    { label: "Dépenses effectuées", amount: f.expenses, sign: "−" },
  ];

  return (
    <Card
      title="Trésorerie de l'année"
      icon={Scale}
      aside={
        year.source === "snapshot" ? (
          <StatusBadge tone="info">
            <Lock className="size-3" aria-hidden /> Instantané figé
          </StatusBadge>
        ) : (
          <StatusBadge tone="success">Calcul en cours</StatusBadge>
        )
      }
    >
      <dl className="divide-y text-sm">
        {rows.map((row) => (
          <div key={row.label} className={`flex items-center justify-between gap-4 px-5 py-3 ${row.sub ? "bg-muted/20 py-2 pl-10 text-muted-foreground" : ""}`}>
            <dt>
              <span>{row.label}</span>
              {row.hint ? <span className="block text-xs text-muted-foreground">{row.hint}</span> : null}
            </dt>
            <dd className="shrink-0 tabular-nums">
              {row.sign ? <span className="mr-1.5 text-muted-foreground">{row.sign}</span> : null}
              <Money amount={row.amount} />
            </dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-4 bg-muted/40 px-5 py-4">
          <dt className="font-semibold">{year.source === "snapshot" ? "Solde de clôture" : "Solde à date"}</dt>
          <dd className="text-lg font-semibold">
            <Money amount={f.closingBalance} />
          </dd>
        </div>
      </dl>
      <p className="border-t px-5 py-3 text-xs text-muted-foreground">
        Seuls les mouvements réels de caisse sont comptés. L&apos;affectation ultérieure d&apos;une avance à un engagement n&apos;est pas une
        nouvelle recette.
        {year.closing ? ` Clôturée le ${formatDateTime(year.closing.closedAt)} par ${year.closing.closedBy}.` : ""}
      </p>
    </Card>
  );
}

function CommitmentsCard({ year }: { year: SchoolYearDetail }) {
  const now = year.commitmentsNow;
  const atClosing = year.commitmentsAtClosing;
  const rate = coverageRate(now.allocated, now.expected);

  return (
    <Card title="Engagements de l'année" icon={CalendarClock}>
      {now.expected === 0 && now.allocated === 0 ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">Aucun engagement financier n&apos;est encore enregistré pour cette année.</p>
      ) : (
        <div className="space-y-4 px-5 py-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Figure label="Attendu" value={<Money amount={now.expected} />} />
            <Figure label="Affecté à date" value={<Money amount={now.allocated} />} />
            <Figure label="Reste à recevoir" value={<Money amount={Math.max(0, now.expected - now.allocated)} />} />
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Taux de couverture</span>
              <span className="tabular-nums">{rate} %</span>
            </div>
            <Progress value={rate} />
          </div>
          {atClosing ? (
            <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              À la clôture : <Money amount={atClosing.allocated} /> affectés sur <Money amount={atClosing.expected} /> attendus.
              {now.allocated > atClosing.allocated ? (
                <>
                  {" "}
                  Règlements tardifs reçus depuis : <Money amount={now.allocated - atClosing.allocated} className="font-medium text-foreground" />.
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function InfoCard({ year }: { year: SchoolYearDetail }) {
  const items: Array<[string, React.ReactNode]> = [
    ["Parrainages", year.counts.sponsorships],
    ["Enfants inscrits", year.counts.enrollments],
    ["Activée le", year.activatedAt ? formatDate(year.activatedAt) : "—"],
  ];
  return (
    <Card title="Informations" icon={CalendarClock}>
      <dl className="divide-y text-sm">
        {items.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 px-5 py-2.5">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {year.notes ? <p className="border-t px-5 py-3 text-sm whitespace-pre-line text-muted-foreground">{year.notes}</p> : null}
    </Card>
  );
}

function ReopeningsCard({ year }: { year: SchoolYearDetail }) {
  return (
    <Card title="Réouvertures" icon={RotateCcw}>
      <ul className="divide-y text-sm">
        {year.reopenings.map((reopening) => (
          <li key={reopening.at} className="space-y-1 px-5 py-3">
            <p className="font-medium">{formatDateTime(reopening.at)}</p>
            <p className="text-muted-foreground">{reopening.reason}</p>
            <p className="text-xs text-muted-foreground">
              Par {reopening.by} — instantané archivé : <Money amount={reopening.previousClosingBalance} />
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function HistoryCard({ year }: { year: SchoolYearDetail }) {
  return (
    <Card title="Historique" icon={History}>
      {year.history.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">Aucune opération enregistrée.</p>
      ) : (
        <ol className="relative space-y-4 px-5 py-4 before:absolute before:top-5 before:bottom-5 before:left-[1.6rem] before:w-px before:bg-border">
          {year.history.map((entry) => (
            <li key={entry.id} className="relative flex gap-3 text-sm">
              <span className="relative z-10 mt-1.5 size-2 shrink-0 rounded-full bg-primary ring-4 ring-card" aria-hidden />
              <div className="min-w-0">
                <p>{entry.summary}</p>
                <p className="text-xs text-muted-foreground">
                  {entry.actor} · {formatDateTime(entry.at)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
