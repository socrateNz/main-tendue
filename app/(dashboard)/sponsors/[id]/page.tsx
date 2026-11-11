import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Building2, Mail, MapPin, Phone, Plus } from "lucide-react";

import { getYearOptions } from "@/features/children/queries";
import { AdvanceRegistryPanel } from "@/features/contributions/components/advance-registry";
import { PaymentsTable } from "@/features/contributions/components/payments-table";
import { getAdvanceRegistry, listPayments } from "@/features/contributions/queries";
import { buttonVariants } from "@/components/ui/button";
import { CommitmentsSituation } from "@/features/commitments/components/commitments-situation";
import { listCommitments } from "@/features/commitments/queries";
import { removeSponsorPhotoAction, uploadSponsorPhotoAction } from "@/features/sponsors/actions";
import { SponsorActions } from "@/features/sponsors/components/sponsor-actions";
import { SponsorStatusBadge } from "@/features/sponsors/components/sponsor-status-badge";
import { getSponsorDetail, type SponsorDetail } from "@/features/sponsors/queries";
import { SPONSOR_KIND_LABELS, SPONSOR_STATUS_LABELS } from "@/features/sponsors/types";
import { SponsorshipList } from "@/features/sponsorships/components/sponsorship-list";
import { listSponsorshipsOf } from "@/features/sponsorships/queries";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageContainer } from "@/components/shared/page-header";
import { PhotoEditor } from "@/components/shared/photo-editor";
import { UrlTabs } from "@/components/shared/url-tabs";
import { hasPermission } from "@/lib/auth/permissions";
import { authorizePage } from "@/lib/auth/session";
import { countryName } from "@/lib/countries";
import { formatDate, formatDateTime } from "@/lib/dates";

export const metadata: Metadata = { title: "Fiche sponsor" };

export default async function SponsorPage({ params }: PageProps<"/sponsors/[id]">) {
  const auth = await authorizePage("sponsors:read");
  if (!auth.ok) return <AccessDenied />;

  const { id } = await params;
  const [sponsor, sponsorships, years, commitments] = await Promise.all([
    getSponsorDetail(id),
    listSponsorshipsOf({ sponsorId: id }),
    getYearOptions(),
    listCommitments({ sponsorId: id, includeCancelled: true }),
  ]);
  const canSeePayments = auth.ok && hasPermission(auth.user.role, "payments:read");
  const [payments, registry] = canSeePayments
    ? await Promise.all([
        listPayments({ page: 1, pageSize: 50, q: "", sort: "receivedAt", dir: "desc" }, { yearId: null, status: "ALL", method: null, sponsorId: id }),
        getAdvanceRegistry(id),
      ])
    : [null, null];
  if (!sponsor) notFound();

  const role = auth.user.role;
  const archived = sponsor.status === "ARCHIVED";
  const canWrite = hasPermission(role, "sponsors:write");
  const activeCount = sponsorships.filter((s) => s.status === "ACTIVE").length;
  const childrenCount = new Set(sponsorships.filter((s) => s.status !== "CANCELLED").map((s) => s.child.id)).size;

  return (
    <PageContainer>
      {sponsor.status !== "ACTIVE" ? (
        <div role="status" className="rounded-xl border bg-muted/40 px-4 py-3 text-sm">
          Sponsor {SPONSOR_STATUS_LABELS[sponsor.status].toLowerCase()}
          {sponsor.statusChangedAt ? ` depuis le ${formatDate(sponsor.statusChangedAt)}` : ""}
          {sponsor.statusReason ? ` — ${sponsor.statusReason}` : ""}.
        </div>
      ) : null}

      <header className="flex flex-col gap-5 rounded-xl border bg-card p-5 shadow-card sm:flex-row sm:items-center md:p-6">
        <PhotoEditor
          entityId={sponsor.id}
          name={sponsor.name}
          photoUrl={sponsor.photoUrl}
          canEdit={canWrite && !archived}
          upload={uploadSponsorPhotoAction}
          remove={removeSponsorPhotoAction}
        />
        <div className="min-w-0 flex-1 space-y-2 text-center sm:text-left">
          <div className="flex flex-col items-center gap-2 sm:flex-row sm:flex-wrap">
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
              {sponsor.kind === "ORGANIZATION" ? <Building2 className="size-5 text-muted-foreground" aria-hidden /> : null}
              {sponsor.name}
            </h1>
            <SponsorStatusBadge status={sponsor.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            <span className="tabular-nums">{sponsor.code}</span> · {SPONSOR_KIND_LABELS[sponsor.kind]} · {countryName(sponsor.address.country)}
          </p>
          <p className="text-sm">
            <span className="font-medium">{activeCount}</span> parrainage{activeCount > 1 ? "s" : ""} actif{activeCount > 1 ? "s" : ""}
            <span className="text-muted-foreground"> · {childrenCount} enfant{childrenCount > 1 ? "s" : ""} soutenu{childrenCount > 1 ? "s" : ""} au total</span>
          </p>
        </div>
        <SponsorActions sponsorId={sponsor.id} status={sponsor.status} canWrite={canWrite} />
      </header>

      <UrlTabs
        defaultTab="profil"
        tabs={[
          { value: "profil", label: "Profil", content: <ProfilePanel sponsor={sponsor} /> },
          {
            value: "enfants",
            label: "Enfants parrainés",
            count: sponsorships.length,
            content: (
              <SponsorshipList
                items={sponsorships}
                perspective="children"
                years={years}
                fixed={{ id: sponsor.id, label: sponsor.name, description: sponsor.code }}
                canWrite={hasPermission(role, "sponsorships:write")}
                canSeeFinance={hasPermission(role, "commitments:read")}
                canManageCommitment={hasPermission(role, "commitments:write")}
                createDisabledReason={sponsor.status !== "ACTIVE" ? "Le sponsor doit être actif pour parrainer un enfant." : null}
              />
            ),
          },
          ...(hasPermission(role, "commitments:read")
            ? [
                {
                  value: "engagements",
                  label: "Engagements",
                  count: commitments.filter((c) => c.status === "ACTIVE").length,
                  content: <CommitmentsSituation items={commitments} perspective="child" />,
                },
              ]
            : []),
          ...(payments && registry
            ? [
                {
                  value: "versements",
                  label: "Versements",
                  count: payments.total,
                  content: (
                    <div className="space-y-4">
                      {hasPermission(role, "payments:write") && sponsor.status !== "ARCHIVED" ? (
                        <div className="flex justify-end">
                          <Link href={`/contributions/nouveau?sponsor=${sponsor.id}`} className={buttonVariants()}>
                            <Plus aria-hidden />
                            Nouveau versement
                          </Link>
                        </div>
                      ) : null}
                      <AdvanceRegistryPanel sponsorId={sponsor.id} registry={registry} canApply={hasPermission(role, "payments:write")} />
                      <PaymentsTable rows={payments.items} canWrite={false} filtered={false} compact />
                    </div>
                  ),
                },
              ]
            : []),
          ...(hasPermission(role, "audit:read") ? [{ value: "historique", label: "Historique", content: <HistoryPanel history={sponsor.history} /> }] : []),
        ]}
      />
    </PageContainer>
  );
}

function ProfilePanel({ sponsor }: { sponsor: SponsorDetail }) {
  const address = [sponsor.address.line1, sponsor.address.line2, [sponsor.address.postalCode, sponsor.address.city].filter(Boolean).join(" "), countryName(sponsor.address.country)]
    .filter(Boolean)
    .join(", ");
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <section className="rounded-xl border bg-card shadow-card">
        <h2 className="border-b px-5 py-3.5 text-sm font-semibold">Coordonnées</h2>
        <ul className="space-y-3 px-5 py-4 text-sm">
          <Line icon={Mail} value={sponsor.email} href={sponsor.email ? `mailto:${sponsor.email}` : undefined} />
          <Line icon={Phone} value={sponsor.phone} href={sponsor.phone ? `tel:${sponsor.phone.replace(/\s/g, "")}` : undefined} />
          <Line icon={Phone} value={sponsor.secondaryPhone} href={sponsor.secondaryPhone ? `tel:${sponsor.secondaryPhone.replace(/\s/g, "")}` : undefined} />
          <Line icon={MapPin} value={address || null} />
        </ul>
      </section>
      <section className="rounded-xl border bg-card shadow-card lg:col-span-2">
        <h2 className="border-b px-5 py-3.5 text-sm font-semibold">Notes</h2>
        <p className="px-5 py-4 text-sm whitespace-pre-line text-muted-foreground">{sponsor.notes ?? "Aucune note."}</p>
        <p className="border-t px-5 py-3 text-xs text-muted-foreground">Fiche créée le {formatDate(sponsor.createdAt)}.</p>
      </section>
    </div>
  );
}

function Line({ icon: Icon, value, href }: { icon: typeof Mail; value: string | null; href?: string }) {
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

function HistoryPanel({ history }: { history: SponsorDetail["history"] }) {
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
