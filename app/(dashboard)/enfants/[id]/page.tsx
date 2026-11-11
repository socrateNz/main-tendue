import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Archive, Banknote, HandHeart, Mail, MapPin, Phone, Receipt, Star } from "lucide-react";

import { ChildActions } from "@/features/children/components/child-actions";
import { ageOf } from "@/features/children/components/child-avatar";
import { ChildPhotoEditor } from "@/features/children/components/child-photo-editor";
import { SchoolingPanel } from "@/features/children/components/schooling-panel";
import { getChildDetail, getSchoolOptions, getYearOptions, type ChildDetail } from "@/features/children/queries";
import { GUARDIAN_RELATIONSHIP_LABELS, SEX_LABELS } from "@/features/children/types";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageContainer } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { UrlTabs } from "@/components/shared/url-tabs";
import { hasPermission } from "@/lib/auth/permissions";
import { authorizePage } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/dates";
import { fullName } from "@/lib/text";

export const metadata: Metadata = { title: "Fiche enfant" };

export default async function ChildPage({ params }: PageProps<"/enfants/[id]">) {
  const auth = await authorizePage("children:read");
  if (!auth.ok) return <AccessDenied />;

  const { id } = await params;
  const [child, years, schools] = await Promise.all([getChildDetail(id), getYearOptions(), getSchoolOptions()]);
  if (!child) notFound();

  const role = auth.user.role;
  const archived = child.status === "ARCHIVED";
  const canWrite = hasPermission(role, "children:write") && !archived;
  const name = fullName(child);
  const current = child.enrollments.find((e) => years.find((y) => y.id === e.schoolYearId)?.current);

  return (
    <PageContainer>
      {archived ? (
        <div role="status" className="flex items-start gap-2 rounded-xl border bg-muted/40 px-4 py-3 text-sm">
          <Archive className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>
            Fiche archivée{child.archivedAt ? ` le ${formatDate(child.archivedAt)}` : ""}
            {child.archiveReason ? ` — ${child.archiveReason}` : ""}. Elle reste consultable mais n&apos;est plus modifiable.
          </span>
        </div>
      ) : null}

      <header className="flex flex-col gap-5 rounded-xl border bg-card p-5 shadow-card sm:flex-row sm:items-center md:p-6">
        <ChildPhotoEditor childId={child.id} name={name} photoUrl={child.photoLargeUrl} canEdit={canWrite} />
        <div className="min-w-0 flex-1 space-y-2 text-center sm:text-left">
          <div className="flex flex-col items-center gap-2 sm:flex-row sm:flex-wrap">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{name}</h1>
            {archived ? <StatusBadge>Archivé</StatusBadge> : <StatusBadge tone="success">Actif</StatusBadge>}
          </div>
          <p className="text-sm text-muted-foreground">
            <span className="tabular-nums">{child.code}</span> · {SEX_LABELS[child.sex]} · {ageOf(child.birthDate)} ans (né{child.sex === "F" ? "e" : ""} le{" "}
            {formatDate(child.birthDate)})
          </p>
          <p className="text-sm">
            {current ? (
              <>
                <span className="font-medium">{current.className}</span> — {current.schoolName}
                <span className="text-muted-foreground"> ({current.yearLabel})</span>
              </>
            ) : (
              <span className="text-muted-foreground">Aucune scolarité renseignée pour l&apos;année active.</span>
            )}
          </p>
        </div>
        <ChildActions
          childId={child.id}
          name={name}
          archived={archived}
          canWrite={hasPermission(role, "children:write")}
          canArchive={hasPermission(role, "children:archive")}
        />
      </header>

      <UrlTabs
        defaultTab="profil"
        tabs={[
          { value: "profil", label: "Profil", content: <ProfilePanel child={child} /> },
          {
            value: "scolarite",
            label: "Scolarité",
            count: child.enrollments.length,
            content: <SchoolingPanel childId={child.id} enrollments={child.enrollments} years={years} schools={schools} canWrite={canWrite} />,
          },
          {
            value: "parrainages",
            label: "Sponsors",
            count: child.sponsorshipsCount,
            content: (
              <UpcomingPanel
                icon={HandHeart}
                title="Sponsors et parrainages"
                description="Les sponsors de l'enfant et leurs parrainages, année par année, apparaîtront ici avec le module Parrainages."
              />
            ),
          },
          {
            value: "contributions",
            label: "Contributions",
            content: (
              <UpcomingPanel
                icon={Banknote}
                title="Contributions"
                description="Les versements affectés aux engagements de l'enfant apparaîtront ici avec le module Contributions."
              />
            ),
          },
          {
            value: "depenses",
            label: "Dépenses",
            content: (
              <UpcomingPanel
                icon={Receipt}
                title="Dépenses scolaires"
                description="Les dépenses individuelles et la part de l'enfant dans les dépenses collectives apparaîtront ici avec le module Dépenses."
              />
            ),
          },
          ...(hasPermission(role, "audit:read")
            ? [{ value: "historique", label: "Historique", content: <HistoryPanel history={child.history} /> }]
            : []),
        ]}
      />
    </PageContainer>
  );
}

function ProfilePanel({ child }: { child: ChildDetail }) {
  const identity: Array<[string, string | null]> = [
    ["Nom", child.lastName.toUpperCase()],
    ["Prénom(s)", child.firstName],
    ["Date de naissance", formatDate(child.birthDate)],
    ["Lieu de naissance", child.birthPlace],
    ["Sexe", SEX_LABELS[child.sex]],
  ];
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <section className="rounded-xl border bg-card shadow-card lg:col-span-1">
        <h2 className="border-b px-5 py-3.5 text-sm font-semibold">Identité et coordonnées</h2>
        <dl className="divide-y text-sm">
          {identity.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 px-5 py-2.5">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right font-medium">{value ?? "—"}</dd>
            </div>
          ))}
        </dl>
        <ul className="space-y-2 border-t px-5 py-4 text-sm">
          <ContactLine icon={MapPin} value={[child.address, child.city].filter(Boolean).join(", ") || null} />
          <ContactLine icon={Phone} value={child.phone} href={child.phone ? `tel:${child.phone.replace(/\s/g, "")}` : undefined} />
          <ContactLine icon={Mail} value={child.email} href={child.email ? `mailto:${child.email}` : undefined} />
        </ul>
      </section>

      <section className="rounded-xl border bg-card shadow-card lg:col-span-2">
        <h2 className="border-b px-5 py-3.5 text-sm font-semibold">Parents et tuteurs</h2>
        {child.guardians.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">Aucun parent ou tuteur renseigné.</p>
        ) : (
          <ul className="grid gap-px bg-border sm:grid-cols-2">
            {child.guardians.map((guardian) => (
              <li key={guardian.id} className="space-y-2 bg-card px-5 py-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">
                    {guardian.firstName} {guardian.lastName.toUpperCase()}
                  </p>
                  {guardian.isPrimaryContact ? (
                    <StatusBadge tone="warning">
                      <Star className="size-3 fill-current" aria-hidden /> Contact principal
                    </StatusBadge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {GUARDIAN_RELATIONSHIP_LABELS[guardian.relationship]}
                  {guardian.occupation ? ` · ${guardian.occupation}` : ""}
                </p>
                <ul className="space-y-1.5 text-sm">
                  <ContactLine icon={Phone} value={guardian.phone} href={guardian.phone ? `tel:${guardian.phone.replace(/\s/g, "")}` : undefined} />
                  <ContactLine icon={Mail} value={guardian.email} href={guardian.email ? `mailto:${guardian.email}` : undefined} />
                  <ContactLine icon={MapPin} value={guardian.address} />
                </ul>
              </li>
            ))}
          </ul>
        )}
        {child.notes ? (
          <div className="border-t px-5 py-4">
            <h3 className="mb-1 text-xs font-medium text-muted-foreground uppercase">Notes</h3>
            <p className="text-sm whitespace-pre-line">{child.notes}</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function ContactLine({ icon: Icon, value, href }: { icon: typeof Phone; value: string | null; href?: string }) {
  if (!value) return null;
  return (
    <li className="flex items-start gap-2">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      {href ? (
        <a href={href} className="break-all hover:text-primary hover:underline">
          {value}
        </a>
      ) : (
        <span>{value}</span>
      )}
    </li>
  );
}

function UpcomingPanel({ icon, title, description }: { icon: typeof Phone; title: string; description: string }) {
  return (
    <div className="rounded-xl border bg-card shadow-card">
      <EmptyState icon={icon} title={title} description={description} />
    </div>
  );
}

function HistoryPanel({ history }: { history: ChildDetail["history"] }) {
  return (
    <section className="rounded-xl border bg-card shadow-card">
      {history.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">Aucune opération enregistrée.</p>
      ) : (
        <ol className="divide-y">
          {history.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-0.5 px-5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <span>{entry.summary}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {entry.actor} · {formatDateTime(entry.at)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
