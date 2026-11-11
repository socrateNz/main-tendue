import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, FileText, History, ImageIcon, Paperclip } from "lucide-react";

import { addExpenseAttachmentAction, cancelExpenseAction } from "@/features/expenses/actions";
import { getExpenseDetail } from "@/features/expenses/queries";
import { ALLOCATION_MODE_LABELS, EXPENSE_SCOPE_LABELS } from "@/features/expenses/types";
import { AccessDenied } from "@/components/shared/access-denied";
import { CancelMovementButton } from "@/components/shared/cancel-movement-button";
import { FileUploadButton } from "@/components/shared/file-upload-button";
import { Money } from "@/components/shared/money";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { hasPermission } from "@/lib/auth/permissions";
import { authorizePage } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/dates";

export const metadata: Metadata = { title: "Dépense" };

export default async function ExpensePage({ params }: PageProps<"/depenses/[id]">) {
  const auth = await authorizePage("expenses:read");
  if (!auth.ok) return <AccessDenied />;
  const expense = await getExpenseDetail((await params).id);
  if (!expense) notFound();
  const role = auth.user.role;
  const cancelled = expense.status === "CANCELLED";
  const details: Array<[string, string]> = [
    ["Catégorie", expense.categoryName],
    ["Portée", EXPENSE_SCOPE_LABELS[expense.scope]],
    ...(expense.allocationMode ? ([["Répartition", ALLOCATION_MODE_LABELS[expense.allocationMode]]] as Array<[string, string]>) : []),
    ["Fournisseur", expense.supplier ?? "—"],
    ["Référence", expense.reference ?? "—"],
    ["Saisie par", `${expense.createdBy}, ${formatDateTime(expense.createdAt)}`],
  ];

  return (
    <PageContainer>
      <PageHeader
        title={`Dépense ${expense.number}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {cancelled ? <StatusBadge tone="danger">Annulée</StatusBadge> : <StatusBadge tone="success">Validée</StatusBadge>}
            <span>
              {formatDate(expense.spentAt)} · année {expense.yearLabel}
            </span>
          </span>
        }
        actions={
          hasPermission(role, "finance:cancel") && !cancelled && expense.yearStatus !== "CLOSED" ? (
            <CancelMovementButton
              id={expense.id}
              label="Annuler la dépense"
              title={`Annuler la dépense ${expense.number} ?`}
              description="La dépense reste consultable avec le statut « Annulée » et n'est plus comptée. Elle ne pourra être ni réactivée ni modifiée."
              action={cancelExpenseAction}
            />
          ) : null
        }
      />
      {expense.cancellation ? (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm">
          <Ban className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <span>
            Annulée le {formatDateTime(expense.cancellation.at)} par {expense.cancellation.by} — {expense.cancellation.reason}
          </span>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="overflow-hidden rounded-xl border bg-card shadow-card lg:col-span-2">
          <div className="border-b px-5 py-4">
            <p className="font-medium">{expense.description}</p>
          </div>
          {expense.allocations.length > 0 ? (
            <>
              <h2 className="border-b bg-muted/30 px-5 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Part de chaque enfant (suivi, non additionnée à la caisse)
              </h2>
              <ul className="divide-y text-sm">
                {expense.allocations.map((a) => (
                  <li key={a.childId} className="flex justify-between gap-4 px-5 py-2.5">
                    <Link href={`/enfants/${a.childId}`} className="hover:underline">
                      {a.childName} <span className="text-muted-foreground">{a.childCode}</span>
                    </Link>
                    <Money amount={a.amount} />
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="px-5 py-4 text-sm text-muted-foreground">Dépense générale : aucun enfant concerné.</p>
          )}
          <div className="flex items-center justify-between border-t bg-muted/40 px-5 py-3.5">
            <span className="font-semibold">Montant de la dépense</span>
            <Money amount={expense.amount} className={`text-lg font-semibold ${cancelled ? "line-through" : ""}`} />
          </div>
        </section>

        <div className="space-y-6">
          <section className="rounded-xl border bg-card shadow-card">
            <h2 className="border-b px-5 py-3.5 text-sm font-semibold">Informations</h2>
            <dl className="divide-y text-sm">
              {details.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 px-5 py-2.5">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="rounded-xl border bg-card shadow-card">
            <div className="flex items-center justify-between gap-2 border-b px-5 py-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Paperclip className="size-4 text-muted-foreground" aria-hidden /> Justificatifs
              </h2>
              {hasPermission(role, "expenses:write") && !cancelled ? <FileUploadButton id={expense.id} action={addExpenseAttachmentAction} label="Ajouter" /> : null}
            </div>
            {expense.attachments.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">Aucun justificatif.</p>
            ) : (
              <ul className="divide-y text-sm">
                {expense.attachments.map((file, index) => (
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
                {expense.history.map((entry) => (
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
