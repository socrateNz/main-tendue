import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound, ShieldCheck } from "lucide-react";

import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { NAVIGATION } from "@/lib/navigation";
import { ROLE_LABELS, hasPermission } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Mon compte" };

export default async function AccountPage() {
  const user = await requireUser();
  const areas = NAVIGATION.flatMap((group) => group.items).filter((item) => hasPermission(user.role, item.permission));

  return (
    <PageContainer className="max-w-3xl">
      <PageHeader title="Mon compte" description="Vos informations de connexion et vos accès." />

      <section className="overflow-hidden rounded-xl border bg-card shadow-card">
        <dl className="divide-y">
          {[
            ["Nom", user.name],
            ["Adresse e-mail", user.email],
          ].map(([label, value]) => (
            <div key={label} className="grid gap-1 px-5 py-4 sm:grid-cols-3">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="text-sm font-medium sm:col-span-2">{value}</dd>
            </div>
          ))}
          <div className="grid gap-1 px-5 py-4 sm:grid-cols-3">
            <dt className="text-sm text-muted-foreground">Rôle</dt>
            <dd className="sm:col-span-2">
              <StatusBadge tone="info">{ROLE_LABELS[user.role]}</StatusBadge>
            </dd>
          </div>
          <div className="grid gap-2 px-5 py-4 sm:grid-cols-3">
            <dt className="text-sm text-muted-foreground">Espaces accessibles</dt>
            <dd className="flex flex-wrap gap-1.5 sm:col-span-2">
              {areas.map((item) => (
                <span key={item.href} className="rounded-md border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
                  {item.title}
                </span>
              ))}
            </dd>
          </div>
        </dl>
      </section>

      <section className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-card sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <ShieldCheck className="size-4" aria-hidden />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Mot de passe</h2>
            <p className="text-sm text-muted-foreground">Le changer ferme vos sessions ouvertes sur les autres appareils.</p>
          </div>
        </div>
        <Link href="/mon-compte/mot-de-passe" className={buttonVariants({ variant: "outline" })}>
          <KeyRound aria-hidden />
          Changer le mot de passe
        </Link>
      </section>
    </PageContainer>
  );
}
