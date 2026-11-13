import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import Link from "next/link";
import { CheckCircle2, CircleDashed, FileUp, ScrollText, XCircle } from "lucide-react";

import { getSetupChecks, type SetupCheck } from "@/features/dashboard/setup";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { authorizePage } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Paramètres" };

export default async function SettingsPage() {
  const auth = await authorizePage("settings:manage");
  if (!auth.ok) return <AccessDenied />;
  return (
    <PageContainer>
      <PageHeader
        title="Paramètres"
        description="État de la configuration et des services externes. Les valeurs secrètes ne sont jamais affichées."
        actions={
          <div className="flex flex-wrap gap-2">
            {hasPermission(auth.user.role, "data:import") ? (
              <Link href="/parametres/import" className={buttonVariants({ variant: "outline" })}>
                <FileUp aria-hidden />
                Import Excel
              </Link>
            ) : null}
            {hasPermission(auth.user.role, "audit:read") ? (
              <Link href="/parametres/journal" className={buttonVariants({ variant: "outline" })}>
                <ScrollText aria-hidden />
                Journal d&apos;audit
              </Link>
            ) : null}
          </div>
        }
      />
      <section aria-labelledby="setup-title" className="overflow-hidden rounded-xl border bg-card shadow-card">
        <div className="flex flex-col gap-1 border-b px-5 py-4">
          <h2 id="setup-title" className="text-sm font-semibold">
            État du système
          </h2>
          <p className="text-sm text-muted-foreground">Contrôles effectués à l&apos;instant : variables d&apos;environnement, MongoDB Atlas, Cloudinary, données de démarrage.</p>
        </div>
        <Suspense fallback={<p className="px-5 py-6 text-sm text-muted-foreground">Vérification en cours…</p>}>
          <SetupChecklist />
        </Suspense>
      </section>
    </PageContainer>
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
  return (
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
  );
}
