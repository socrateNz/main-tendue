import { cookies } from "next/headers";

import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { NavUser } from "@/components/layout/nav-user";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ROLE_LABELS, permissionsOf } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";

/**
 * Cadre de l'espace de gestion. Charge l'utilisateur pour la navigation et le menu du compte ;
 * cela n'autorise RIEN : chaque page et chaque action vérifient elles-mêmes les permissions.
 * Rendu à la requête : placé sous un <Suspense> par le layout.
 */
export async function AppShell({ children }: { children: React.ReactNode }) {
  const [user, cookieStore] = await Promise.all([requireUser(), cookies()]);
  const sidebarState = cookieStore.get("sidebar_state")?.value;

  return (
    <SidebarProvider defaultOpen={sidebarState !== "false"}>
      <AppSidebar
        permissions={permissionsOf(user.role)}
        footer={<NavUser user={{ name: user.name, email: user.email, roleLabel: ROLE_LABELS[user.role] }} />}
      />
      <SidebarInset className="min-w-0 md:shadow-panel md:ring-1 md:ring-border/60">
        <AppHeader />
        <div className="flex flex-1 flex-col">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}

/** Squelette du cadre affiché instantanément pendant le rendu de la requête. */
export function AppShellSkeleton() {
  return (
    <div className="flex min-h-svh w-full bg-sidebar" aria-busy="true" aria-label="Chargement de l'espace de gestion">
      <div className="hidden w-64 shrink-0 flex-col gap-6 p-4 md:flex">
        <div className="flex items-center gap-3">
          <div className="size-8 animate-pulse rounded-lg bg-muted" />
          <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        </div>
        {Array.from({ length: 4 }, (_, group) => (
          <div key={group} className="flex flex-col gap-2">
            <div className="h-3 w-20 animate-pulse rounded bg-muted" />
            <div className="h-7 w-full animate-pulse rounded-md bg-muted/70" />
            <div className="h-7 w-full animate-pulse rounded-md bg-muted/70" />
          </div>
        ))}
      </div>
      <div className="m-0 flex flex-1 flex-col bg-card md:m-2 md:ml-0 md:rounded-xl md:shadow-panel">
        <div className="h-14 border-b" />
      </div>
    </div>
  );
}
