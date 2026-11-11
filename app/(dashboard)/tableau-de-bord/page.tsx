import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { CheckCircle2, CircleDashed, XCircle } from "lucide-react";

import { getSetupChecks, type SetupCheck } from "@/features/dashboard/setup";
import { AccessDenied } from "@/components/shared/access-denied";
import { hasPermission } from "@/lib/auth/permissions";
import { authorizePage } from "@/lib/auth/session";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Tableau de bord" };

export default async function DashboardPage() {
  const auth = await authorizePage("dashboard:read");
  if (!auth.ok) return <AccessDenied />;
  const canSeeSetup = hasPermission(auth.user.role, "settings:manage");

  return (
    <PageContainer>
      <PageHeader
        title={`Bonjour ${auth.user.firstName}`}
        description={
          canSeeSetup
            ? "Les indicateurs du programme apparaîtront ici dès que les modules métier seront en service. En attendant, voici l'état réel de la configuration."
            : "Les indicateurs du programme apparaîtront ici dès que les modules métier seront en service."
        }
      />
      {canSeeSetup ? <SetupSection /> : null}
    </PageContainer>
  );
}

function SetupSection() {
  return (
      <section aria-labelledby="setup-title" className="overflow-hidden rounded-xl border bg-card shadow-card">
        <div className="flex flex-col gap-1 border-b px-5 py-4">
          <h2 id="setup-title" className="text-sm font-semibold">
            Mise en service
          </h2>
          <p className="text-sm text-muted-foreground">Contrôles effectués à l&apos;instant, sans afficher aucune valeur secrète.</p>
        </div>
        <Suspense fallback={<SetupChecklistSkeleton />}>
          <SetupChecklist />
        </Suspense>
      </section>
  );
}

const STATUS_UI: Record<SetupCheck["status"], { icon: typeof CheckCircle2; tone: "success" | "warning" | "danger"; label: string; color: string }> = {
  ok: { icon: CheckCircle2, tone: "success", label: "Opérationnel", color: "text-success" },
  todo: { icon: CircleDashed, tone: "warning", label: "À faire", color: "text-warning" },
  error: { icon: XCircle, tone: "danger", label: "Erreur", color: "text-destructive" },
};

async function SetupChecklist() {
  await connection();
  const checks = await getSetupChecks();
  const done = checks.filter((check) => check.status === "ok").length;

  return (
    <>
      <div className="flex items-center gap-3 border-b bg-muted/30 px-5 py-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={checks.length} aria-valuenow={done} aria-label="Progression de la mise en service">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(done / checks.length) * 100}%` }} />
        </div>
        <span className="text-xs font-medium text-muted-foreground tabular-nums">
          {done}/{checks.length}
        </span>
      </div>
      <ul className="divide-y">
        {checks.map((check) => {
          const ui = STATUS_UI[check.status];
          const Icon = ui.icon;
          return (
            <li key={check.id} className="flex items-start gap-3 px-5 py-3.5">
              <Icon className={cn("mt-0.5 size-4 shrink-0", ui.color)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{check.label}</p>
                <p className="text-sm text-muted-foreground">{check.detail}</p>
              </div>
              <StatusBadge tone={ui.tone} className="hidden sm:inline-flex">
                {ui.label}
              </StatusBadge>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function SetupChecklistSkeleton() {
  return (
    <ul className="divide-y" aria-busy="true" aria-label="Vérification en cours">
      {Array.from({ length: 6 }, (_, index) => (
        <li key={index} className="flex items-center gap-3 px-5 py-4">
          <div className="size-4 animate-pulse rounded-full bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-48 animate-pulse rounded bg-muted" />
            <div className="h-3 w-72 max-w-full animate-pulse rounded bg-muted/70" />
          </div>
        </li>
      ))}
    </ul>
  );
}
