import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, FileText, History, ImageIcon, Paperclip } from "lucide-react";

import { addPaymentAttachmentAction, cancelCreditApplicationAction, cancelPaymentAction } from "@/features/contributions/actions";
import { getPaymentDetail } from "@/features/contributions/queries";
import { PAYMENT_LINE_KIND_LABELS, PAYMENT_METHOD_LABELS } from "@/features/contributions/types";
import { AccessDenied } from "@/components/shared/access-denied";
import { CancelMovementButton } from "@/components/shared/cancel-movement-button";
import { FileUploadButton } from "@/components/shared/file-upload-button";
import { Money } from "@/components/shared/money";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { hasPermission } from "@/lib/auth/permissions";
import { authorizePage } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/dates";
import { CURRENCIES, formatMinor } from "@/lib/money";

export const metadata: Metadata = { title: "Versement" };

export default async function PaymentPage({ params }: PageProps<"/contributions/[id]">) {
  const auth = await authorizePage("payments:read");
  if (!auth.ok) return <AccessDenied />;
  const payment = await getPaymentDetail((await params).id);
  if (!payment) notFound();

  const role = auth.user.role;
  const cancelled = payment.status === "CANCELLED";
  const closed = payment.yearStatus === "CLOSED";
  const canCancel = hasPermission(role, "finance:cancel") && !cancelled && !closed;
  const details: Array<[string, string]> = [
    ["Moyen", PAYMENT_METHOD_LABELS[payment.method]],
    ["Référence", payment.reference ?? "—"],
    ["Devise", CURRENCIES[payment.currency.code].label],
    ["Montant d'origine", formatMinor(payment.currency.originalAmountMinor, payment.currency.code)],
    ...(payment.currency.code !== "XAF" ? ([["Taux appliqué", `1 ${payment.currency.code} = ${payment.currency.rate.replace(".", ",")} FCFA`]] as Array<[string, string]>) : []),
    ["Saisi par", `${payment.createdBy}, ${formatDateTime(payment.createdAt)}`],
  ];

  return (
    <PageContainer>
      <PageHeader
        title={`Versement ${payment.number}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {cancelled ? <StatusBadge tone="danger">Annulé</StatusBadge> : <StatusBadge tone="success">Validé</StatusBadge>}
            <span>
              Reçu le {formatDate(payment.receivedAt)} de{" "}
              <Link href={`/sponsors/${payment.sponsor.id}`} className="font-medium text-foreground hover:underline">
                {payment.sponsor.name}
              </Link>{" "}
              · année {payment.yearLabel}
            </span>
          </span>
        }
        actions={
          canCancel ? (
            <CancelMovementButton
              id={payment.id}
              label="Annuler le versement"
              title={`Annuler le versement ${payment.number} ?`}
              description="Le versement reste consultable avec le statut « Annulé » et n'est plus compté. Il ne pourra être ni réactivé ni modifié : ressaisissez-le si nécessaire."
              action={cancelPaymentAction}
            />
          ) : null
        }
      />

      {payment.cancellation ? (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm">
          <Ban className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <span>
            Annulé le {formatDateTime(payment.cancellation.at)} par {payment.cancellation.by} — {payment.cancellation.reason}
          </span>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="overflow-hidden rounded-xl border bg-card shadow-card lg:col-span-2">
          <h2 className="border-b px-5 py-3.5 text-sm font-semibold">Ventilation</h2>
          <ul className="divide-y">
            {payment.lines.map((line) => (
              <li key={line.id} className="space-y-2 px-5 py-3.5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{PAYMENT_LINE_KIND_LABELS[line.kind]}</p>
                    {line.commitment ? (
                      <p className="text-sm text-muted-foreground">
                        <Link href={`/enfants/${line.commitment.childId}`} className="hover:underline">
                          {line.commitment.childName}
                        </Link>{" "}
                        · engagement {line.commitment.yearLabel}
                        {line.lateSettlement ? (
                          <StatusBadge tone="warning" className="ml-2">
                            Règlement tardif
                          </StatusBadge>
                        ) : null}
                      </p>
                    ) : null}
                    {line.kind === "ADVANCE" ? (
                      <p className="text-sm text-muted-foreground">
                        Affecté : <Money amount={line.applied ?? 0} /> · disponible :{" "}
                        <Money amount={line.amount - (line.applied ?? 0)} className="font-medium text-foreground" />
                      </p>
                    ) : null}
                  </div>
                  <Money amount={line.amount} className="font-medium" />
                </div>
                {line.applications?.length ? (
                  <ul className="space-y-1.5 rounded-lg bg-muted/30 p-3 text-sm">
                    {line.applications.map((application) => (
                      <li key={application.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span className={application.status === "CANCELLED" ? "text-muted-foreground line-through" : undefined}>
                          {application.number} → {application.childName} ({application.yearLabel}) · <Money amount={application.amount} />
                        </span>
                        {application.status === "VALID" && hasPermission(role, "finance:cancel") ? (
                          <CancelMovementButton
                            id={application.id}
                            size="sm"
                            label="Annuler l'affectation"
                            title={`Annuler l'affectation ${application.number} ?`}
                            description="Le crédit d'avance redevient disponible. La caisse n'est pas modifiée : l'argent y est entré lors du versement."
                            action={cancelCreditApplicationAction}
                          />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t bg-muted/40 px-5 py-3.5">
            <span className="font-semibold">Montant comptable</span>
            <Money amount={payment.amountXaf} className={`text-lg font-semibold ${cancelled ? "line-through" : ""}`} />
          </div>
        </section>

        <div className="space-y-6">
          <section className="rounded-xl border bg-card shadow-card">
            <h2 className="border-b px-5 py-3.5 text-sm font-semibold">Encaissement</h2>
            <dl className="divide-y text-sm">
              {details.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 px-5 py-2.5">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right">{value}</dd>
                </div>
              ))}
            </dl>
            {payment.note ? <p className="border-t px-5 py-3 text-sm text-muted-foreground">{payment.note}</p> : null}
          </section>

          <section className="rounded-xl border bg-card shadow-card">
            <div className="flex items-center justify-between gap-2 border-b px-5 py-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Paperclip className="size-4 text-muted-foreground" aria-hidden /> Justificatifs
              </h2>
              {hasPermission(role, "payments:write") && !cancelled ? <FileUploadButton id={payment.id} action={addPaymentAttachmentAction} label="Ajouter" /> : null}
            </div>
            {payment.attachments.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">Aucun justificatif.</p>
            ) : (
              <ul className="divide-y text-sm">
                {payment.attachments.map((file, index) => (
                  <li key={`${file.name}-${index}`} className="flex items-center gap-2 px-5 py-2.5">
                    {file.isPdf ? <FileText className="size-4 text-muted-foreground" aria-hidden /> : <ImageIcon className="size-4 text-muted-foreground" aria-hidden />}
                    {file.url ? (
                      <a href={file.url} target="_blank" rel="noopener noreferrer" className="truncate hover:text-primary hover:underline">
                        {file.name}
                      </a>
                    ) : (
                      <span className="truncate">{file.name}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {hasPermission(role, "audit:read") ? (
            <section className="rounded-xl border bg-card shadow-card">
              <h2 className="flex items-center gap-2 border-b px-5 py-3.5 text-sm font-semibold">
                <History className="size-4 text-muted-foreground" aria-hidden /> Historique
              </h2>
              <ol className="divide-y text-sm">
                {payment.history.map((entry) => (
                  <li key={entry.id} className="px-5 py-2.5">
                    <p>{entry.summary}</p>
                    <p className="text-xs text-muted-foreground">
                      {entry.actor} · {formatDateTime(entry.at)}
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      </div>
    </PageContainer>
  );
}
